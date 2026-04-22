/**
 * Breez LNURL / Lightning Address webhook relay.
 *
 * Breez's LNURL server POSTs here when a payment is settled against any
 * ZapArc user's Lightning Address (e.g. `shiro@breez.tips`). This is a
 * DIFFERENT path from the SDK-level wallet webhook (`/breezWebhook`) —
 * that one fires for wallet-observed events (direct Bolt11 receives),
 * while this one fires for LN-Address-initiated payments whose
 * settlement happens on Breez's server before the wallet sees them.
 *
 * Registration is manual — email contact@breez.technology with this
 * URL. They configure it server-side and share a signing secret.
 *
 * Payload envelope (per https://sdk-doc-spark.breez.technology/guide/lnurl_webhooks.html):
 *
 *   {
 *     "template": "spark_payment_received",
 *     "data": {
 *       "payment_hash":  "abc123...",
 *       "invoice":       "lnbc50u1p...",
 *       "preimage":      "def456...",
 *       "amount_sat":    50000,
 *       "user_pubkey":   "02abc123...",        ← used to look up push target
 *       "lightning_address": "alice@domain",
 *       "sender_comment": "Thanks!",
 *       "timestamp":     1711929600000
 *     }
 *   }
 *
 * Signature: `X-Breez-Signature` = hex(HMAC-SHA256(secret, rawBody)).
 * The signing secret is injected as the `BREEZ_LNURL_WEBHOOK_SECRET`
 * Cloud Function secret (set via `firebase functions:secrets:set`).
 *
 * Flow:
 *   1. Verify HMAC signature
 *   2. Parse template (only spark_payment_received currently)
 *   3. Look up `user_pubkey` in Firestore → { fcmToken, walletNickname }
 *   4. Send push via firebase-admin.messaging().send()
 *   5. Dedupe using `payment_hash` (Breez may retry)
 */

import * as crypto from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const lnurlSecret = defineSecret('BREEZ_LNURL_WEBHOOK_SECRET');

// Firestore collection mapping a wallet's identity pubkey to the push
// target registered by the current device. Written by the mobile client
// when the SDK initializes.
const PUSH_TARGETS_COLLECTION = 'lnurl_push_targets';

// In-memory dedupe for the last hour of payment hashes. Breez retries on
// non-2xx, and instance reuse means this catches most duplicates without
// hitting Firestore for a cross-instance dedupe record.
const recentPaymentHashes = new Map<string, number>();
const DEDUP_WINDOW_MS = 60 * 60 * 1000;

