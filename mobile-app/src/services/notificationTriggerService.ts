/**
 * Service to sync device push subscriptions with the notification relay.
 */
import { Platform } from 'react-native';

// URL of the deployed Cloud Function relay
const BASE_URL = 'https://europe-west3-investave-1337.cloudfunctions.net';
const SYNC_SUBSCRIPTIONS_ENDPOINT = `${BASE_URL}/syncSubscriptions`;

interface NotificationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface WalletSubscription {
  identityPubkey: string;
  lightningAddress: string;
}

export const NotificationTriggerService = {
  /**
   * Sync all wallet subscriptions for this device token in one shot.
   * Sends identity pubkeys + lightning addresses so backend can map both.
   * Backend should replace existing mappings for this push token.
   */
  async syncSubscriptions(
    pushToken: string,
    wallets: WalletSubscription[],
    walletNickname?: string
  ): Promise<NotificationResponse> {
    try {
      if (!pushToken || wallets.length === 0) {
        return { success: false, error: 'Missing push token or wallet subscriptions' };
      }

      // Deduplicate by pubkey
      const seen = new Set<string>();
      const uniqueWallets = wallets.filter(w => {
        if (seen.has(w.identityPubkey)) return false;
        seen.add(w.identityPubkey);
        return true;
      });

      console.log(`🔄 [Notification] Syncing ${uniqueWallets.length} wallet subscriptions`);

      const response = await fetch(SYNC_SUBSCRIPTIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expoPushToken: pushToken,
          // New format: structured wallet entries
          wallets: uniqueWallets,
          // Backwards compat: also send flat identifiers (lightning addresses)
          identifiers: uniqueWallets.map(w => w.lightningAddress),
          platform: Platform.OS,
          walletNickname,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️ [Notification] Sync subscriptions failed (${response.status}): ${errorText}`);
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      console.log('✅ [Notification] Subscriptions synced:', result);
      return result;
    } catch (error) {
      console.warn('⚠️ [Notification] syncSubscriptions network error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  },
};
