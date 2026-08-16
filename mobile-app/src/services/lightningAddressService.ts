// Lightning Address Service
// Handles validation, caching, and synchronization for Lightning Address operations

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type LightningAddressInfo,
  checkLightningAddressAvailable,
  registerLightningAddress,
  getLightningAddress,
  unregisterLightningAddress,
  isSDKInitialized,
} from './breezSparkService';
import { storageService } from './storageService';

// =============================================================================
// Constants
// =============================================================================

const LEGACY_STORAGE_KEY = '@lightning_address_info';
const STORAGE_KEY_PREFIX = '@lightning_address_info:';

export interface LightningAddressWalletIdentity {
  masterKeyId: string;
  subWalletIndex: number;
}

function getStorageKey(identity: LightningAddressWalletIdentity): string {
  return `${STORAGE_KEY_PREFIX}${identity.masterKeyId}:${identity.subWalletIndex}`;
}

async function resolveWalletIdentity(
  identity?: LightningAddressWalletIdentity,
): Promise<LightningAddressWalletIdentity | null> {
  if (identity) return identity;
  const active = await storageService.getActiveWalletInfo();
  if (!active) return null;
  return {
    masterKeyId: active.masterKeyId,
    subWalletIndex: active.subWalletIndex,
  };
}

// Username validation pattern: 3-32 chars, alphanumeric with hyphens/underscores
// Must start and end with alphanumeric
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$/;

// =============================================================================
// Types
// =============================================================================

export interface UsernameValidationResult {
  isValid: boolean;
  error?: string;
}

export interface LightningAddressServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// Username Validation
// =============================================================================

/**
 * Validate a Lightning Address username
 * @param username - The username to validate (without @domain)
 * @returns Validation result with error message if invalid
 */
export function validateUsername(username: string): UsernameValidationResult {
  // Check for empty or whitespace-only
  if (!username || username.trim().length === 0) {
    return { isValid: false, error: 'Username cannot be empty' };
  }

  const trimmed = username.trim().toLowerCase();

  // Check length
  if (trimmed.length < 3) {
    return { isValid: false, error: 'Username must be at least 3 characters' };
  }

  if (trimmed.length > 32) {
    return { isValid: false, error: 'Username must be 32 characters or less' };
  }

  // Check pattern
  if (!USERNAME_PATTERN.test(trimmed)) {
    // Provide specific error based on what's wrong
    if (!/^[a-z0-9]/.test(trimmed)) {
      return { isValid: false, error: 'Username must start with a letter or number' };
    }
    if (!/[a-z0-9]$/.test(trimmed)) {
      return { isValid: false, error: 'Username must end with a letter or number' };
    }
    if (/[^a-z0-9_-]/.test(trimmed)) {
      return {
        isValid: false,
        error: 'Username can only contain letters, numbers, hyphens, and underscores',
      };
    }
    return { isValid: false, error: 'Invalid username format' };
  }

  return { isValid: true };
}

// =============================================================================
// Cache Operations
// =============================================================================

/**
 * Get cached Lightning Address info from local storage
 */