function verifySignature(rawBody: string, signatureHex: string, secret: string): boolean {
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function formatSats(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'a payment';
  return `${value.toLocaleString('en-US')} sats`;
}

interface SparkPaymentReceivedData {
  payment_hash?: string;
  invoice?: string;
  preimage?: string;
  amount_sat?: number | null;
  user_pubkey?: string;
  lightning_address?: string | null;
  sender_comment?: string | null;
  timestamp?: number;
}

export const breezLnurlWebhook = onRequest(
  {
    region: 'europe-west3',
    cors: false,
    secrets: [lnurlSecret],
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      // Firebase provides the body already-parsed via req.body, but for
      // HMAC verification we need the raw bytes. Use req.rawBody.
      const rawBody: Buffer | undefined = (req as any).rawBody;
      const rawText = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {});

      const signatureHeader = String(
        req.header('x-breez-signature') ?? req.header('X-Breez-Signature') ?? '',
      );
      const secretValue = lnurlSecret.value();

      if (!secretValue) {
        console.warn('breezLnurlWebhook: BREEZ_LNURL_WEBHOOK_SECRET not configured');
        res.status(500).send('Server misconfigured');
        return;
      }

      if (!signatureHeader) {
        console.warn('breezLnurlWebhook: missing X-Breez-Signature header');
        res.status(401).send('Missing signature');
        return;
      }

      if (!verifySignature(rawText, signatureHeader, secretValue)) {
        console.warn('breezLnurlWebhook: signature verification failed');
        res.status(401).send('Invalid signature');
        return;
      }

      const body = req.body as { template?: string; data?: SparkPaymentReceivedData } | undefined;
      if (!body?.template) {
        res.status(400).send('Missing template');
        return;
      }

      if (body.template !== 'spark_payment_received') {
        console.log('breezLnurlWebhook: ignoring unknown template', body.template);
        // 200 so Breez doesn't retry an event we deliberately ignore.
        res.status(200).send('Ignored unknown template');
        return;
      }

      const data = body.data ?? {};
      const userPubkey = data.user_pubkey;
      if (!userPubkey) {
        res.status(400).send('Missing user_pubkey');
        return;
      }

      // Dedupe by payment_hash — Breez retries on non-2xx, and we want to
      // ack idempotently.
      const paymentHash = data.payment_hash || '';
      if (paymentHash) {
        const now = Date.now();
        // Prune expired entries cheaply (O(n) in size of map).
        for (const [hash, ts] of recentPaymentHashes.entries()) {
          if (now - ts > DEDUP_WINDOW_MS) recentPaymentHashes.delete(hash);
        }
        if (recentPaymentHashes.has(paymentHash)) {
          console.log('breezLnurlWebhook: duplicate payment_hash, already handled', paymentHash.slice(0, 16) + '…');
          res.status(200).send('Already handled');
          return;
        }
        recentPaymentHashes.set(paymentHash, now);
      }

      // Look up the push target for this wallet's identity pubkey.
      const db = getFirestore();
      const snap = await db.collection(PUSH_TARGETS_COLLECTION).doc(userPubkey).get();
      if (!snap.exists) {
        console.warn('breezLnurlWebhook: no push target for pubkey', userPubkey.slice(0, 12) + '…');
        // 200 so Breez doesn't keep retrying — the user's device simply
        // hasn't registered with us (or has been offline long enough that
        // we cleared their entry).
        res.status(200).send('No push target');
        return;
      }

      const target = snap.data() as {
        fcmToken?: string;
        walletNickname?: string;
      };
      const fcmToken = target.fcmToken;
      const walletNickname = target.walletNickname;

      if (!fcmToken) {
        console.warn('breezLnurlWebhook: stored doc has no fcmToken for pubkey', userPubkey.slice(0, 12) + '…');
        res.status(200).send('Missing fcmToken');
        return;
      }

      const walletSuffix = walletNickname ? ` on ${walletNickname}` : '';
      const amountSat = data.amount_sat ?? undefined;

      try {
        await getMessaging().send({
          token: fcmToken,
          notification: {
            title: '⚡ Payment received',
            body: `You received ${formatSats(amountSat ?? undefined)}${walletSuffix}`,
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'payments',
              sound: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
              },
            },
          },
          data: {
            type: 'lnurl_receive',
            paymentHash: String(data.payment_hash ?? ''),
            preimage: String(data.preimage ?? ''),
            amountSats: String(amountSat ?? ''),
            lightningAddress: String(data.lightning_address ?? ''),
            senderComment: String(data.sender_comment ?? ''),
            walletNickname: walletNickname ?? '',
            walletPubkey: userPubkey,
          },
        });
      } catch (sendErr) {
        console.warn('breezLnurlWebhook: FCM send failed', sendErr);
        // Still 200 — retrying won't help if the token is invalid.
        res.status(200).send('FCM send failed (logged)');
        return;
      }

      console.log('breezLnurlWebhook: push sent', {
        pubkey: userPubkey.slice(0, 12) + '…',
        amountSat,
        walletNickname,
      });
      res.status(200).send('OK');
    } catch (err) {
      console.error('breezLnurlWebhook handler threw:', err);
      // 200 to avoid Breez retrying a payload we failed to handle.
      res.status(200).send('Handler error logged');
    }
  },
);
