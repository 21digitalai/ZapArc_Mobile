// useWalletAuth Hook
// Manages wallet PIN authentication, session, and auto-lock

import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { storageService, settingsService } from '../services';
import * as BreezSparkService from '../services/breezSparkService';
import * as WalletCache from '../services/walletCacheService';
import { deriveSubWalletMnemonic } from '../utils/mnemonic';
import { createStore } from '../utils/createStore';
import type { ActiveWalletInfo } from '../features/wallet/types';
import type { PinAuthStatus } from '../services/storageService';

// =============================================================================
// Module-level session PIN cache
// =============================================================================
// Shared across every `useWalletAuth()` call site so that a PIN captured on
// PinEntryScreen is also visible to HomeScreen, SettingsScreen, BackupScreen,
// etc. Previously this was a `useRef` inside the hook body, which gave each
// screen its own isolated copy — breaking biometric opt-in from the banner
// (PIN was in PinEntryScreen's instance, banner ran on HomeScreen's) and
// session-PIN-based silent cloud-backup.
//
// The PIN is held in JS memory only — never persisted — and is cleared on
// lock(), on startup, and on initializeSessionPin() replacement. It's fine
// to live at module scope for the same reasons the mnemonic cache lives in
// storageService's in-memory cache: the JS heap dies with the app process.
let moduleSessionPin: string | null = null;

function getModuleSessionPin(): string | null {
  return moduleSessionPin;
}

function setModuleSessionPin(pin: string | null): void {
  moduleSessionPin = pin;
}

/**
 * Module-level setter usable from outside the hook (e.g. useWallet's
 * createMasterKey / importMasterKey). The session PIN normally gets set
 * by unlock()/selectWallet(), but wallet creation lands the user on the
 * home screen WITHOUT going through those paths — so without this the
 * session PIN stays null and the home biometric banner fails with
 * "Unlock your wallet with your PIN first" even though the user just set
 * one. Keep this the single writer alongside setModuleSessionPin.
 */
export function primeSessionPin(pin: string): void {
  setModuleSessionPin(pin);
}

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
  /**
   * Try to enable biometric unlock. Returns `{ ok: true }` on success
   * or `{ ok: false, reason }` with a user-presentable explanation
   * (PIN required / hardware unavailable / OS prompt cancelled /
   * keystore write failed / etc.) so the caller can surface the actual
   * cause instead of a generic "verification failed" string.
   */
  enableBiometric: () => Promise<{ ok: boolean; reason?: string }>;
  disableBiometric: () => Promise<{ ok: boolean; reason?: string }>;

  // Wallet selection
  selectWallet: (masterKeyId: string, subWalletIndex: number, pin: string) => Promise<boolean>;
  selectSubWallet: (subWalletIndex: number) => Promise<boolean>;

  // Session management
  updateActivity: () => void;
  checkAutoLock: () => Promise<void>;
  getSessionPin: () => string | null;
}

// =============================================================================
// Shared reactive view state (Phase 1)
// =============================================================================
// The auth VIEW state (unlock status, biometric flags, active wallet, …) lives
// in ONE module-level store so every screen sees the same values — fixes
// cross-screen drift (e.g. enabling biometric in Settings not reflecting on the
// PIN screen, or a wallet switch not updating another mounted consumer).
//
// IMPORTANT: this is ONLY the reactive view. All action flows (unlock / lock /
// selectWallet / biometric / auto-lock) and SDK/session-PIN sequencing are
// unchanged — they route through the singleton services + WalletCache event bus
// exactly as before. The setters below are drop-in replacements for the old
// useState setters (same names, same value signatures), so the hook body did
// not change.

const authStore = createStore<WalletAuthState>({
  isUnlocked: false,
  isLoading: true,
  error: null,
  biometricAvailable: false,
  biometricEnabled: false,
  biometricType: 'none',
  activeWalletInfo: null,
  currentMasterKeyId: null,
  lastActivity: Date.now(),
  autoLockTimeout: 900, // 15 minutes default
});

const setIsUnlocked = (v: boolean): void => authStore.setState({ isUnlocked: v });
const setIsLoading = (v: boolean): void => authStore.setState({ isLoading: v });
const setError = (v: string | null): void => authStore.setState({ error: v });
const setBiometricAvailable = (v: boolean): void => authStore.setState({ biometricAvailable: v });
const setBiometricEnabled = (v: boolean): void => authStore.setState({ biometricEnabled: v });
const setBiometricType = (v: WalletAuthState['biometricType']): void =>
  authStore.setState({ biometricType: v });
const setActiveWalletInfo = (v: ActiveWalletInfo | null): void =>
  authStore.setState({ activeWalletInfo: v });
