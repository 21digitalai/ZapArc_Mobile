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
let refreshInFlight: Promise<void> | null = null;

function refreshStore(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      store.setState({ isLoading: true, error: null });
      const result = await LightningAddressService.getAddress();
      if (result.success) {
        store.setState({ addressInfo: result.data || null, isLoading: false });
      } else {
        store.setState({ error: result.error || 'Failed to load Lightning Address', isLoading: false });
      }
    } catch (err) {
      console.error('❌ [useLightningAddress] refresh failed:', err);
      store.setState({
        error: err instanceof Error ? err.message : 'Failed to load Lightning Address',
        isLoading: false,
      });
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
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
  const { isConnected, activeMasterKey } = useWallet();
  const activeMasterKeyId = activeMasterKey?.id ?? null;

  const isRegistered = addressInfo !== null;

  // Load on mount, then re-fetch when the SDK connects or the wallet changes.
  useEffect(() => {
    void refreshStore();
    // refreshStore is module-stable; run whenever connection/wallet changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, activeMasterKeyId]);

  // ========================================
  // Actions
  // ========================================

  const refresh = useCallback((): Promise<void> => refreshStore(), []);

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
