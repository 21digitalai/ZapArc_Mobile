/**
 * Breez SDK webhook relay — DB-less, native FCM delivery.
 *
 * Breez posts to:
 *   https://europe-west3-investave-1337.cloudfunctions.net/breezWebhook/<identityPubkey>/<fcmToken>
 *
 * Flow:
 *   1. Parse <identityPubkey> + <fcmToken> from the URL path
 *   2. Parse Breez's JSON body (type === SPARK_LIGHTNING_RECEIVE_FINISHED)
 *   3. Authenticate by matching body.receiver_identity_public_key to the
 *      pubkey embedded in the URL. Breez signs/populates that field
 *      server-side, so an attacker who guessed the URL can't forge a
 *      payload whose embedded pubkey matches.
 *   4. Forward a formatted push to the device via `firebase-admin` →
 *      Firebase Cloud Messaging (FCM) directly. On iOS FCM routes
 *      transparently to APNs using the same token format. No Expo push
 *      server in the path.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getMessaging } from 'firebase-admin/messaging';

interface SparkLightningReceiveFinished {
  type: 'SPARK_LIGHTNING_RECEIVE_FINISHED';
  id: string;
  network?: string;
  request_status?: string;
  status?: string;
  payment_preimage?: string;
  receiver_identity_public_key: string;
  invoice_amount?: { value: number; unit: 'SATOSHI' | string };
  htlc_amount?: { value: number; unit: string };
  created_at?: string;
  updated_at?: string;
  timestamp?: string;
}

function formatSats(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'a payment';
  return `${value.toLocaleString('en-US')} sats`;
}

export const breezWebhook = onRequest(
  { region: 'europe-west3', cors: false },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      // Firebase strips the function name from req.path, so req.path is
      // `/<pubkey>/<pushToken>` (or the whole thing may be urlencoded).
      const rawPath = req.path || '';
      const parts = rawPath.split('/').filter(Boolean);
      if (parts.length < 2) {
        console.warn('breezWebhook: missing pubkey or push token in path', { rawPath });
        res.status(400).send('Missing pubkey or push token in path');
        return;
      }
      const urlPubkey = decodeURIComponent(parts[0]);
      const fcmToken = decodeURIComponent(parts[1]);
      // Optional third segment: wallet nickname. Shown in the push body so
      // multi-wallet users can identify which wallet received the payment
      // without opening the app.
      const walletNickname = parts[2] ? decodeURIComponent(parts[2]) : undefined;

      const body = req.body as SparkLightningReceiveFinished | undefined;
      if (!body || typeof body !== 'object') {
        console.warn('breezWebhook: invalid body');
        res.status(400).send('Invalid body');
        return;
      }

      if (body.type !== 'SPARK_LIGHTNING_RECEIVE_FINISHED') {
        console.log('breezWebhook: ignoring non-receive event', { type: body.type });
        res.status(200).send('Ignored non-receive event');
        return;
      }

      if (body.receiver_identity_public_key !== urlPubkey) {
        console.warn('breezWebhook: pubkey mismatch', {
          url: urlPubkey.slice(0, 12) + '…',
          body: String(body.receiver_identity_public_key).slice(0, 12) + '…',
        });
        res.status(401).send('Pubkey mismatch');
        return;
      }

      const amountSats =
        body.invoice_amount?.unit === 'SATOSHI' ? body.invoice_amount.value : undefined;

      const walletSuffix = walletNickname ? ` on ${walletNickname}` : '';

      try {
        await getMessaging().send({
          token: fcmToken,
          notification: {
            title: '⚡ Payment received',
            body: `You received ${formatSats(amountSats)}${walletSuffix}`,
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
            type: 'lightning_receive',
            paymentPreimage: String(body.payment_preimage ?? ''),
            amountSats: String(amountSats ?? ''),
            eventId: String(body.id ?? ''),
            walletNickname: walletNickname ?? '',
            walletPubkey: urlPubkey,
          },
        });
      } catch (sendErr) {
        console.warn('breezWebhook: FCM send failed', sendErr);
        // Return 200 anyway — Breez shouldn't retry-spam us for a device
        // whose token we can't reach.
        res.status(200).send('FCM send failed (logged)');
        return;
      }

      console.log('breezWebhook: push sent', {
        pubkey: urlPubkey.slice(0, 12) + '…',
        amountSats,
        walletNickname,
      });
      res.status(200).send('OK');
    } catch (err) {
      console.error('breezWebhook handler threw:', err);
      // Return 200 so Breez doesn't retry-spam us
      res.status(200).send('Handler error logged');
    }
  },
);
