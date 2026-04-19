// Settings Service for app settings persistence
// Uses AsyncStorage for general app data (non-sensitive)

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  UserSettings,
  DomainSettings,
  DomainStatus,
  BlacklistData,
} from '../features/settings/types';
import { DEFAULT_USER_SETTINGS } from '../features/settings/types';

// =============================================================================
// Storage Keys
// =============================================================================

const SETTINGS_KEYS = {
  USER_SETTINGS: '@zap_arc/user_settings',
  DOMAIN_SETTINGS: '@zap_arc/domain_settings',
  BLACKLIST_DATA: '@zap_arc/blacklist_data',
  SWAP_SETTINGS: '@zap_arc/swap_settings',
  ACTIVE_ASSET: '@zap_arc/active_asset',
  ONBOARDING_COMPLETE: '@zap_arc/onboarding_complete',
  LAST_SYNC_TIME: '@zap_arc/last_sync_time',
} as const;

type SwapSettings = {
  slippageBps: number;
};

type WalletAsset = 'BTC' | 'USDB';

const DEFAULT_SWAP_SETTINGS: SwapSettings = {
  slippageBps: 50,
};

// =============================================================================
// Settings Service Class
// =============================================================================

class SettingsService {
  // ========================================
  // User Settings
  // ========================================

