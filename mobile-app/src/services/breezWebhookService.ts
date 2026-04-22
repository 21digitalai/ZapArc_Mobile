/**
 * Breez SDK Webhook Registration (DB-less relay pattern)
 *
 * Registers a per-wallet webhook with Breez so incoming-Lightning events
 * fire push notifications even when the app is closed.
 *
 *   url: https://<region>-<project>.cloudfunctions.net/breezWebhook/<identityPubkey>/<fcmToken>
 *
 * The wallet identity + FCM push token live in the URL path; no server-
 * side DB lookup is required. The Cloud Function:
 *   1. Parses <identityPubkey> and <fcmToken> from the request path
 *   2. Parses Breez's JSON body (type === SPARK_LIGHTNING_RECEIVE_FINISHED)
 *   3. Verifies body.receiver_identity_public_key matches the URL path —
 *      this is the authentication check: an attacker who guessed the URL
 *      can't forge a payload whose embedded pubkey matches, since Breez
 *      signs events server-side with the registered identity.
 *   4. Uses `firebase-admin.messaging().send({token, notification, data})`
 *      to forward the push directly via FCM (Android) or APNs-via-FCM
 *      (iOS). No Expo push server in the path.
 *
 * Why native FCM over Expo push tokens:
 *   - Independence from Expo's push service (fewer vendors, no rate
 *     limits, no "server key not configured" failure modes).
 *   - Same token format + same `firebase-admin` send call works for both
 *     Android and iOS — FCM transparently routes to APNs on iOS.
 *
 * Why only LightningReceiveFinished:
 *   - Send / CoopExit / StaticDeposit webhook payloads don't carry a
 *     wallet identifier; routing those requires a DB lookup we don't
 *     want. We only need push notifications for INCOMING payments.
 *   - Token (BTC⇄USDB) swaps aren't surfaced as webhook events in the
 *     current SDK (0.13.x).
 *   - The user is the one initiating sends, so the device-side event
 *     listener is sufficient for those (no push needed — the user is
 *     already looking at the app).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// URL of the deployed relay Cloud Function. The Function parses
// /breezWebhook/<pubkey>/<token> from the request path.
const WEBHOOK_BASE_URL =
  'https://europe-west3-investave-1337.cloudfunctions.net/breezWebhook';

// Storage key holding a map of identityPubkey → { webhookId, secret }.
const WEBHOOK_REGISTRY_KEY = '@breez_webhook_registry';

interface WebhookRegistryEntry {
  webhookId: string;
  secret: string;
  /** Last url registered. If the expoPushToken changes we need to re-register. */
  url: string;
}

type WebhookRegistry = Record<string, WebhookRegistryEntry>;

async function readRegistry(): Promise<WebhookRegistry> {
  try {
    const raw = await AsyncStorage.getItem(WEBHOOK_REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as WebhookRegistry;
    }
  } catch (err) {
    console.warn('⚠️ [BreezWebhook] readRegistry failed:', err);
  }
  return {};
}

async function writeRegistry(registry: WebhookRegistry): Promise<void> {
  try {
    await AsyncStorage.setItem(WEBHOOK_REGISTRY_KEY, JSON.stringify(registry));
  } catch (err) {
    console.warn('⚠️ [BreezWebhook] writeRegistry failed:', err);
  }
}

/**
 * Generate a 256-bit secret encoded as hex (64 chars). The Cloud Function
 * uses this to verify the HMAC-SHA256 signature Breez sends with each
 * webhook call. Stored per-wallet so compromising one wallet's secret
 * doesn't affect others.
 */