export async function getCachedAddress(
  identity?: LightningAddressWalletIdentity,
): Promise<LightningAddressInfo | null> {
  try {
    const resolved = await resolveWalletIdentity(identity);
    if (!resolved) return null;

    const scopedKey = getStorageKey(resolved);
    let cached = await AsyncStorage.getItem(scopedKey);

    // Older builds stored one global address. It overwhelmingly represented
    // index 0, so migrate it only for Main; never leak it into a sub-wallet.
    if (!cached && resolved.subWalletIndex === 0) {
      cached = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
      if (cached) {
        await AsyncStorage.setItem(scopedKey, cached);
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }

    if (!cached) return null;

    const parsed = JSON.parse(cached) as LightningAddressInfo;
    console.log('✅ [LightningAddressService] Loaded cached address:', parsed.lightningAddress);
    return parsed;
  } catch (error) {
    console.error('❌ [LightningAddressService] Failed to read cache:', error);
    return null;
  }
}

/**
 * Save Lightning Address info to local storage
 */
export async function cacheAddress(
  addressInfo: LightningAddressInfo,
  identity?: LightningAddressWalletIdentity,
): Promise<void> {
  try {
    const resolved = await resolveWalletIdentity(identity);
    if (!resolved) return;
    await AsyncStorage.setItem(getStorageKey(resolved), JSON.stringify(addressInfo));
    if (resolved.subWalletIndex === 0) {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    console.log('✅ [LightningAddressService] Cached address:', addressInfo.lightningAddress);
  } catch (error) {
    console.error('❌ [LightningAddressService] Failed to save cache:', error);
  }
}

/**
 * Clear cached Lightning Address info
 */
export async function clearAddressCache(
  identity?: LightningAddressWalletIdentity,
): Promise<void> {
  try {
    const resolved = await resolveWalletIdentity(identity);
    if (!resolved) return;
    await AsyncStorage.removeItem(getStorageKey(resolved));
    if (resolved.subWalletIndex === 0) {
      await AsyncStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    console.log('✅ [LightningAddressService] Cache cleared');
  } catch (error) {
    console.error('❌ [LightningAddressService] Failed to clear cache:', error);
  }
}

// =============================================================================
// Service Operations
// =============================================================================

/**
 * Check if a username is available for registration
 * Validates username format first, then queries SDK
 */
export async function checkAvailability(
  username: string
): Promise<LightningAddressServiceResult<boolean>> {
  // Validate format first
  const validation = validateUsername(username);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  // Check SDK availability
  if (!isSDKInitialized()) {
    return { success: false, error: 'Wallet not initialized. Please open your wallet first.' };
  }

  try {
    const available = await checkLightningAddressAvailable(username.toLowerCase());
    return { success: true, data: available };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to check availability',
    };
  }
}

/**
 * Register a new Lightning Address
 * Validates username, registers with SDK, and caches result
 */
export async function register(
  username: string,
  description?: string
): Promise<LightningAddressServiceResult<LightningAddressInfo>> {
  // Validate format first
  const validation = validateUsername(username);
  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  // Check SDK availability
  if (!isSDKInitialized()) {
    return { success: false, error: 'Wallet not initialized. Please open your wallet first.' };
  }

  try {
    const addressInfo = await registerLightningAddress(username.toLowerCase(), description);

    // Cache the result
    await cacheAddress(addressInfo);

    return { success: true, data: addressInfo };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register Lightning Address',
    };
  }
}

/**
 * Get current Lightning Address
 * First tries SDK (source of truth), falls back to cache, syncs if needed
 */
export async function getAddress(
  identity?: LightningAddressWalletIdentity,
): Promise<LightningAddressServiceResult<LightningAddressInfo | null>> {
  const resolved = await resolveWalletIdentity(identity);
  if (!resolved) return { success: true, data: null };

  // If SDK is available, use it as source of truth
  if (isSDKInitialized()) {
    try {
      const sdkAddress = await getLightningAddress();

      if (sdkAddress) {
        // Update cache with SDK state
        await cacheAddress(sdkAddress, resolved);
        return { success: true, data: sdkAddress };
      } else {
        // No address registered - clear cache if it exists
        await clearAddressCache(resolved);
        return { success: true, data: null };
      }
    } catch (error) {
      console.warn('⚠️ [LightningAddressService] SDK fetch failed, trying cache:', error);
    }
  }

  // Fall back to cache (offline mode)
  const cached = await getCachedAddress(resolved);
  return { success: true, data: cached };
}

/**
 * Unregister the current Lightning Address
 * Removes from SDK and clears cache
 */
export async function unregister(): Promise<LightningAddressServiceResult<void>> {
  // Check SDK availability
  if (!isSDKInitialized()) {
    return { success: false, error: 'Wallet not initialized. Please open your wallet first.' };
  }

  try {
    await unregisterLightningAddress();

    // Clear cache
    await clearAddressCache();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to unregister Lightning Address',
    };
  }
}

/**
 * Sync local cache with SDK state
 * SDK is the source of truth - updates cache to match
 */
export async function syncWithSDK(identity?: LightningAddressWalletIdentity): Promise<void> {
  if (!isSDKInitialized()) {
    console.log('ℹ️ [LightningAddressService] SDK not initialized, skipping sync');
    return;
  }

  try {
    const sdkAddress = await getLightningAddress();

    if (sdkAddress) {
      await cacheAddress(sdkAddress, identity);
    } else {
      await clearAddressCache(identity);
    }

    console.log('✅ [LightningAddressService] Synced with SDK');
  } catch (error) {
    console.error('❌ [LightningAddressService] Sync failed:', error);
  }
}

// =============================================================================
// Exports
// =============================================================================

export const LightningAddressService = {
  // Validation
  validateUsername,

  // Cache
  getCachedAddress,
  cacheAddress,
  clearAddressCache,

  // Operations
  checkAvailability,
  register,
  getAddress,
  unregister,
  syncWithSDK,
};

export default LightningAddressService;