  /**
   * Get user settings with defaults
   */
  async getUserSettings(): Promise<UserSettings> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEYS.USER_SETTINGS);

      if (!stored) {
        return DEFAULT_USER_SETTINGS;
      }

      const parsed = JSON.parse(stored) as Partial<UserSettings>;

      // Merge with defaults to ensure all fields are present
      return {
        ...DEFAULT_USER_SETTINGS,
        ...parsed,
      };
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get user settings:', error);
      return DEFAULT_USER_SETTINGS;
    }
  }

  /**
   * Save user settings
   */
  async saveUserSettings(settings: UserSettings): Promise<void> {
    try {
      await AsyncStorage.setItem(
        SETTINGS_KEYS.USER_SETTINGS,
        JSON.stringify(settings)
      );
      console.log('✅ [SettingsService] User settings saved');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to save user settings:', error);
      throw error;
    }
  }

  /**
   * Update specific user settings fields
   */
  async updateUserSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
    try {
      const current = await this.getUserSettings();
      const updated = { ...current, ...updates };
      await this.saveUserSettings(updated);
      return updated;
    } catch (error) {
      console.error('❌ [SettingsService] Failed to update user settings:', error);
      throw error;
    }
  }

  /**
   * Reset user settings to defaults
   */
  async resetUserSettings(): Promise<void> {
    try {
      await this.saveUserSettings(DEFAULT_USER_SETTINGS);
      console.log('✅ [SettingsService] User settings reset to defaults');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to reset user settings:', error);
      throw error;
    }
  }

  // ========================================
  // Swap Settings
  // ========================================

  async getSwapSettings(): Promise<SwapSettings> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEYS.SWAP_SETTINGS);
      if (!stored) {
        return DEFAULT_SWAP_SETTINGS;
      }

      const parsed = JSON.parse(stored) as Partial<SwapSettings>;
      const slippageBps = Number(parsed.slippageBps);
      if (!Number.isFinite(slippageBps)) {
        return DEFAULT_SWAP_SETTINGS;
      }

      return {
        slippageBps: Math.min(1000, Math.max(1, Math.round(slippageBps))),
      };
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get swap settings:', error);
      return DEFAULT_SWAP_SETTINGS;
    }
  }

  async updateSwapSettings(updates: Partial<SwapSettings>): Promise<SwapSettings> {
    try {
      const current = await this.getSwapSettings();
      const merged: SwapSettings = {
        ...current,
        ...updates,
      };
      const next: SwapSettings = {
        slippageBps: Math.min(1000, Math.max(1, Math.round(Number(merged.slippageBps)))),
      };

      await AsyncStorage.setItem(SETTINGS_KEYS.SWAP_SETTINGS, JSON.stringify(next));
      return next;
    } catch (error) {
      console.error('❌ [SettingsService] Failed to update swap settings:', error);
      throw error;
    }
  }



  async getActiveAsset(): Promise<WalletAsset> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEYS.ACTIVE_ASSET);
      return stored === 'USDB' ? 'USDB' : 'BTC';
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get active asset:', error);
      return 'BTC';
    }
  }

  async setActiveAsset(asset: WalletAsset): Promise<WalletAsset> {
    const next: WalletAsset = asset === 'USDB' ? 'USDB' : 'BTC';
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.ACTIVE_ASSET, next);
      return next;
    } catch (error) {
      console.error('❌ [SettingsService] Failed to set active asset:', error);
      throw error;
    }
  }

  // ========================================
  // Domain Settings
  // ========================================

  /**
   * Get all domain settings
   */
  async getDomainSettings(): Promise<DomainSettings> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEYS.DOMAIN_SETTINGS);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get domain settings:', error);
      return {};
    }
  }

  /**
   * Get status for a specific domain
   */
  async getDomainStatus(domain: string): Promise<DomainStatus | null> {
    try {
      const settings = await this.getDomainSettings();
      return settings[domain] || null;
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get domain status:', error);
      return null;
    }
  }

  /**
   * Set status for a specific domain
   */
  async setDomainStatus(domain: string, status: DomainStatus): Promise<void> {
    try {
      const settings = await this.getDomainSettings();
      settings[domain] = status;
      await AsyncStorage.setItem(
        SETTINGS_KEYS.DOMAIN_SETTINGS,
        JSON.stringify(settings)
      );
      console.log('✅ [SettingsService] Domain status saved', { domain, status });
    } catch (error) {
      console.error('❌ [SettingsService] Failed to set domain status:', error);
      throw error;
    }
  }

  /**
   * Remove a domain from settings
   */
  async removeDomainStatus(domain: string): Promise<void> {
    try {
      const settings = await this.getDomainSettings();
      delete settings[domain];
      await AsyncStorage.setItem(
        SETTINGS_KEYS.DOMAIN_SETTINGS,
        JSON.stringify(settings)
      );
      console.log('✅ [SettingsService] Domain removed', { domain });
    } catch (error) {
      console.error('❌ [SettingsService] Failed to remove domain:', error);
      throw error;
    }
  }

  /**
   * Clear all domain settings
   */
  async clearDomainSettings(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SETTINGS_KEYS.DOMAIN_SETTINGS);
      console.log('✅ [SettingsService] All domain settings cleared');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to clear domain settings:', error);
      throw error;
    }
  }

  // ========================================
  // Blacklist Management
  // ========================================

  /**
   * Get blacklist data
   */
  async getBlacklist(): Promise<BlacklistData> {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEYS.BLACKLIST_DATA);
      return stored
        ? JSON.parse(stored)
        : { lnurls: [], lightningAddresses: [], lastUpdated: 0 };
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get blacklist:', error);
      return { lnurls: [], lightningAddresses: [], lastUpdated: 0 };
    }
  }

  /**
   * Save blacklist data
   */
  async saveBlacklist(blacklist: BlacklistData): Promise<void> {
    try {
      blacklist.lastUpdated = Date.now();
      await AsyncStorage.setItem(
        SETTINGS_KEYS.BLACKLIST_DATA,
        JSON.stringify(blacklist)
      );
      console.log('✅ [SettingsService] Blacklist saved');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to save blacklist:', error);
      throw error;
    }
  }

  /**
   * Add an LNURL to the blacklist
   */
  async addToBlacklist(lnurl: string): Promise<void> {
    try {
      const blacklist = await this.getBlacklist();
      if (!blacklist.lnurls.includes(lnurl)) {
        blacklist.lnurls.push(lnurl);
        await this.saveBlacklist(blacklist);
        console.log('✅ [SettingsService] LNURL added to blacklist', { lnurl });
      }
    } catch (error) {
      console.error('❌ [SettingsService] Failed to add to blacklist:', error);
      throw error;
    }
  }

  /**
   * Add a Lightning address to the blacklist
   */
  async addLightningAddressToBlacklist(address: string): Promise<void> {
    try {
      const blacklist = await this.getBlacklist();
      if (!blacklist.lightningAddresses.includes(address)) {
        blacklist.lightningAddresses.push(address);
        await this.saveBlacklist(blacklist);
        console.log('✅ [SettingsService] Lightning address added to blacklist', {
          address,
        });
      }
    } catch (error) {
      console.error('❌ [SettingsService] Failed to add to blacklist:', error);
      throw error;
    }
  }

  /**
   * Remove an LNURL from the blacklist
   */
  async removeFromBlacklist(lnurl: string): Promise<void> {
    try {
      const blacklist = await this.getBlacklist();
      blacklist.lnurls = blacklist.lnurls.filter((l) => l !== lnurl);
      await this.saveBlacklist(blacklist);
      console.log('✅ [SettingsService] LNURL removed from blacklist', { lnurl });
    } catch (error) {
      console.error('❌ [SettingsService] Failed to remove from blacklist:', error);
      throw error;
    }
  }

  /**
   * Remove a Lightning address from the blacklist
   */
  async removeLightningAddressFromBlacklist(address: string): Promise<void> {
    try {
      const blacklist = await this.getBlacklist();
      blacklist.lightningAddresses = blacklist.lightningAddresses.filter(
        (a) => a !== address
      );
      await this.saveBlacklist(blacklist);
      console.log('✅ [SettingsService] Lightning address removed from blacklist', {
        address,
      });
    } catch (error) {
      console.error('❌ [SettingsService] Failed to remove from blacklist:', error);
      throw error;
    }
  }

  /**
   * Check if an LNURL is blacklisted
   */
  async isBlacklisted(lnurl: string): Promise<boolean> {
    try {
      const blacklist = await this.getBlacklist();
      return blacklist.lnurls.includes(lnurl);
    } catch (error) {
      console.error('❌ [SettingsService] Failed to check blacklist:', error);
      return false;
    }
  }

  /**
   * Check if a Lightning address is blacklisted
   */
  async isLightningAddressBlacklisted(address: string): Promise<boolean> {
    try {
      const blacklist = await this.getBlacklist();
      return blacklist.lightningAddresses.includes(address);
    } catch (error) {
      console.error('❌ [SettingsService] Failed to check blacklist:', error);
      return false;
    }
  }

  /**
   * Clear all blacklist data
   */
  async clearBlacklist(): Promise<void> {
    try {
      await AsyncStorage.removeItem(SETTINGS_KEYS.BLACKLIST_DATA);
      console.log('✅ [SettingsService] Blacklist cleared');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to clear blacklist:', error);
      throw error;
    }
  }

  // ========================================
  // Onboarding and App State
  // ========================================

  /**
   * Check if onboarding is complete
   */
  async isOnboardingComplete(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(SETTINGS_KEYS.ONBOARDING_COMPLETE);
      return value === 'true';
    } catch (error) {
      console.error('❌ [SettingsService] Failed to check onboarding status:', error);
      return false;
    }
  }

  /**
   * Mark onboarding as complete
   */
  async setOnboardingComplete(complete: boolean = true): Promise<void> {
    try {
      await AsyncStorage.setItem(
        SETTINGS_KEYS.ONBOARDING_COMPLETE,
        complete.toString()
      );
      console.log('✅ [SettingsService] Onboarding status set', { complete });
    } catch (error) {
      console.error('❌ [SettingsService] Failed to set onboarding status:', error);
      throw error;
    }
  }

  /**
   * Get last sync time
   */
  async getLastSyncTime(): Promise<number> {
    try {
      const value = await AsyncStorage.getItem(SETTINGS_KEYS.LAST_SYNC_TIME);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      console.error('❌ [SettingsService] Failed to get last sync time:', error);
      return 0;
    }
  }

  /**
   * Set last sync time
   */
  async setLastSyncTime(time: number = Date.now()): Promise<void> {
    try {
      await AsyncStorage.setItem(SETTINGS_KEYS.LAST_SYNC_TIME, time.toString());
    } catch (error) {
      console.error('❌ [SettingsService] Failed to set last sync time:', error);
      throw error;
    }
  }

  // ========================================
  // Utility Operations
  // ========================================

  /**
   * Clear all settings data
   */
  async clearAllSettings(): Promise<void> {
    try {
      const keys = Object.values(SETTINGS_KEYS);
      await AsyncStorage.multiRemove(keys);
      console.log('✅ [SettingsService] All settings cleared');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to clear all settings:', error);
      throw error;
    }
  }

  /**
   * Export all settings (for backup)
   */
  async exportSettings(): Promise<{
    userSettings: UserSettings;
    domainSettings: DomainSettings;
    blacklist: BlacklistData;
  }> {
    try {
      const [userSettings, domainSettings, blacklist] = await Promise.all([
        this.getUserSettings(),
        this.getDomainSettings(),
        this.getBlacklist(),
      ]);

      return { userSettings, domainSettings, blacklist };
    } catch (error) {
      console.error('❌ [SettingsService] Failed to export settings:', error);
      throw error;
    }
  }

  /**
   * Import settings (from backup)
   */
  async importSettings(data: {
    userSettings?: UserSettings;
    domainSettings?: DomainSettings;
    blacklist?: BlacklistData;
  }): Promise<void> {
    try {
      if (data.userSettings) {
        await this.saveUserSettings(data.userSettings);
      }
      if (data.domainSettings) {
        await AsyncStorage.setItem(
          SETTINGS_KEYS.DOMAIN_SETTINGS,
          JSON.stringify(data.domainSettings)
        );
      }
      if (data.blacklist) {
        await this.saveBlacklist(data.blacklist);
      }
      console.log('✅ [SettingsService] Settings imported');
    } catch (error) {
      console.error('❌ [SettingsService] Failed to import settings:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const settingsService = new SettingsService();

// Export class for testing
export { SettingsService };
