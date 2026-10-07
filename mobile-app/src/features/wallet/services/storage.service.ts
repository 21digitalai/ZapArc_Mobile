/**
 * Storage Service for Wallet Data
 * Manages encrypted wallet storage using Expo SecureStore and AsyncStorage
 * Adapted from zap-arc browser extension for React Native
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  encryptWithPin,
  decryptWithPin,
  generateUUID,
  validatePayloadIntegrity,
} from '../utils/crypto.utils';
import type {
  MultiWalletStorage,
  MasterKeyEntry,
  MasterKeyMetadata,
  SubWalletEntry,
  ActiveWalletInfo,
} from '../types';
import type {
  UserSettings,
  DomainSettings,
  BlacklistData,
} from '../../settings/types';
import { DEFAULT_USER_SETTINGS } from '../../settings/types';

// Storage keys
const STORAGE_KEYS = {
  MULTI_WALLET_DATA: 'multiWalletData',
  WALLET_VERSION: 'walletVersion',
  IS_UNLOCKED: 'isUnlocked',
  LAST_ACTIVITY: 'lastActivity',
  USER_SETTINGS: 'userSettings',
  DOMAIN_SETTINGS: 'domainSettings',
  BLACKLIST_DATA: 'blacklistData',
  SELECTED_WALLET_FOR_UNLOCK: 'selectedWalletForUnlock',
} as const;

/**
 * StorageService class - manages wallet and settings persistence
 */
export class StorageService {
  // ========================================
  // Core Storage Operations
  // ========================================

