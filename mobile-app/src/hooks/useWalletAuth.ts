// useWalletAuth Hook
// Manages wallet PIN authentication, session, and auto-lock

import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { storageService, settingsService } from '../services';
import * as BreezSparkService from '../services/breezSparkService';
import * as WalletCache from '../services/walletCacheService';
import { deriveSubWalletMnemonic } from '../utils/mnemonic';
import type { ActiveWalletInfo } from '../features/wallet/types';
import type { PinAuthStatus } from '../services/storageService';

// =============================================================================
// Types
// =============================================================================

export interface WalletAuthState {
  // Session state
  isUnlocked: boolean;
  isLoading: boolean;
  error: string | null;

  // Biometric
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  biometricType: 'fingerprint' | 'facial' | 'iris' | 'none';

  // Active wallet
  activeWalletInfo: ActiveWalletInfo | null;
  currentMasterKeyId: string | null;

  // Session info
  lastActivity: number;
  autoLockTimeout: number;
}

export interface WalletAuthActions {
  // PIN operations
  unlock: (pin: string) => Promise<boolean>;
  lock: () => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (oldPin: string, newPin: string) => Promise<boolean>;
  getPinAuthStatus: (masterKeyId?: string) => Promise<PinAuthStatus | null>;

  // Biometric
  unlockWithBiometric: () => Promise<boolean>;
  enableBiometric: () => Promise<boolean>;

  // Wallet selection
  selectWallet: (masterKeyId: string, subWalletIndex: number, pin: string) => Promise<boolean>;
  selectSubWallet: (subWalletIndex: number) => Promise<boolean>;

