// useLightningAddress Hook
// Manages Lightning Address state, registration, and synchronization.
//
// Backed by a single module-level store (see utils/createStore) so every screen
// shares ONE Lightning Address. Registering / unregistering on one screen
// updates all consumers immediately, instead of each holding its own copy that
// only refreshes on its next focus.

import { useCallback, useEffect } from 'react';
import {
  type LightningAddressInfo,
  type LightningAddressWalletIdentity,
  LightningAddressService,
  validateUsername,
} from '../services';
import { createStore } from '../utils/createStore';
import { useWallet } from './useWallet';

// =============================================================================
// Types
// =============================================================================

export interface LightningAddressState {
  /** Current Lightning Address info (null if not registered) */
  addressInfo: LightningAddressInfo | null;
  /** Loading state for initial fetch */
  isLoading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Whether a Lightning Address is currently registered */
  isRegistered: boolean;
}

export interface LightningAddressActions {
  /** Reload Lightning Address from SDK/cache */
  refresh: () => Promise<void>;
  /** Check if a username is available */
  checkAvailability: (username: string) => Promise<{ available: boolean; error?: string }>;
  /** Register a new Lightning Address */
  register: (username: string, description?: string) => Promise<{ success: boolean; error?: string }>;
  /** Unregister the current Lightning Address */
  unregister: () => Promise<{ success: boolean; error?: string }>;
  /** Validate username format (client-side only) */
  validateUsername: (username: string) => { isValid: boolean; error?: string };
  /** Clear any error state */
  clearError: () => void;
}

// =============================================================================
// Shared store
// =============================================================================

interface LnAddressStoreState {
  addressInfo: LightningAddressInfo | null;
  isLoading: boolean;
  error: string | null;
}

const store = createStore<LnAddressStoreState>({
  addressInfo: null,
  isLoading: true,
  error: null,
});

// De-dupe concurrent refreshes — several mounted consumers re-trigger on the
// same SDK-connected / wallet-switched signal, but only one fetch should run.
const refreshInFlight = new Map<string, Promise<void>>();
let latestWalletKey: string | null = null;

function refreshStore(identity: LightningAddressWalletIdentity | null): Promise<void> {
  const walletKey = identity
    ? `${identity.masterKeyId}:${identity.subWalletIndex}`
    : null;

  if (latestWalletKey !== walletKey) {
    latestWalletKey = walletKey;
    // Never show the previous wallet's address while the target is loading.
    store.setState({ addressInfo: null, isLoading: !!walletKey, error: null });
  }

  if (!identity || !walletKey) {
    return Promise.resolve();
  }

  const existing = refreshInFlight.get(walletKey);
  if (existing) return existing;

  let promise!: Promise<void>;
  promise = (async () => {
    try {
      store.setState({ isLoading: true, error: null });
      const result = await LightningAddressService.getAddress(identity);
      // A slow request for the previous wallet must not overwrite the active
      // wallet's shared module store after a rapid switch back and forth.
      if (latestWalletKey !== walletKey) return;
      if (result.success) {
        store.setState({ addressInfo: result.data || null, isLoading: false });
      } else {
        store.setState({ error: result.error || 'Failed to load Lightning Address', isLoading: false });
      }
    } catch (err) {
      console.error('❌ [useLightningAddress] refresh failed:', err);
      if (latestWalletKey !== walletKey) return;
      store.setState({
        error: err instanceof Error ? err.message : 'Failed to load Lightning Address',
        isLoading: false,
      });
    } finally {
      if (refreshInFlight.get(walletKey) === promise) {
        refreshInFlight.delete(walletKey);
      }
    }
  })();
  refreshInFlight.set(walletKey, promise);
  return promise;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useLightningAddress(): LightningAddressState & LightningAddressActions {
  const { addressInfo, isLoading, error } = store.useStore();

  // Wallet/SDK connection signal — used to retry the fetch once the SDK has
  // actually connected (the first mount typically races SDK init and gets a
  // cache miss). We also re-fetch when the active master key changes so
  // switching wallets surfaces the new address.
  const { isConnected, activeWalletInfo } = useWallet();
  const activeWalletIdentity = activeWalletInfo
    ? {
        masterKeyId: activeWalletInfo.masterKeyId,
        subWalletIndex: activeWalletInfo.subWalletIndex,
      }
    : null;
  const activeWalletKey = activeWalletIdentity
    ? `${activeWalletIdentity.masterKeyId}:${activeWalletIdentity.subWalletIndex}`
    : null;

  const isRegistered = addressInfo !== null;

  // Load on mount, then re-fetch when the SDK connects or the wallet changes.
  useEffect(() => {
    void refreshStore(activeWalletIdentity);
    // refreshStore is module-stable; run whenever connection/wallet changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, activeWalletKey]);

  // ========================================
  // Actions
  // ========================================

  const refresh = useCallback(
    (): Promise<void> => refreshStore(activeWalletIdentity),
    [activeWalletKey],
  );

  const checkAvailability = useCallback(
    async (username: string): Promise<{ available: boolean; error?: string }> => {
      try {
        store.setState({ error: null });
        const result = await LightningAddressService.checkAvailability(username);
        if (result.success) {
          return { available: result.data === true };
        }
        return { available: false, error: result.error };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to check availability';
        return { available: false, error: errorMsg };
      }
    },
    []
  );

  const register = useCallback(
    async (
      username: string,
      description?: string
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        store.setState({ error: null });
        const result = await LightningAddressService.register(username, description);
        if (result.success && result.data) {
          store.setState({ addressInfo: result.data });
          return { success: true };
        }
        const errorMsg = result.error || 'Failed to register Lightning Address';
        store.setState({ error: errorMsg });
        return { success: false, error: errorMsg };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to register Lightning Address';
        store.setState({ error: errorMsg });
        return { success: false, error: errorMsg };
      }
    },
    []
  );

  const unregister = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      store.setState({ error: null });
      const result = await LightningAddressService.unregister();
      if (result.success) {
        store.setState({ addressInfo: null });
        return { success: true };
      }
      const errorMsg = result.error || 'Failed to unregister Lightning Address';
      store.setState({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to unregister Lightning Address';
      store.setState({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  }, []);

  const validateUsernameLocal = useCallback(
    (username: string): { isValid: boolean; error?: string } => {
      const result = validateUsername(username);
      return { isValid: result.isValid, error: result.error };
    },
    []
  );

  const clearError = useCallback((): void => {
    store.setState({ error: null });
  }, []);

  return {
    // State
    addressInfo,
    isLoading,
    error,
    isRegistered,

    // Actions
    refresh,
    checkAvailability,
    register,
    unregister,
    validateUsername: validateUsernameLocal,
    clearError,
  };
}

export default useLightningAddress;