  /**
   * Save data to secure storage (encrypted wallet data)
   */
  private async saveSecure(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error(`[Storage] Failed to save secure data for ${key}:`, error);
      throw new Error(`Failed to save secure data: ${key}`);
    }
  }

  /**
   * Load data from secure storage
   */
  private async loadSecure(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error(`[Storage] Failed to load secure data for ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete data from secure storage
   */
  private async deleteSecure(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error(
        `[Storage] Failed to delete secure data for ${key}:`,
        error
      );
    }
  }

  /**
   * Save data to AsyncStorage (non-sensitive data)
   */
  private async saveAsync(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error(`[Storage] Failed to save async data for ${key}:`, error);
      throw new Error(`Failed to save data: ${key}`);
    }
  }

  /**
   * Load data from AsyncStorage
   */
  private async loadAsync(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error(`[Storage] Failed to load async data for ${key}:`, error);
      return null;
    }
  }

  // ========================================
  // Wallet Existence and Status
  // ========================================

  /**
   * Check if any wallet exists
   */
  async walletExists(): Promise<boolean> {
    try {
      const data = await this.loadSecure(STORAGE_KEYS.MULTI_WALLET_DATA);
      const version = await this.loadAsync(STORAGE_KEYS.WALLET_VERSION);
      return !!(data || version === '1');
    } catch (error) {
      console.error('[Storage] Failed to check wallet existence:', error);
      return false;
    }
  }

  /**
   * Get current wallet storage version
   * @returns -1 = no wallet, 1 = multi-wallet
   */
  async getWalletVersion(): Promise<number> {
    try {
      const version = await this.loadAsync(STORAGE_KEYS.WALLET_VERSION);
      if (version) {
        return parseInt(version, 10);
      }
      const data = await this.loadSecure(STORAGE_KEYS.MULTI_WALLET_DATA);
      return data ? 1 : -1;
    } catch (error) {
      console.error('[Storage] Failed to get wallet version:', error);
      return -1;
    }
  }

  // ========================================
  // Wallet Lock/Unlock State
  // ========================================

  /**
   * Check if wallet is currently unlocked
   */
  async isWalletUnlocked(): Promise<boolean> {
    try {
      const isUnlocked = await this.loadAsync(STORAGE_KEYS.IS_UNLOCKED);
      if (isUnlocked !== 'true') return false;

      // Check auto-lock timeout
      const settings = await this.getUserSettings();
      const lastActivity = await this.loadAsync(STORAGE_KEYS.LAST_ACTIVITY);
      const now = Date.now();
      const lastActivityTime = lastActivity ? parseInt(lastActivity, 10) : now;
      const timeoutMs = settings.autoLockTimeout * 1000;

      if (timeoutMs > 0 && now - lastActivityTime > timeoutMs) {
        await this.lockWallet();
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Storage] Failed to check wallet unlock status:', error);
      return false;
    }
  }

  /**
   * Lock the wallet
   */
  async lockWallet(): Promise<void> {
    try {
      await this.saveAsync(STORAGE_KEYS.IS_UNLOCKED, 'false');
      await this.saveAsync(STORAGE_KEYS.LAST_ACTIVITY, '0');
    } catch (error) {
      console.error('[Storage] Failed to lock wallet:', error);
    }
  }

  /**
   * Unlock the wallet
   */
  async unlockWallet(): Promise<void> {
    try {
      await this.saveAsync(STORAGE_KEYS.IS_UNLOCKED, 'true');
      await this.saveAsync(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
    } catch (error) {
      console.error('[Storage] Failed to unlock wallet:', error);
    }
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(): Promise<void> {
    try {
      const isUnlocked = await this.isWalletUnlocked();
      if (isUnlocked) {
        await this.saveAsync(STORAGE_KEYS.LAST_ACTIVITY, Date.now().toString());
      }
    } catch (error) {
      console.error('[Storage] Failed to update activity:', error);
    }
  }

  // ========================================
  // Multi-Wallet Storage Operations
  // ========================================

  /**
   * Load multi-wallet storage data
   */
  private async loadMultiWalletData(): Promise<MultiWalletStorage | null> {
    try {
      const data = await this.loadSecure(STORAGE_KEYS.MULTI_WALLET_DATA);
      if (!data) return null;
      return JSON.parse(data) as MultiWalletStorage;
    } catch (error) {
      console.error('[Storage] Failed to load multi-wallet data:', error);
      return null;
    }
  }

  /**
   * Save multi-wallet storage data
   */
  private async saveMultiWalletData(data: MultiWalletStorage): Promise<void> {
    try {
      await this.saveSecure(
        STORAGE_KEYS.MULTI_WALLET_DATA,
        JSON.stringify(data)
      );
      await this.saveAsync(STORAGE_KEYS.WALLET_VERSION, '1');
    } catch (error) {
      console.error('[Storage] Failed to save multi-wallet data:', error);
      throw error;
    }
  }

  // ========================================
  // Master Key Operations
  // ========================================

  /**
   * Get all master key metadata (without decryption)
   */
  async getMasterKeyMetadata(): Promise<MasterKeyMetadata[]> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) return [];

      return data.masterKeys.map((mk) => ({
        id: mk.id,
        nickname: mk.nickname,
        createdAt: mk.createdAt,
        lastUsedAt: mk.lastUsedAt,
        subWalletCount: mk.subWallets.length,
        isExpanded: mk.isExpanded,
        archivedAt: mk.archivedAt,
      }));
    } catch (error) {
      console.error('[Storage] Failed to get master key metadata:', error);
      return [];
    }
  }

  /**
   * Add a new master key
   */
  async addMasterKey(
    mnemonic: string,
    nickname: string,
    pin: string
  ): Promise<string> {
    try {
      const id = generateUUID();
      const now = Date.now();

      // Encrypt mnemonic with PIN
      const encryptedMnemonic = await encryptWithPin(mnemonic, pin);

      // Create master key entry
      const masterKey: MasterKeyEntry = {
        id,
        nickname,
        encryptedMnemonic,
        subWallets: [],
        archivedSubWallets: [],
        createdAt: now,
        lastUsedAt: now,
        isExpanded: false,
        canCreateSubWallets: false,
      };

      // Load or create storage
      let data = await this.loadMultiWalletData();
      if (!data) {
        data = {
          masterKeys: [],
          activeMasterKeyId: id,
          activeSubWalletIndex: 0,
          version: 1,
        };
      }

      // Add master key
      data.masterKeys.push(masterKey);

      // If this is the first master key, set it as active
      if (data.masterKeys.length === 1) {
        data.activeMasterKeyId = id;
        data.activeSubWalletIndex = 0;
      }

      await this.saveMultiWalletData(data);
      console.log('[Storage] Master key added:', { id, nickname });

      return id;
    } catch (error) {
      console.error('[Storage] Failed to add master key:', error);
      throw error;
    }
  }

  /**
   * Get master key mnemonic (decrypted)
   */
  async getMasterKeyMnemonic(
    masterKeyId: string,
    pin: string
  ): Promise<string> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      // Validate payload integrity
      validatePayloadIntegrity(masterKey.encryptedMnemonic.timestamp);

      // Decrypt mnemonic
      return await decryptWithPin(masterKey.encryptedMnemonic, pin);
    } catch (error) {
      console.error('[Storage] Failed to get master key mnemonic:', error);
      throw error;
    }
  }

  /**
   * Try to unlock any master key with the given PIN
   * Returns the first master key that successfully decrypts
   */
  async tryUnlockAnyMasterKey(
    pin: string
  ): Promise<{ masterKeyId: string; mnemonic: string } | null> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data || data.masterKeys.length === 0) return null;

      // Try active master key first
      if (data.activeMasterKeyId) {
        const activeMk = data.masterKeys.find(
          (mk) => mk.id === data.activeMasterKeyId
        );
        if (activeMk) {
          try {
            const mnemonic = await decryptWithPin(
              activeMk.encryptedMnemonic,
              pin
            );
            return { masterKeyId: activeMk.id, mnemonic };
          } catch {
            // PIN didn't match, try others
          }
        }
      }

      // Try all master keys
      for (const mk of data.masterKeys) {
        if (mk.id === data.activeMasterKeyId) continue; // Already tried
        try {
          const mnemonic = await decryptWithPin(mk.encryptedMnemonic, pin);
          // Update active master key
          data.activeMasterKeyId = mk.id;
          data.activeSubWalletIndex = 0;
          await this.saveMultiWalletData(data);
          return { masterKeyId: mk.id, mnemonic };
        } catch {
          continue;
        }
      }

      return null;
    } catch (error) {
      console.error('[Storage] Failed to unlock master key:', error);
      return null;
    }
  }

  /**
   * Remove a master key
   */
  async removeMasterKey(masterKeyId: string): Promise<void> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      if (data.masterKeys.length === 1) {
        throw new Error('Cannot remove the last master key');
      }

      const index = data.masterKeys.findIndex((mk) => mk.id === masterKeyId);
      if (index === -1) throw new Error(`Master key ${masterKeyId} not found`);

      data.masterKeys.splice(index, 1);

      // Update active if needed
      if (data.activeMasterKeyId === masterKeyId) {
        data.activeMasterKeyId = data.masterKeys[0].id;
        data.activeSubWalletIndex = 0;
      }

      await this.saveMultiWalletData(data);
    } catch (error) {
      console.error('[Storage] Failed to remove master key:', error);
      throw error;
    }
  }

  /**
   * Rename a master key
   */
  async renameMasterKey(
    masterKeyId: string,
    newNickname: string
  ): Promise<void> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      masterKey.nickname = newNickname;
      await this.saveMultiWalletData(data);
    } catch (error) {
      console.error('[Storage] Failed to rename master key:', error);
      throw error;
    }
  }

  // ========================================
  // Sub-Wallet Operations
  // ========================================

  /**
   * Get sub-wallets for a master key
   */
  async getSubWallets(
    masterKeyId: string,
    includeArchived = false
  ): Promise<SubWalletEntry[]> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) return [];

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) return [];

      if (includeArchived) {
        return [...masterKey.subWallets, ...masterKey.archivedSubWallets];
      }
      return masterKey.subWallets;
    } catch (error) {
      console.error('[Storage] Failed to get sub-wallets:', error);
      return [];
    }
  }

  /**
   * Add a sub-wallet to a master key
   */
  async addSubWallet(masterKeyId: string, nickname: string): Promise<number> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      // Find next available index
      const usedIndices = new Set(masterKey.subWallets.map((sw) => sw.index));
      let nextIndex = 1; // Start from 1 (0 is the master)
      while (usedIndices.has(nextIndex) && nextIndex < 20) {
        nextIndex++;
      }

      if (nextIndex >= 20) {
        throw new Error('Maximum sub-wallets (20) reached');
      }

      const now = Date.now();
      const subWallet: SubWalletEntry = {
        index: nextIndex,
        nickname,
        createdAt: now,
        lastUsedAt: now,
        hasActivity: false,
      };

      masterKey.subWallets.push(subWallet);
      masterKey.lastUsedAt = now;
      await this.saveMultiWalletData(data);

      return nextIndex;
    } catch (error) {
      console.error('[Storage] Failed to add sub-wallet:', error);
      throw error;
    }
  }

  /**
   * Remove a sub-wallet
   */
  async removeSubWallet(
    masterKeyId: string,
    subWalletIndex: number
  ): Promise<void> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      const swIndex = masterKey.subWallets.findIndex(
        (sw) => sw.index === subWalletIndex
      );
      if (swIndex === -1) {
        throw new Error(`Sub-wallet ${subWalletIndex} not found`);
      }

      masterKey.subWallets.splice(swIndex, 1);

      // Update active if needed
      if (
        data.activeMasterKeyId === masterKeyId &&
        data.activeSubWalletIndex === subWalletIndex
      ) {
        data.activeSubWalletIndex = 0;
      }

      await this.saveMultiWalletData(data);
    } catch (error) {
      console.error('[Storage] Failed to remove sub-wallet:', error);
      throw error;
    }
  }

  /**
   * Rename a sub-wallet
   */
  async renameSubWallet(
    masterKeyId: string,
    subWalletIndex: number,
    newNickname: string
  ): Promise<void> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      const subWallet = masterKey.subWallets.find(
        (sw) => sw.index === subWalletIndex
      );
      if (!subWallet) throw new Error(`Sub-wallet ${subWalletIndex} not found`);

      subWallet.nickname = newNickname;
      await this.saveMultiWalletData(data);
    } catch (error) {
      console.error('[Storage] Failed to rename sub-wallet:', error);
      throw error;
    }
  }

  // ========================================
  // Active Wallet Management
  // ========================================

  /**
   * Set the active wallet (master key + sub-wallet)
   */
  async setActiveWallet(
    masterKeyId: string,
    subWalletIndex: number
  ): Promise<void> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data) throw new Error('No wallet data found');

      const masterKey = data.masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) throw new Error(`Master key ${masterKeyId} not found`);

      // Validate sub-wallet index
      if (subWalletIndex > 0) {
        const subWallet = masterKey.subWallets.find(
          (sw) => sw.index === subWalletIndex
        );
        if (!subWallet)
          throw new Error(`Sub-wallet ${subWalletIndex} not found`);
        subWallet.lastUsedAt = Date.now();
      }

      data.activeMasterKeyId = masterKeyId;
      data.activeSubWalletIndex = subWalletIndex;
      masterKey.lastUsedAt = Date.now();

      await this.saveMultiWalletData(data);
    } catch (error) {
      console.error('[Storage] Failed to set active wallet:', error);
      throw error;
    }
  }

  /**
   * Get active wallet info
   */
  async getActiveWalletInfo(): Promise<ActiveWalletInfo | null> {
    try {
      const data = await this.loadMultiWalletData();
      if (!data || !data.activeMasterKeyId) return null;

      const masterKey = data.masterKeys.find(
        (mk) => mk.id === data.activeMasterKeyId
      );
      if (!masterKey) return null;

      let subWalletNickname = 'Default';
      if (data.activeSubWalletIndex > 0) {
        const subWallet = masterKey.subWallets.find(
          (sw) => sw.index === data.activeSubWalletIndex
        );
        if (subWallet) {
          subWalletNickname = subWallet.nickname;
        }
      }

      return {
        masterKeyId: data.activeMasterKeyId,
        masterKeyNickname: masterKey.nickname,
        subWalletIndex: data.activeSubWalletIndex,
        subWalletNickname,
      };
    } catch (error) {
      console.error('[Storage] Failed to get active wallet info:', error);
      return null;
    }
  }

  // ========================================
  // User Settings
  // ========================================

  /**
   * Get user settings with defaults
   */
  async getUserSettings(): Promise<UserSettings> {
    try {
      const data = await this.loadAsync(STORAGE_KEYS.USER_SETTINGS);
      if (!data) return { ...DEFAULT_USER_SETTINGS };

      const stored = JSON.parse(data) as Partial<UserSettings>;
      return { ...DEFAULT_USER_SETTINGS, ...stored };
    } catch (error) {
      console.error('[Storage] Failed to get user settings:', error);
      return { ...DEFAULT_USER_SETTINGS };
    }
  }

  /**
   * Save user settings
   */
  async saveUserSettings(settings: UserSettings): Promise<void> {
    try {
      await this.saveAsync(STORAGE_KEYS.USER_SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.error('[Storage] Failed to save user settings:', error);
      throw error;
    }
  }

  // ========================================
  // Domain Settings
  // ========================================

  /**
   * Get domain settings
   */
  async getDomainSettings(): Promise<DomainSettings> {
    try {
      const data = await this.loadAsync(STORAGE_KEYS.DOMAIN_SETTINGS);
      if (!data) return {};
      return JSON.parse(data) as DomainSettings;
    } catch (error) {
      console.error('[Storage] Failed to get domain settings:', error);
      return {};
    }
  }

  /**
   * Save domain settings
   */
  async saveDomainSettings(settings: DomainSettings): Promise<void> {
    try {
      await this.saveAsync(
        STORAGE_KEYS.DOMAIN_SETTINGS,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.error('[Storage] Failed to save domain settings:', error);
      throw error;
    }
  }

  // ========================================
  // Blacklist
  // ========================================

  /**
   * Get blacklist data
   */
  async getBlacklist(): Promise<BlacklistData> {
    try {
      const data = await this.loadAsync(STORAGE_KEYS.BLACKLIST_DATA);
      if (!data) {
        return { lnurls: [], lightningAddresses: [], lastUpdated: 0 };
      }
      return JSON.parse(data) as BlacklistData;
    } catch (error) {
      console.error('[Storage] Failed to get blacklist:', error);
      return { lnurls: [], lightningAddresses: [], lastUpdated: 0 };
    }
  }

  /**
   * Save blacklist data
   */
  async saveBlacklist(blacklist: BlacklistData): Promise<void> {
    try {
      await this.saveAsync(
        STORAGE_KEYS.BLACKLIST_DATA,
        JSON.stringify(blacklist)
      );
    } catch (error) {
      console.error('[Storage] Failed to save blacklist:', error);
      throw error;
    }
  }

  // ========================================
  // Clear All Data
  // ========================================

  /**
   * Clear all wallet and settings data
   */
  async clearAllData(): Promise<void> {
    try {
      await this.deleteSecure(STORAGE_KEYS.MULTI_WALLET_DATA);
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.WALLET_VERSION,
        STORAGE_KEYS.IS_UNLOCKED,
        STORAGE_KEYS.LAST_ACTIVITY,
        STORAGE_KEYS.USER_SETTINGS,
        STORAGE_KEYS.DOMAIN_SETTINGS,
        STORAGE_KEYS.BLACKLIST_DATA,
        STORAGE_KEYS.SELECTED_WALLET_FOR_UNLOCK,
      ]);
      console.log('[Storage] All data cleared');
    } catch (error) {
      console.error('[Storage] Failed to clear all data:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