const setCurrentMasterKeyId = (v: string | null): void =>
  authStore.setState({ currentMasterKeyId: v });
const setLastActivity = (v: number): void => authStore.setState({ lastActivity: v });
const setAutoLockTimeout = (v: number): void => authStore.setState({ autoLockTimeout: v });

// The one-time initialize runs for the first mounted consumer only; the shared
// store keeps subsequent consumers in sync without re-reading storage.
let authInitialized = false;

// =============================================================================
// Hook Implementation
// =============================================================================

export function useWalletAuth(): WalletAuthState & WalletAuthActions {
  // Reactive view state from the shared store.
  const {
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
  } = authStore.useStore();

  // Refs
  const autoLockTimerRef = useRef<ReturnType<typeof global.setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ========================================
  // Initialize
  // ========================================

  useEffect(() => {
    // Shared store: only the first mounted consumer performs the initial load.
    // Later consumers read the already-populated store. Actions keep it fresh
    // afterwards, so there's no per-screen re-init (and no isLoading flicker
    // across screens).
    if (authInitialized) return;
    authInitialized = true;

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
        const hasFacial = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        const hasIris = types.includes(LocalAuthentication.AuthenticationType.IRIS);

        // IMPORTANT: supportedAuthenticationTypesAsync() reports what the
        // HARDWARE can do, NOT what the user has enrolled. Many Android
        // phones (e.g. Samsung) report BOTH facial + fingerprint even when
        // the user only enrolled a fingerprint — and on Android, face
        // unlock is typically a weak (Class 2) biometric that the OS won't
        // use for an app-level prompt anyway. So on Android we prefer
        // fingerprint, which is what authenticateAsync / SecureStore will
        // actually prompt for. On iOS, Face ID and Touch ID are mutually
        // exclusive, so reporting facial == Face ID is correct.
        if (Platform.OS === 'android') {
          if (hasFingerprint) setBiometricType('fingerprint');
          else if (hasFacial) setBiometricType('facial');
          else if (hasIris) setBiometricType('iris');
        } else {
          if (hasFacial) setBiometricType('facial');
          else if (hasFingerprint) setBiometricType('fingerprint');
          else if (hasIris) setBiometricType('iris');
        }
      }
    } catch (err) {
      console.error('❌ [useWalletAuth] Biometric check failed:', err);
    }
  };

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
      if (!pin && getModuleSessionPin()) {
        pin = getModuleSessionPin();
        console.log('🔍 [useWalletAuth] Using cached session PIN for SDK initialization');
      }

      if (!pin) {
        // Reaching here means getBiometricPin RESOLVED to null (not threw) —
        // i.e. there is genuinely NO biometric key bound for THIS wallet's
        // masterKeyId. A user-cancelled prompt throws instead and is handled
        // in the catch above, so we can safely distinguish the two: this is
        // the keystore↔setting DRIFT case, not a cancel.
        //
        // How drift happens: `biometricEnabled` is a GLOBAL setting but the
        // biometric PIN is stored PER-WALLET. Restoring/importing a wallet
        // creates a new masterKeyId with no bound biometric PIN, while the
        // global `biometricEnabled` flag carries over from a previously
        // created wallet — so the button shows but no key exists, and the
        // SecureStore read returns null without ever prompting.
        //
        // Self-heal: flip the setting off for this state so the stale
        // biometric button disappears and the home banner re-surfaces,
        // letting the user re-enable (which binds a PIN for THIS wallet).
        // This is safe precisely because we've confirmed there's no key to
        // protect — unlike the old aggressive behaviour that disabled on a
        // mere cancel.
        console.warn('⚠️ [useWalletAuth] No biometric key bound for this wallet — disabling stale biometric flag so the user can re-enable');
        try {
          await settingsService.updateUserSettings({ biometricEnabled: false });
          setBiometricEnabled(false);
        } catch (healErr) {
          console.warn('⚠️ [useWalletAuth] Failed to reconcile biometric flag:', healErr);
        }
        setError('Biometric unlock isn’t set up for this wallet yet. Enter your PIN, then enable it from the home screen or Settings.');
        return false;
      }

      // CRITICAL PATH: Unlock immediately so user can navigate
      await storageService.unlockWallet();
      setIsUnlocked(true);
      updateActivity();

      // Cache the PIN for the rest of the session RIGHT NOW so that any
      // screen we navigate to (backup, settings toggle, sub-wallet switch)
      // can read it without a second keystore roundtrip.
      setModuleSessionPin(pin);

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

        // Cache PIN for biometric unlock SDK initialization.
        // Module-level cache is visible across every useWalletAuth() caller
        // (banner on Home, settings toggle, backup screen, ...).
        setModuleSessionPin(pin);

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
      setModuleSessionPin(null); // Clear cached PIN for security
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

        // Cache PIN for future use (module-level — shared across hook callers)
        setModuleSessionPin(pin);

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
          let pin = getModuleSessionPin();
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
   * in the auth-gated keystore.
   *
   * IMPORTANT: we do NOT call LocalAuthentication.authenticateAsync before the
   * store. On Android, SecureStore.setItemAsync with requireAuthentication:true
   * already triggers the OS biometric prompt to bind the keystore entry — that
   * single prompt IS the user's opt-in. Adding a separate authenticateAsync on
   * top caused a double prompt, and if the second prompt was cancelled we ended
   * up with biometricEnabled=true but no stored PIN — biometric unlock was then
   * permanently broken for that wallet.
   *
   * Returns true only if the PIN was actually stored AND the setting flipped.
   * Returns false (without changing the setting) on any failure.
   */
  const enableBiometric = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    try {
      setError(null);

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        const reason = !hasHardware
          ? 'This device does not have biometric hardware.'
          : 'No fingerprint or face is enrolled on this device. Add one in system Settings first.';
        setError(reason);
        return { ok: false, reason };
      }

      const masterKeyId = currentMasterKeyId;
      const pin = getModuleSessionPin();
      if (!masterKeyId || !pin) {
        // We can't enable biometric unlock without a PIN to bind to the
        // keystore entry. This should only happen if the wallet is locked
        // or the session PIN was cleared — bail without mutating settings.
        console.warn('⚠️ [useWalletAuth] enableBiometric: missing masterKeyId or session PIN, aborting', {
          hasMasterKeyId: Boolean(masterKeyId),
          hasSessionPin: Boolean(pin),
        });
        const reason = 'Unlock your wallet with your PIN first, then enable biometric.';
        setError(reason);
        return { ok: false, reason };
      }

      // The setItemAsync call below triggers the single OS biometric prompt.
      // If the user cancels, this throws and we bail WITHOUT flipping the
      // biometricEnabled setting — no broken state.
      try {
        await storageService.storeBiometricPin(masterKeyId, pin);
      } catch (storeErr) {
        console.error('❌ [useWalletAuth] enableBiometric: storeBiometricPin failed', storeErr);
        const detail = storeErr instanceof Error ? storeErr.message : String(storeErr);
        // Distinguish user-cancel (common, expected) from a real keystore
        // failure so the message we surface matches what actually happened.
        const isCancel = /cancel|UserCancel|user_cancel|biometric_canceled/i.test(detail);
        const reason = isCancel
          ? 'Biometric prompt was cancelled. Try again to enable.'
          : `Could not save the biometric key (${detail}).`;
        setError(reason);
        return { ok: false, reason };
      }

      await settingsService.updateUserSettings({ biometricEnabled: true });
      setBiometricEnabled(true);
      console.log('✅ [useWalletAuth] Biometric unlock enabled for master key:', masterKeyId);
      return { ok: true };
    } catch (err) {
      console.error('❌ [useWalletAuth] enableBiometric failed:', err);
      const reason = err instanceof Error ? err.message : 'Unknown error enabling biometric.';
      setError(reason);
      return { ok: false, reason };
    }
  }, [currentMasterKeyId]);

  /**
   * Explicit opt-out: disable biometric unlock. Clears the stored biometric
   * PIN from SecureStore for the current master key AND flips the setting off.
   * Keeping these two in lockstep prevents the previous failure mode where the
   * setting said "on" but no PIN was bound, leading to broken-state recovery.
   */
  const disableBiometric = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    try {
      setError(null);
      const masterKeyId = currentMasterKeyId;
      if (masterKeyId) {
        try {
          await storageService.deleteBiometricPin(masterKeyId);
        } catch (delErr) {
          console.warn('⚠️ [useWalletAuth] disableBiometric: deleteBiometricPin failed (continuing)', delErr);
        }
      }
      await settingsService.updateUserSettings({ biometricEnabled: false });
      setBiometricEnabled(false);
      console.log('✅ [useWalletAuth] Biometric unlock disabled');
      return { ok: true };
    } catch (err) {
      console.error('❌ [useWalletAuth] disableBiometric failed:', err);
      const reason = err instanceof Error ? err.message : 'Unknown error disabling biometric.';
      return { ok: false, reason };
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
    disableBiometric,
    selectWallet,
    selectSubWallet,
    updateActivity,
    checkAutoLock,
    getSessionPin: () => getModuleSessionPin(),
  };
}