  // Session management
  updateActivity: () => void;
  checkAutoLock: () => Promise<void>;
  getSessionPin: () => string | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWalletAuth(): WalletAuthState & WalletAuthActions {
  // State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricType, setBiometricType] = useState<
    'fingerprint' | 'facial' | 'iris' | 'none'
  >('none');
  const [activeWalletInfo, setActiveWalletInfo] = useState<ActiveWalletInfo | null>(null);
  const [currentMasterKeyId, setCurrentMasterKeyId] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [autoLockTimeout, setAutoLockTimeout] = useState(900); // 15 minutes default

  // Refs
  const autoLockTimerRef = useRef<ReturnType<typeof global.setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ========================================
  // Initialize
  // ========================================

  useEffect(() => {
    const initialize = async (): Promise<void> => {
      try {
        setIsLoading(true);

        // Check wallet unlock status
        const unlocked = await storageService.isWalletUnlocked();
        setIsUnlocked(unlocked);

        // Get active wallet info
        const walletInfo = await storageService.getActiveWalletInfo();
        setActiveWalletInfo(walletInfo);
        if (walletInfo) {
          setCurrentMasterKeyId(walletInfo.masterKeyId);
        }

        // Get last activity
        const lastAct = await storageService.getLastActivity();
        setLastActivity(lastAct);

        // Check biometric availability
        await checkBiometricAvailability();

        // Get settings and auto-lock timeout
        const settings = await settingsService.getUserSettings();
        setAutoLockTimeout(settings.autoLockTimeout);
        setBiometricEnabled(settings.biometricEnabled ?? false);

        // Check if we should auto-lock
        await checkAutoLock();
      } catch (err) {
        console.error('❌ [useWalletAuth] Initialize failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize auth');
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

  // ========================================
  // App State Handling (for auto-lock)
  // ========================================

  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus): Promise<void> => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground - check auto-lock
        console.log('📱 [useWalletAuth] App came to foreground');
        await checkAutoLock();
      } else if (nextAppState === 'background') {
        // App going to background - save last activity
        console.log('📱 [useWalletAuth] App going to background');
        updateActivity();
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return (): void => {
      subscription?.remove();
      if (autoLockTimerRef.current) {
        global.clearTimeout(autoLockTimerRef.current);
      }
    };
  }, [autoLockTimeout]);

  // ========================================
  // Biometric
  // ========================================

  const checkBiometricAvailability = async (): Promise<void> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      setBiometricAvailable(hasHardware && isEnrolled);

      if (hasHardware && isEnrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('facial');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType('fingerprint');
        } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
          setBiometricType('iris');
        }
      }
    } catch (err) {
      console.error('❌ [useWalletAuth] Biometric check failed:', err);
    }
  };

  // Session PIN for SDK initialization (stored in memory only, not persisted)
  const sessionPinRef = useRef<string | null>(null);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);

      if (!biometricAvailable) {
        throw new Error('Biometric authentication not available');
      }

      const masterKeyId = currentMasterKeyId;
      if (!masterKeyId) {
        throw new Error('No wallet selected');
      }

      // Single biometric prompt: the SecureStore read itself triggers the OS
      // fingerprint dialog AND returns the PIN on success. Previously we called
      // LocalAuthentication.authenticateAsync first and then getBiometricPin,
      // which surfaced two prompts back-to-back ("Unlock wallet" followed by
      // the OS default "Scan your fingerprint" when navigating to home).
      let pin: string | null = null;
      try {
        pin = await storageService.getBiometricPin(masterKeyId, {
          authenticationPrompt: 'Unlock wallet',
        });
      } catch (authErr) {
        // User cancelled or auth failed. Don't surface as an error — user stays on PIN screen.
        console.log('ℹ️ [useWalletAuth] Biometric unlock cancelled/failed:', authErr);
        return false;
      }

      // Fall back to cached session PIN if biometric record missing (edge case:
      // biometric enabled but stored PIN was wiped). Without a PIN we can't
      // init the SDK, so refuse to unlock and let the user enter their PIN.
      if (!pin && sessionPinRef.current) {
        pin = sessionPinRef.current;
        console.log('🔍 [useWalletAuth] Using cached session PIN for SDK initialization');
      }

      if (!pin) {
        setError('Biometric unlock unavailable. Enter your PIN.');
        return false;
      }

      // CRITICAL PATH: Unlock immediately so user can navigate
      await storageService.unlockWallet();
      setIsUnlocked(true);
      updateActivity();

      console.log('✅ [useWalletAuth] Unlocked with biometric (single prompt)');

      // NON-BLOCKING: Initialize SDK in background with the already-retrieved PIN.
      // No second biometric prompt here — we already have the PIN in hand.
      const pinForInit = pin;
      (async () => {
        try {
          const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pinForInit);
          if (mnemonic) {
            const walletInfo = await storageService.getActiveWalletInfo();
            const subWalletIndex = walletInfo?.subWalletIndex ?? 0;
            const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);

            await BreezSparkService.initializeSDK(derivedMnemonic, undefined, walletInfo?.subWalletNickname, walletInfo ? { masterKeyId: walletInfo.masterKeyId, subWalletIndex: walletInfo.subWalletIndex } : undefined);

            // Cache the PIN in session for subsequent unlocks
            sessionPinRef.current = pinForInit;

            console.log('✅ [useWalletAuth] Breez SDK initialized (background biometric)');
          }
        } catch (sdkError) {
          console.warn('⚠️ [useWalletAuth] SDK initialization failed (biometric):', sdkError);
        }
      })();

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Biometric unlock failed';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [biometricAvailable, currentMasterKeyId]);

  // ========================================
  // PIN Operations
  // ========================================

  const unlock = useCallback(
    async (pin: string): Promise<boolean> => {
      try {
        setIsLoading(true);
        setError(null);

        // Verify PIN against current master key
        if (!currentMasterKeyId) {
          throw new Error('No wallet selected');
        }

        const isValid = await storageService.verifyMasterKeyPin(currentMasterKeyId, pin);
        if (!isValid) {
          const authStatus = await storageService.getPinAuthStatus(currentMasterKeyId);
          if (authStatus.isLocked) {
            setError(`PIN temporarily locked. Try again in ${Math.ceil(authStatus.remainingMs / 1000)}s.`);
          } else {
            setError('Invalid PIN');
          }
          return false;
        }

        console.log('🔵 [useWalletAuth] PIN VERIFIED - unlocking wallet immediately');

        // Cache PIN for biometric unlock SDK initialization
        sessionPinRef.current = pin;

        // CRITICAL PATH: Just unlock and return - user can navigate immediately
        await storageService.unlockWallet();
        setIsUnlocked(true);
        updateActivity();

        console.log('✅ [useWalletAuth] Unlocked with PIN - starting background init');

        // NON-BLOCKING: Initialize SDK in background so the user can navigate
        // to the home screen immediately.
        //
        // The biometric PIN is NOT written here. Writing to SecureStore with
        // requireAuthentication:true triggers an Android fingerprint dialog
        // to bind the keystore entry, and we don't want that prompt firing
        // on every unlock or right after a restore where the user never
        // opted in. The PIN is written lazily by enableBiometric() when the
        // user explicitly opts in.
        const masterKeyId = currentMasterKeyId;
        (async () => {
          try {
            // Initialize Breez SDK in background
            const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pin);
            if (mnemonic) {
              const walletInfo = await storageService.getActiveWalletInfo();
              const subWalletIndex = walletInfo?.subWalletIndex ?? 0;
              const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);

              await BreezSparkService.initializeSDK(derivedMnemonic, undefined, walletInfo?.subWalletNickname, walletInfo ? { masterKeyId: walletInfo.masterKeyId, subWalletIndex: walletInfo.subWalletIndex } : undefined);
              console.log('✅ [useWalletAuth] Breez SDK initialized (background)');
            }
          } catch (bgError) {
            console.warn('⚠️ [useWalletAuth] Background init failed:', bgError);
          }
        })();

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unlock failed';
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [currentMasterKeyId]
  );

  const lock = useCallback(async (): Promise<void> => {
    try {
      await storageService.lockWallet();
      storageService.clearMnemonicCache(); // Clear cached mnemonics for security
      sessionPinRef.current = null; // Clear cached PIN for security
      setIsUnlocked(false);
      console.log('✅ [useWalletAuth] Wallet locked');
    } catch (err) {
      console.error('❌ [useWalletAuth] Lock failed:', err);
    }
  }, []);

  const verifyPin = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!currentMasterKeyId) return false;
      return storageService.verifyMasterKeyPin(currentMasterKeyId, pin);
    },
    [currentMasterKeyId]
  );

  const getPinAuthStatus = useCallback(
    async (masterKeyId?: string): Promise<PinAuthStatus | null> => {
      const resolvedMasterKeyId = masterKeyId || currentMasterKeyId;
      if (!resolvedMasterKeyId) {
        return null;
      }

      return storageService.getPinAuthStatus(resolvedMasterKeyId);
    },
    [currentMasterKeyId]
  );

  const changePin = useCallback(
    async (_oldPin: string, _newPin: string): Promise<boolean> => {
      // TODO(security): Implement atomic PIN rotation in storageService.
      // Must decrypt with old PIN, re-encrypt with new PIN, verify round-trip,
      // and only then commit to avoid lockout/data-loss windows.
      console.log('🔵 [useWalletAuth] Change PIN (not implemented)');
      return false;
    },
    []
  );

  // ========================================
  // Wallet Selection
  // ========================================

  const selectWallet = useCallback(
    async (
      masterKeyId: string,
      subWalletIndex: number,
      pin: string
    ): Promise<boolean> => {
      try {
        setIsLoading(true);
        setError(null);

        // SECURITY: Always verify PIN when selecting via wallet selection screen
        // This is called from WalletSelectionScreen which requires re-authentication
        const isValid = await storageService.verifyMasterKeyPin(masterKeyId, pin);
        if (!isValid) {
          const authStatus = await storageService.getPinAuthStatus(masterKeyId);
          if (authStatus.isLocked) {
            setError(`PIN temporarily locked. Try again in ${Math.ceil(authStatus.remainingMs / 1000)}s.`);
          } else {
            setError('Invalid PIN');
          }
          return false;
        }

        // CRITICAL PATH: Set active wallet and unlock immediately
        await storageService.setActiveWallet(masterKeyId, subWalletIndex);
        const walletInfo = await storageService.getActiveWalletInfo();
        setActiveWalletInfo(walletInfo);
        setCurrentMasterKeyId(masterKeyId);

        // Preload cached balance/transactions so useWallet has data on first render
        const [cachedBal, cachedTxs] = await Promise.all([
          WalletCache.getCachedBalance(masterKeyId, subWalletIndex),
          WalletCache.getCachedTransactions(masterKeyId, subWalletIndex),
        ]);
        const resolvedBalance = cachedBal?.balance ?? 0;
        const resolvedTransactions = cachedTxs?.transactions ?? [];

        WalletCache.setPreloadedData(resolvedBalance, resolvedTransactions);

        // Emit wallet switch event — useWallet listens for this to update immediately
        WalletCache.emitWalletSwitch({
          masterKeyId,
          subWalletIndex,
          balance: resolvedBalance,
          transactions: resolvedTransactions,
        });

        // Cache PIN for future use
        sessionPinRef.current = pin;

        await storageService.unlockWallet();
        setIsUnlocked(true);
        updateActivity();

        console.log('✅ [useWalletAuth] Wallet selected — initializing SDK before navigation');

        // Await full SDK disconnect + reinit so HomeScreen is ready to send/receive.
        // The PIN screen stays visible during this (isLoading=true).
        const nickname = walletInfo?.subWalletNickname;
        try {
          await BreezSparkService.disconnectSDK(); // await in-flight or fresh disconnect
          const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pin);
          if (mnemonic) {
            const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);
            await BreezSparkService.initializeSDK(derivedMnemonic, undefined, nickname, { masterKeyId, subWalletIndex });
            console.log('✅ [useWalletAuth] SDK reinitialized for new wallet');
          }
        } catch (sdkError) {
          // Non-fatal — user can still navigate, SDK will be unavailable
          console.warn('⚠️ [useWalletAuth] SDK reinitialization failed:', sdkError);
        }

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to select wallet';
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [currentMasterKeyId]
  );

  const selectSubWallet = useCallback(
    async (subWalletIndex: number): Promise<boolean> => {
      try {
        setIsLoading(true);
        setError(null);

        if (!currentMasterKeyId) {
          throw new Error('No master key selected');
        }

        // Switching sub-wallet within same master key - no PIN needed for storage
        await storageService.setActiveWallet(currentMasterKeyId, subWalletIndex);
        const walletInfo = await storageService.getActiveWalletInfo();
        setActiveWalletInfo(walletInfo);
        updateActivity();

        // Preload cached balance/transactions so useWallet has data on first render
        const [cachedBal, cachedTxs] = await Promise.all([
          WalletCache.getCachedBalance(currentMasterKeyId, subWalletIndex),
          WalletCache.getCachedTransactions(currentMasterKeyId, subWalletIndex),
        ]);
        WalletCache.setPreloadedData(
          cachedBal?.balance ?? 0,
          cachedTxs?.transactions ?? [],
        );

        // Reinitialize SDK with the new sub-wallet's mnemonic
        try {
          // Use cached session PIN or biometric PIN to get mnemonic
          let pin = sessionPinRef.current;
          if (!pin) {
            pin = await storageService.getBiometricPin(currentMasterKeyId);
          }

          if (pin) {
            const mnemonic = await storageService.getMasterKeyMnemonic(currentMasterKeyId, pin);
            if (mnemonic) {
              const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);
              await BreezSparkService.disconnectSDK();
              await BreezSparkService.initializeSDK(derivedMnemonic, undefined, walletInfo?.subWalletNickname, walletInfo ? { masterKeyId: walletInfo.masterKeyId, subWalletIndex: walletInfo.subWalletIndex } : undefined);
              console.log('✅ [useWalletAuth] SDK reinitialized for sub-wallet:', subWalletIndex);
            }
          } else {
            console.warn('⚠️ [useWalletAuth] No PIN available for SDK reinit on sub-wallet switch');
          }
        } catch (sdkError) {
          console.error('❌ [useWalletAuth] SDK reinitialization failed:', sdkError);
        }

        return true;
      } catch (err) {
        console.error('❌ [useWalletAuth] selectSubWallet error:', err);
        const message = err instanceof Error ? err.message : 'Failed to switch sub-wallet';
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [currentMasterKeyId]
  );

  // ========================================
  // Session Management
  // ========================================

  const updateActivity = useCallback(() => {
    const now = Date.now();
    setLastActivity(now);
    storageService.updateActivity();

    // Reset auto-lock timer
    if (autoLockTimerRef.current) {
      global.clearTimeout(autoLockTimerRef.current);
    }

    if (autoLockTimeout > 0) {
      autoLockTimerRef.current = global.setTimeout(async () => {
        console.log('⏰ [useWalletAuth] Auto-lock triggered');
        await lock();
      }, autoLockTimeout * 1000);
    }
  }, [autoLockTimeout, lock]);

  const checkAutoLock = useCallback(async (): Promise<void> => {
    try {
      if (autoLockTimeout === 0) {
        // Auto-lock disabled
        return;
      }

      const storedLastActivity = await storageService.getLastActivity();
      const now = Date.now();
      const elapsed = (now - storedLastActivity) / 1000;

      if (elapsed > autoLockTimeout) {
        console.log('⏰ [useWalletAuth] Session expired, locking wallet');
        await lock();
      }
    } catch (err) {
      console.error('❌ [useWalletAuth] Auto-lock check failed:', err);
    }
  }, [autoLockTimeout, lock]);

  // ========================================
  // Biometric setup (lazy opt-in)
  // ========================================

  /**
   * Explicit opt-in: enable biometric unlock and store the current session PIN
   * in the auth-gated keystore. This WILL trigger one OS fingerprint prompt
   * (required to bind the Android keystore entry) — but only here, only when
   * the user deliberately opted in.
   *
   * Returns true on success, false if the user cancelled or biometric hardware
   * is unavailable.
   */
  const enableBiometric = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        setError('Biometric authentication is not set up on this device.');
        return false;
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable biometric unlock',
        cancelLabel: 'Cancel',
      });
      if (!authResult.success) {
        return false;
      }

      const masterKeyId = currentMasterKeyId;
      const pin = sessionPinRef.current;
      if (masterKeyId && pin) {
        try {
          await storageService.storeBiometricPin(masterKeyId, pin);
        } catch (storeErr) {
          console.warn('⚠️ [useWalletAuth] Failed to store biometric PIN:', storeErr);
          // Still enable the setting — the PIN will be re-stored on the next
          // unlock by the explicit opt-in path if needed.
        }
      }

      await settingsService.updateUserSettings({ biometricEnabled: true });
      setBiometricEnabled(true);
      return true;
    } catch (err) {
      console.error('❌ [useWalletAuth] enableBiometric failed:', err);
      return false;
    }
  }, [currentMasterKeyId]);

  // ========================================
  // Return Hook Value
  // ========================================

  return {
    // State
    isUnlocked,
    isLoading,
    error,
    biometricAvailable,
    biometricEnabled,
    biometricType,
    activeWalletInfo,
    currentMasterKeyId,
    lastActivity,
    autoLockTimeout,

    // Actions
    unlock,
    lock,
    verifyPin,
    changePin,
    getPinAuthStatus,
    unlockWithBiometric,
    enableBiometric,
    selectWallet,
    selectSubWallet,
    updateActivity,
    checkAutoLock,
    getSessionPin: () => sessionPinRef.current,
  };
}
