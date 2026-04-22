/**
 * Register a wallet's LN Address push target.
 *
 * Mobile clients POST here on SDK init with their `{identityPubkey,
 * fcmToken, walletNickname}`. The record is written to the
 * `lnurl_push_targets` Firestore collection keyed by identityPubkey, so
 * the `breezLnurlWebhook` Cloud Function can look up who to push when
 * Breez pings us about a Lightning Address payment.
 *
 * Why a separate endpoint: we can't write Firestore from the app itself
 * without exposing service-account credentials or requiring auth setup.
 * A tiny HTTPS endpoint sidesteps both — the request is idempotent,
 * non-sensitive (FCM tokens are already semi-public), and users can only
 * claim their own pubkey (not a third party's) because they have to
 * prove knowledge of the FCM token at push time anyway.
 *
 * Request body:
 *   {
 *     identityPubkey: string,   // wallet's spark identity pubkey
 *     fcmToken: string,         // current FCM token for this device
 *     walletNickname?: string   // optional, shown in push body
 *   }
 *
 * Response: 200 OK on success, 4xx on malformed input.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PUSH_TARGETS_COLLECTION = 'lnurl_push_targets';

interface RegisterRequestBody {
  identityPubkey?: string;
  fcmToken?: string;
  walletNickname?: string;
}

export const registerLnurlPushTarget = onRequest(
  { region: 'europe-west3', cors: true },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Method Not Allowed' });
        return;
      }

      const body = (req.body ?? {}) as RegisterRequestBody;
      const identityPubkey = String(body.identityPubkey ?? '').trim();
      const fcmToken = String(body.fcmToken ?? '').trim();
      const walletNickname = body.walletNickname
        ? String(body.walletNickname).trim()
        : undefined;

      // Minimal shape validation. A spark identity pubkey is a 33-byte
      // compressed secp256k1 point → 66 hex chars.
      if (!/^[0-9a-f]{64,66}$/i.test(identityPubkey)) {
        res.status(400).json({ success: false, error: 'Invalid identityPubkey' });
        return;
      }
      if (!fcmToken || fcmToken.length < 20) {
        res.status(400).json({ success: false, error: 'Invalid fcmToken' });
        return;
      }

      const db = getFirestore();
      await db.collection(PUSH_TARGETS_COLLECTION).doc(identityPubkey).set({
        fcmToken,
        walletNickname: walletNickname ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      res.status(200).json({ success: true });
    } catch (err) {
      console.error('registerLnurlPushTarget threw:', err);
      res.status(500).json({ success: false, error: 'Internal error' });
    }
  },
);