async function generateSecret(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildUrl(identityPubkey: string, pushToken: string, walletNickname?: string): string {
  // FCM tokens are URL-safe (alphanumeric + colons + underscores + hyphens)
  // but `encodeURIComponent` is still applied defensively in case of edge
  // characters in some platform/SDK combinations.
  const base = `${WEBHOOK_BASE_URL}/${encodeURIComponent(identityPubkey)}/${encodeURIComponent(pushToken)}`;
  // Wallet nickname as an optional third path segment — the Cloud Function
  // shows it in the push notification ("Received X sats on Personal Wallet")
  // so multi-wallet users can tell which wallet was credited without opening
  // the app.
  return walletNickname ? `${base}/${encodeURIComponent(walletNickname)}` : base;
}

export interface RegisterBreezWebhookOptions {
  identityPubkey: string;
  /** Native FCM push token (same format on Android + iOS via FCM). */
  pushToken: string;
  /** Human-readable wallet label shown in the push notification. */
  walletNickname?: string;
  /** The live SDK instance — avoid import cycles with breezSparkService. */
  sdk: any;
}

/**
 * Idempotent: register (or re-register if url/token changed) a webhook for
 * this wallet's LightningReceiveFinished events. Call on every SDK init.
 *
 * Safe to call even if SDK doesn't expose registerWebhook (older builds) —
 * logs a warning and returns.
 */
export async function registerBreezWebhook(
  opts: RegisterBreezWebhookOptions,
): Promise<void> {
  const { identityPubkey, pushToken, walletNickname, sdk } = opts;

  if (!identityPubkey || !pushToken) {
    console.warn('⚠️ [BreezWebhook] missing identityPubkey or pushToken');
    return;
  }
  if (typeof sdk?.registerWebhook !== 'function') {
    console.warn('⚠️ [BreezWebhook] SDK does not expose registerWebhook — skipping');
    return;
  }

  const url = buildUrl(identityPubkey, pushToken, walletNickname);
  const registry = await readRegistry();
  const existing = registry[identityPubkey];

  console.log('🔔 [BreezWebhook] registry state', JSON.stringify({
    hasExisting: !!existing,
    existingUrl: existing?.url,
    existingWebhookId: existing?.webhookId,
    newUrl: url,
    urlMatches: existing?.url === url,
  }));

  // Skip if URL is unchanged — Breez already has this webhook.
  if (existing && existing.url === url && existing.webhookId) {
    console.log('🔔 [BreezWebhook] URL unchanged — skipping re-register');
    return;
  }

  // If there's a stale entry (url changed due to push-token rotation or
  // wallet nickname refactor), unregister the old webhookId first so we
  // don't leave zombie webhooks fanning out pushes to dead URLs.
  if (existing?.webhookId) {
    try {
      if (typeof sdk.unregisterWebhook === 'function') {
        await sdk.unregisterWebhook({ webhookId: existing.webhookId });
      }
    } catch (err) {
      console.warn('⚠️ [BreezWebhook] stale unregister failed (continuing):', err);
    }
  }

  const secret = existing?.secret ?? (await generateSecret());

  // Load the module lazily to avoid top-level-import crashes (pattern used
  // elsewhere in breezSparkService for the same reason).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const breezModule = require('@breeztech/breez-sdk-spark-react-native');
  const { WebhookEventType } = breezModule;

  const eventTypes = [
    // LightningReceiveFinished is the only event whose payload carries
    // a wallet identifier AND the one we need for "someone paid you"
    // notifications. See breezWebhookService.ts header for why we skip
    // the other three types.
    typeof WebhookEventType?.LightningReceiveFinished?.new === 'function'
      ? WebhookEventType.LightningReceiveFinished.new()
      : { tag: 'LightningReceiveFinished' },
  ];

  try {
    console.log('🔔 [BreezWebhook] registering', {
      url,
      eventTypesCount: eventTypes.length,
      eventType0: (eventTypes[0] as any)?.tag,
    });
    const resp = await sdk.registerWebhook({
      url,
      secret,
      eventTypes,
    });
    console.log('🔔 [BreezWebhook] registerWebhook response', JSON.stringify(resp));
    const webhookId = String(resp?.webhookId || '');
    if (!webhookId) {
      console.warn('⚠️ [BreezWebhook] registerWebhook returned no id');
      return;
    }
    registry[identityPubkey] = { webhookId, secret, url };
    await writeRegistry(registry);
    console.log(
      `✅ [BreezWebhook] Registered for ${identityPubkey.slice(0, 12)}… id=${webhookId}`,
    );
  } catch (err) {
    console.warn('⚠️ [BreezWebhook] registerWebhook failed:', err);
  }
}

/**
 * Unregister a wallet's webhook. Call when a sub-wallet is archived or
 * deleted so Breez stops pinging the stale URL.
 */
export async function unregisterBreezWebhook(opts: {
  identityPubkey: string;
  sdk: any;
}): Promise<void> {
  const { identityPubkey, sdk } = opts;
  const registry = await readRegistry();
  const entry = registry[identityPubkey];
  if (!entry) return;

  if (typeof sdk?.unregisterWebhook === 'function' && entry.webhookId) {
    try {
      await sdk.unregisterWebhook({ webhookId: entry.webhookId });
      console.log(`🗑️ [BreezWebhook] Unregistered for ${identityPubkey.slice(0, 12)}…`);
    } catch (err) {
      console.warn('⚠️ [BreezWebhook] unregisterWebhook failed:', err);
    }
  }

  delete registry[identityPubkey];
  await writeRegistry(registry);
}
