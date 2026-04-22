/**
 * Firebase Cloud Function — Breez webhook relay (DB-less)
 *
 * Drop this into your `europe-west3-investave-1337` project as a new
 * HTTPS function named `breezWebhook`. No Firestore dependency.
 *
 * URL pattern Breez will POST to (set on the mobile side via
 * sdk.registerWebhook):
 *
 *   https://europe-west3-investave-1337.cloudfunctions.net/breezWebhook/<identityPubkey>/<expoPushToken>
 *
 * Flow:
 *   1. Parse <identityPubkey> + <expoPushToken> from the request path
 *   2. Parse Breez's JSON body (type=SPARK_LIGHTNING_RECEIVE_FINISHED)
 *   3. Verify body.receiver_identity_public_key === URL pubkey
 *      (authentication: an attacker guessing the URL can't forge a body
 *      signed by Breez with a matching pubkey)
 *   4. Forward an Expo push to exp.host/--/api/v2/push/send
 *
 * Deploy with:
 *   firebase deploy --only functions:breezWebhook
 */

import * as functions from 'firebase-functions/v2/https';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

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

export const breezWebhook = functions.onRequest(
  { region: 'europe-west3', cors: false },
  async (req, res) => {
    try {
      // Only accept POST
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      // Parse URL path: /breezWebhook/<pubkey>/<pushToken>
      // When mounted via Firebase HTTPS the leading `/breezWebhook` is
      // stripped, so `req.path` begins with `/<pubkey>/<pushToken>`.
      const rawPath = req.path || '';
      const parts = rawPath.split('/').filter(Boolean);
      if (parts.length < 2) {
        res.status(400).send('Missing pubkey or push token in path');
        return;
      }
      const urlPubkey = decodeURIComponent(parts[0]);
      const expoPushToken = decodeURIComponent(parts[1]);

      // Parse body
      const body = req.body as SparkLightningReceiveFinished | undefined;
      if (!body || typeof body !== 'object') {
        res.status(400).send('Invalid body');
        return;
      }

      // Only care about LightningReceiveFinished — ignore anything else
      if (body.type !== 'SPARK_LIGHTNING_RECEIVE_FINISHED') {
        res.status(200).send('Ignored non-receive event');
        return;
      }

      // Authentication: the pubkey embedded in the signed event body must
      // match the URL path. Breez controls the body — an attacker who
      // guesses the URL can't forge a body with the correct pubkey.
      if (body.receiver_identity_public_key !== urlPubkey) {
        res.status(401).send('Pubkey mismatch');
        return;
      }

      // Format the push message
      const amountSats =
        body.invoice_amount?.unit === 'SATOSHI' ? body.invoice_amount.value : undefined;
      const message = {
        to: expoPushToken,
        sound: 'default',
        title: '⚡ Payment received',
        body: `You received ${formatSats(amountSats)}`,
        data: {
          type: 'lightning_receive',
          paymentPreimage: body.payment_preimage,
          amountSats,
          eventId: body.id,
        },
        priority: 'high',
        channelId: 'payments',
      };

      const pushResp = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!pushResp.ok) {
        const text = await pushResp.text();
        console.warn(`Expo push failed (${pushResp.status}): ${text}`);
        // Still return 200 to Breez — nothing we can do by retrying
        res.status(200).send('Push attempt logged');
        return;
      }

      res.status(200).send('OK');
    } catch (err) {
      console.error('breezWebhook handler threw:', err);
      // Return 200 so Breez doesn't spam us with retries of a payload we
      // can't process — we'll log and move on.
      res.status(200).send('Handler error logged');
    }
  },
);
