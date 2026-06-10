// useWallet Hook
// Manages wallet state, operations, and multi-wallet switching.
//
// `useWallet` exported from this file is the Context-backed hook — all
// callers share a single state instance. The heavy implementation lives in
// `useWalletStateInternal` below; <WalletProvider> calls it once and feeds
// the value into the context. See ../contexts/WalletContext.tsx.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
// Re-export the context hook so existing `import { useWallet } from
// '.../hooks/useWallet'` lines continue working. The import cycle here
// (this file ↔ WalletContext.tsx) is safe because both sides use the
// bindings lazily (only inside render/call-time).
export { useWallet } from '../contexts/WalletContext';
import * as LocalAuthentication from 'expo-local-authentication';
import { storageService } from '../services';
import * as BreezSparkService from '../services/breezSparkService';
import * as WalletCache from '../services/walletCacheService';
import { primeSessionPin } from './useWalletAuth';
import {
  deriveSubWalletMnemonic,
  validateMnemonic,
  generateMasterKeyNickname,
  generateSubWalletNickname,
} from '../utils/mnemonic';
import type {
  MultiWalletStorage,
  MasterKeyEntry,
  SubWalletEntry,
  ActiveWalletInfo,
  Transaction,
} from '../features/wallet/types';

// =============================================================================
// Types
// =============================================================================

type WalletAsset = 'BTC' | 'USDB';

export type TokenBalanceEntry = Record<string, unknown>;

export interface WalletState {
  // Status
  isLoading: boolean; // Initial load or no cached data
  isRefreshing: boolean; // Background refresh with cached data available
  isConnected: boolean;
  error: string | null;

  // Active wallet info
  activeWalletInfo: ActiveWalletInfo | null;
  balance: number;
  transactions: Transaction[];
  tokenBalances: TokenBalanceEntry[];
  usdbBalance: number;

  // Multi-wallet data
  masterKeys: MasterKeyEntry[];
  activeMasterKey: MasterKeyEntry | null;
  activeSubWallet: SubWalletEntry | null;
}

export interface WalletActions {
  // Wallet creation/import
  // SECURITY: providedMnemonic is REQUIRED. Passing undefined / empty used to
  // silently mint a brand-new seed inside this function, which caused a past
  // incident where the user wrote down a mnemonic shown on screen while a
  // different one was stored on device. The caller is responsible for
  // generating the seed, displaying it to the user, and passing the EXACT
  // same string here.
  createMasterKey: (pin: string, nickname: string | undefined, providedMnemonic: string) => Promise<string>;
  importMasterKey: (mnemonic: string, pin: string, nickname?: string) => Promise<string>;

  // Sub-wallet operations
  addSubWallet: (masterKeyId: string, nickname?: string) => Promise<number>;
  archiveSubWallet: (masterKeyId: string, index: number) => Promise<void>;
  restoreSubWallet: (masterKeyId: string, index: number) => Promise<void>;

  // Wallet switching
  switchWallet: (masterKeyId: string, subWalletIndex: number, pin?: string) => Promise<void>;

  // Master key operations
  deleteMasterKey: (masterKeyId: string, pin: string) => Promise<{ activeDeleted: boolean; nextActiveId: string | null }>;
  renameMasterKey: (masterKeyId: string, nickname: string) => Promise<void>;
  renameSubWallet: (masterKeyId: string, index: number, nickname: string) => Promise<void>;

  // Data loading
  loadWalletData: (silent?: boolean) => Promise<void>;

  // Balance and transactions
  refreshBalance: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  getBalanceForAsset: (asset: WalletAsset) => number;
  getTransactionsForAsset: (asset: WalletAsset) => Transaction[];

  // Optimistic local update (swap success path). Applies a delta derived
  // from the SDK's sendPayment response so the UI reflects the new state
  // instantly, without waiting for the next listPayments / getInfo poll.
  applySwapResult: (opts: {
    direction: 'BTC_TO_USDB' | 'USDB_TO_BTC';
    spent: bigint;
    received: bigint;
    tokenIdentifier: string;
    tokenDecimals: number;
    paymentId?: string;
  }) => void;

  // Payment operations
  sendPayment: (bolt11: string) => Promise<boolean>;
  receivePayment: (amountSats: number, description?: string) => Promise<string>;

  // Utility
  syncSubWalletActivity: (masterKeyId: string, subWalletIndex: number, pin: string, restorePin?: string | null) => Promise<boolean>;
  getMnemonic: (masterKeyId: string, pin: string) => Promise<string>;
  canAddSubWallet: (masterKeyId: string) => boolean;
  getAddSubWalletDisabledReason: (masterKeyId: string) => string | null;

}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Internal wallet-state hook. DO NOT call directly from screens/components —
 * they should use `useWallet()` from `contexts/WalletContext` which reads
 * from a single shared provider instance. Calling this hook directly would
 * create an isolated state copy that won't sync with the rest of the app.
 * WalletProvider is the only legitimate caller.
 */
export function useWalletStateInternal(): WalletState & WalletActions {
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(() => {
    const preloaded = WalletCache.consumePreloadedBalance();
    console.log('🏗️ [useWallet] Initial balance from preload:', preloaded);
    return preloaded ?? 0;
  });
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const preloaded = WalletCache.consumePreloadedTransactions();
    console.log('🏗️ [useWallet] Initial transactions from preload:', preloaded?.length ?? 0);
    return preloaded ?? [];
  });
  const [tokenBalances, setTokenBalances] = useState<TokenBalanceEntry[]>([]);
  const [storage, setStorage] = useState<MultiWalletStorage | null>(null);

  // Refs for stable access in callbacks without triggering identity changes
  const balanceRef = useRef(balance);
  const transactionsRef = useRef(transactions);
  const tokenBalancesRef = useRef<TokenBalanceEntry[]>(tokenBalances);
  const activeWalletInfoRef = useRef<ActiveWalletInfo | null>(null);
  // After a swap we apply an optimistic balance delta. The SDK's own sync
  // can take a few seconds to catch up; during that window a background
  // refreshBalance would otherwise read the pre-swap value from the SDK
  // and clobber the optimistic state. This ref is set to a future timestamp
  // by applySwapResult so the refresh path knows to keep the optimistic
  // view as authoritative until the SDK catches up.
  const optimisticAuthoritativeUntilRef = useRef<number>(0);

  // Refs for debouncing refresh calls to prevent redundant API calls
  // Store the promise so callers can wait for the in-progress call
  const refreshBalancePromiseRef = useRef<{ walletKey: string; promise: Promise<void> } | null>(null);
  const refreshTransactionsPromiseRef = useRef<{ walletKey: string; promise: Promise<void> } | null>(null);
  const activeWalletKeyRef = useRef<string | null>(null);
  const isSwitchingRef = useRef(false); // Guards against effect overrides during wallet switch
  const subWalletActivityCacheRef = useRef<Map<string, boolean>>(new Map());
  // Latest refresh fns, kept in a ref so the payment-event listener can call
  // them without re-subscribing every time their identity changes.
  const refreshFnsRef = useRef<{ balance: () => Promise<void>; txs: () => Promise<void> }>({
    balance: async () => {},
    txs: async () => {},
  });
  // Debounce timer so a burst of SDK events (e.g. Synced + claim succeeded)
  // collapses into a single balance/transaction refresh.
  const eventRefreshTimerRef = useRef<ReturnType<typeof global.setTimeout> | null>(null);

  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  useEffect(() => {
    tokenBalancesRef.current = tokenBalances;
  }, [tokenBalances]);

  // Derived state
  const masterKeys = useMemo(() => storage?.masterKeys ?? [], [storage]);

  const activeMasterKey = useMemo(() => {
    if (!storage) return null;
    return masterKeys.find((mk) => mk.id === storage.activeMasterKeyId) ?? null;
  }, [storage, masterKeys]);

  const activeSubWallet = useMemo(() => {
    if (!activeMasterKey || storage === null) return null;
    return (
      activeMasterKey.subWallets.find(
        (sw) => sw.index === storage.activeSubWalletIndex
      ) ?? null
    );
  }, [activeMasterKey, storage]);

  const activeWalletInfo = useMemo((): ActiveWalletInfo | null => {
    if (!activeMasterKey || !activeSubWallet) return null;
    return {
      masterKeyId: activeMasterKey.id,
      masterKeyNickname: activeMasterKey.nickname,
      subWalletIndex: activeSubWallet.index,
      subWalletNickname: activeSubWallet.nickname,
    };
  }, [activeMasterKey, activeSubWallet]);

  const getWalletKey = useCallback((walletInfo: ActiveWalletInfo | null): string | null => {
    if (!walletInfo) return null;
    return `${walletInfo.masterKeyId}:${walletInfo.subWalletIndex}`;
  }, []);

  const getSubWalletKey = useCallback((masterKeyId: string, subWalletIndex: number): string => {
    return `${masterKeyId}:${subWalletIndex}`;
  }, []);

  useEffect(() => {
    activeWalletKeyRef.current = getWalletKey(activeWalletInfo);
    activeWalletInfoRef.current = activeWalletInfo;
  }, [activeWalletInfo, getWalletKey]);

  // Track which wallet key we last loaded cache for — skip re-runs if unchanged
  const lastCacheLoadKeyRef = useRef<string | null>(null);

  // ========================================
  // Load wallet data
  // ========================================

  const loadWalletData = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      setError(null);

      const data = await storageService.loadMultiWalletStorage();
      setStorage(data);

      // Load cache for the ACTIVE wallet — always set balance/transactions
      // to prevent stale data from a previously viewed wallet persisting
      if (data?.activeMasterKeyId && data.activeSubWalletIndex !== undefined) {
        const walletKey = `${data.activeMasterKeyId}:${data.activeSubWalletIndex}`;
        console.log('📦 [useWallet] loadWalletData: active wallet =', walletKey, 'prev =', lastCacheLoadKeyRef.current);
        const walletChanged = lastCacheLoadKeyRef.current !== walletKey;
        lastCacheLoadKeyRef.current = walletKey;

        const [cachedBal, cachedTx, cachedTokens] = await Promise.all([
           WalletCache.getCachedBalance(data.activeMasterKeyId, data.activeSubWalletIndex),
           WalletCache.getCachedTransactions(data.activeMasterKeyId, data.activeSubWalletIndex),
           WalletCache.getCachedTokenBalances(data.activeMasterKeyId, data.activeSubWalletIndex),
        ]);

        console.log('📦 [useWallet] loadWalletData: setting balance =', cachedBal?.balance ?? 0, 'txns =', cachedTx?.transactions?.length ?? 0, 'tokens =', cachedTokens?.length ?? 0, 'walletChanged =', walletChanged);
        // Only overwrite in-memory state from cache when the WALLET CHANGED.
        // On same-wallet reloads (focus events, reconnects, resumes) keep
        // whatever state we already have in React memory — it's at least as
        // fresh as the cache, and may be fresher (e.g. optimistic swap
        // deltas that haven't been persisted to cache yet). Otherwise a
        // post-swap focus would clobber the optimistic USDB balance with
        // the pre-swap cached value.
        if (walletChanged) {
          setBalance(cachedBal?.balance ?? 0);
          setTransactions(cachedTx?.transactions ?? []);
          setTokenBalances((cachedTokens as TokenBalanceEntry[] | null) ?? []);
        }
      } else {
        setBalance(0);
        setTransactions([]);
        setTokenBalances([]);
      }

      if (data && BreezSparkService.isSDKInitialized()) {
        setIsConnected(true);
      }
    } catch (err) {
      console.error('❌ [useWallet] Failed to load wallet data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWalletData();
  }, [loadWalletData]);

  // ========================================
  // Wallet Creation/Import
  // ========================================

  const createMasterKey = useCallback(
    async (
      pin: string,
      nickname: string | undefined,
      providedMnemonic: string
    ): Promise<string> => {
      try {
        setIsLoading(true);
        setError(null);

        // SECURITY: NEVER generate a fallback mnemonic here. The caller must
        // pass the exact same mnemonic string that was displayed to the user.
        // Silently regenerating would cause the user to write down one phrase
        // while a different one is stored on device — funds permanently lost.
        if (
          typeof providedMnemonic !== 'string' ||
          providedMnemonic.trim().length === 0
        ) {
          throw new Error(
            'Refusing to create wallet: providedMnemonic is missing. The caller must pass the mnemonic that was shown to the user.'
          );
        }

        const mnemonic = providedMnemonic.trim().toLowerCase();
        if (!validateMnemonic(mnemonic)) {
          throw new Error('Invalid mnemonic phrase');
        }

        const keyNumber = masterKeys.length + 1;
        const name = nickname ?? generateMasterKeyNickname(keyNumber);

        const masterKeyId = await storageService.createMasterKey(
          mnemonic,
          name,
          pin
        );

        // Creation lands the user on the home screen without routing
        // through unlock()/selectWallet(), so prime the module session PIN
        // here. Otherwise the home biometric banner's "Enable" fails with
        // "Unlock your wallet with your PIN first" right after the user
        // just set one.
        primeSessionPin(pin);

        // Biometric PIN is stored lazily when the user explicitly enables
        // biometric unlock from the home banner / security settings. Eagerly
        // writing it here would trigger an OS fingerprint dialog (to bind the
        // keystore entry) even though the user never opted in.

        // Initialize Breez SDK with the new wallet's mnemonic (sub-wallet index 0)
        let sdkInitialized = false;
        try {
          const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, 0);
          await BreezSparkService.initializeSDK(derivedMnemonic, undefined, 'Main Wallet', { masterKeyId, subWalletIndex: 0 });
          sdkInitialized = true;
          console.log('✅ [useWallet] Breez SDK initialized for new wallet');
        } catch (sdkError) {
          // Log SDK error but don't fail creation - SDK may not be available in Expo Go
          console.warn('⚠️ [useWallet] SDK initialization failed:', sdkError);
        }

        await loadWalletData();

        // Mark as connected if SDK initialized - balance will be fetched by polling effect
        if (sdkInitialized) {
          setIsConnected(true);
        }

        console.log('✅ [useWallet] Master key created:', masterKeyId);

        return masterKeyId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [masterKeys.length, loadWalletData]
  );

  const importMasterKey = useCallback(
    async (
      mnemonic: string,
      pin: string,
      nickname?: string
    ): Promise<string> => {
      try {
        setIsLoading(true);
        setError(null);

        if (!validateMnemonic(mnemonic)) {
          throw new Error('Invalid mnemonic phrase');
        }

        const normalizedMnemonic = mnemonic.trim().toLowerCase();
        const keyNumber = masterKeys.length + 1;
        const name = nickname ?? generateMasterKeyNickname(keyNumber);

        const masterKeyId = await storageService.createMasterKey(
          normalizedMnemonic,
          name,
          pin
        );

        // Same as createMasterKey: prime the module session PIN so the
        // home biometric banner works immediately after restore without a
        // "Unlock your wallet with your PIN first" error.
        primeSessionPin(pin);

        // Biometric PIN is stored lazily when the user explicitly enables
        // biometric unlock from the home banner / security settings. Eagerly
        // writing it here would trigger an OS fingerprint dialog right after
        // the user finishes entering their PIN during restore.

        // Initialize Breez SDK with the imported wallet's mnemonic (sub-wallet index 0)
        let sdkInitialized = false;
        try {
          const derivedMnemonic = deriveSubWalletMnemonic(normalizedMnemonic, 0);
          await BreezSparkService.initializeSDK(derivedMnemonic, undefined, 'Main Wallet', { masterKeyId, subWalletIndex: 0 });
          sdkInitialized = true;
          console.log('✅ [useWallet] Breez SDK initialized for imported wallet');
        } catch (sdkError) {
          // Log SDK error but don't fail import - SDK may not be available in Expo Go
          console.warn('⚠️ [useWallet] SDK initialization failed:', sdkError);
        }

        await loadWalletData();

        // Mark as connected if SDK initialized - balance will be fetched by polling effect
        if (sdkInitialized) {
          setIsConnected(true);
        }

        console.log('✅ [useWallet] Master key imported:', masterKeyId);

        return masterKeyId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to import wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [masterKeys.length, loadWalletData]
  );

  // ========================================
  // Sub-Wallet Operations
  // ========================================

  const addSubWallet = useCallback(
    async (masterKeyId: string, nickname?: string): Promise<number> => {
      try {
        setIsLoading(true);
        setError(null);

        const nextIndex = await storageService.getNextSubWalletIndex(masterKeyId);

        const name = nickname ?? generateSubWalletNickname(nextIndex);
        const index = await storageService.addSubWallet(masterKeyId, name);

        await loadWalletData();
        console.log('✅ [useWallet] Sub-wallet added:', index);

        return index;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add sub-wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  const archiveSubWallet = useCallback(
    async (masterKeyId: string, index: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        await storageService.archiveSubWallet(masterKeyId, index);

        // Clear cached lightning address so pushes stop routing to this wallet
        const { clearWalletAddress } = require('../services/notificationSubscriptionService');
        await clearWalletAddress(masterKeyId, index).catch(() => {});

        await loadWalletData();

        console.log('✅ [useWallet] Sub-wallet archived:', index);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to archive sub-wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  const restoreSubWallet = useCallback(
    async (masterKeyId: string, index: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);

        await storageService.restoreSubWallet(masterKeyId, index);
        await loadWalletData();

        console.log('✅ [useWallet] Sub-wallet restored:', index);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to restore sub-wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  // ========================================
  // Wallet Switching
  // ========================================

  const switchWallet = useCallback(
    async (masterKeyId: string, subWalletIndex: number, pin?: string): Promise<void> => {
      try {
        isSwitchingRef.current = true;
        setError(null);

        // 1. Load cached data for the TARGET wallet FIRST — instant UI update
        const [cachedBalance, cachedTxs] = await Promise.all([
          WalletCache.getCachedBalance(masterKeyId, subWalletIndex),
          WalletCache.getCachedTransactions(masterKeyId, subWalletIndex)
        ]);

        if (cachedBalance) {
          console.log('✅ [useWallet] switchWallet: Loaded cached balance:', cachedBalance.balance);
          setBalance(cachedBalance.balance);
        } else {
          setBalance(0);
        }

        if (cachedTxs) {
          console.log('✅ [useWallet] switchWallet: Loaded cached transactions:', cachedTxs.transactions.length);
          setTransactions(cachedTxs.transactions);
        } else {
          setTransactions([]);
        }

        setIsConnected(false); // Disconnected until SDK re-initializes

        // 2. Update active wallet in storage
        await storageService.setActiveWallet(masterKeyId, subWalletIndex);

        // 3. Reload wallet data (updates storage/masterKeys state)
        // Mark the target wallet key so the activeWalletInfo effect skips redundant cache reload
        const targetWalletKey = `${masterKeyId}:${subWalletIndex}`;
        lastCacheLoadKeyRef.current = targetWalletKey;
        await loadWalletData();

        // 4. Reconnect Breez SDK with the new wallet's mnemonic
        if (pin) {
          try {
            const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pin);
            if (mnemonic) {
              await BreezSparkService.disconnectSDK();
              const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);
              const walletInfo = await storageService.getActiveWalletInfo();
              await BreezSparkService.initializeSDK(derivedMnemonic, undefined, walletInfo?.subWalletNickname, { masterKeyId, subWalletIndex });
              setIsConnected(true);
              console.log('✅ [useWallet] Breez SDK reconnected for switched wallet');

              // 5. Now that SDK is connected, refresh with live data
              refreshBalance();
              refreshTransactions();
            }
          } catch (sdkError) {
            console.warn('⚠️ [useWallet] SDK reconnection failed:', sdkError);
          }
        }

        console.log('✅ [useWallet] Switched to wallet:', {
          masterKeyId,
          subWalletIndex,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to switch wallet';
        setError(message);
        throw err;
      } finally {
        isSwitchingRef.current = false;
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  // ========================================
  // Master Key Operations
  // ========================================

  const deleteMasterKey = useCallback(
    async (masterKeyId: string, pin: string): Promise<{ activeDeleted: boolean; nextActiveId: string | null }> => {
      try {
        setIsLoading(true);
        setError(null);

        const isActive = masterKeyId === activeMasterKey?.id;

        // Verify PIN first
        const isValidPin = await storageService.verifyMasterKeyPin(
          masterKeyId,
          pin
        );
        if (!isValidPin) {
          throw new Error('Invalid PIN');
        }

        // If active, disconnect SDK first
        if (isActive) {
          await BreezSparkService.disconnectSDK().catch(e => console.warn('⚠️ [useWallet] Failed to disconnect SDK during delete:', e));
          setIsConnected(false);
          setBalance(0);
          setTransactions([]);
        }

        await storageService.deleteMasterKey(masterKeyId);

        // Clear all cached lightning addresses for this master key
        const { clearMasterKeyAddresses } = require('../services/notificationSubscriptionService');
        await clearMasterKeyAddresses(masterKeyId).catch(() => {});

        // Reload data to see changes
        const storageData = await storageService.loadMultiWalletStorage();
        setStorage(storageData);

        const nextActiveId = storageData?.activeMasterKeyId || null;

        console.log('✅ [useWallet] Master key deleted:', masterKeyId, {
          isActiveWasDeleted: isActive,
          nextActiveId
        });

        return { activeDeleted: isActive, nextActiveId };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [activeMasterKey?.id, loadWalletData]
  );

  const renameMasterKey = useCallback(
    async (masterKeyId: string, nickname: string): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);
        await storageService.renameMasterKey(masterKeyId, nickname);
        await loadWalletData();
        console.log('✅ [useWallet] Master key renamed:', { masterKeyId, nickname });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  const renameSubWallet = useCallback(
    async (
      masterKeyId: string,
      index: number,
      nickname: string
    ): Promise<void> => {
      try {
        setIsLoading(true);
        setError(null);
        await storageService.renameSubWallet(masterKeyId, index, nickname);
        await loadWalletData();
        console.log('✅ [useWallet] Sub-wallet renamed:', {
          masterKeyId,
          index,
          nickname,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename sub-wallet';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadWalletData]
  );

  // ========================================
  // Balance and Transactions
  // ========================================

  const refreshBalance = useCallback(async (): Promise<void> => {
    const walletInfo = await storageService.getActiveWalletInfo();
    const walletKey = getWalletKey(walletInfo);

    if (!walletInfo || !walletKey) {
      setBalance(0);
      setIsLoading(false);
      return;
    }

    // If refresh for this wallet is already in progress, reuse it.
    if (refreshBalancePromiseRef.current?.walletKey === walletKey) {
      return refreshBalancePromiseRef.current.promise;
    }

    const doRefresh = async (): Promise<void> => {
      try {
        // Load from cache first for instant display
        const cached = await WalletCache.getCachedBalance(
          walletInfo.masterKeyId,
          walletInfo.subWalletIndex
        );

        if (activeWalletKeyRef.current !== walletKey) {
          return;
        }

        if (cached) {
          setBalance(cached.balance);
          setIsLoading(false);
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }

        // Fetch fresh data from SDK
        if (!BreezSparkService.isSDKInitialized()) {
          // SDK not ready — keep current/cached balance displayed.
          // The SDK polling effect will trigger refreshBalance when SDK becomes available.
          if (activeWalletKeyRef.current === walletKey) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        const walletBalance = await BreezSparkService.getBalance();

        if (activeWalletKeyRef.current !== walletKey) {
          return;
        }

        // Honour the optimistic-authoritative window: if we recently applied
        // a swap delta, the SDK may not have caught up and would clobber
        // our fresh state with stale values. Skip SDK writes in that case.
        const optimisticWindowActive = Date.now() < optimisticAuthoritativeUntilRef.current;

        // Don't overwrite a known balance with 0 from the SDK — that's almost
        // always a transitional/unsynced read (e.g. getInfo returning 0 right
        // after the app reopens following a payment that arrived while it was
        // closed, or before an on-chain deposit is claimed).
        //
        // CRITICAL: decide using the React state-updater's `prev` value, NOT
        // `balanceRef.current`. `balanceRef` is updated in a useEffect and so
        // lags the real state by a render — under back-to-back refreshes a
        // transient 0 could slip past the guard (balanceRef still 0 while the
        // displayed balance was just set to a positive value) and reset the
        // balance to 0. Reading `prev` inside the updater is always current
        // and closes that race. We also sync `balanceRef` immediately inside
        // the updater so it never lags for any other reader.
        if (!optimisticWindowActive) {
          setBalance((prev) => {
            const next = (walletBalance.balanceSat > 0 || prev === 0)
              ? walletBalance.balanceSat
              : prev;
            balanceRef.current = next;
            return next;
          });
        }
        setIsLoading(false);
        setIsRefreshing(false);

        // Only ever persist a POSITIVE balance to cache. Caching a positive
        // value is always correct; skipping the 0 case means we never
        // overwrite a known-good cached balance with a transitional 0 (which
        // would make the wrong value flash on the next reopen).
        if (!optimisticWindowActive && walletBalance.balanceSat > 0) {
          await WalletCache.cacheBalance(
            walletInfo.masterKeyId,
            walletInfo.subWalletIndex,
            walletBalance.balanceSat
          );
        }

        // Update activity flag
        try {
          const tokenBalancesRaw = await BreezSparkService.getTokenBalances();
          // Don't overwrite a non-empty token balance with an empty array —
          // the SDK occasionally returns an empty map during mid-sync polls
          // which would otherwise flash the USDB balance to 0. Only accept
          // an empty array if the BTC balance is also 0 (genuinely empty
          // wallet) or we previously had no tokens to begin with.
          let effectiveTokens: TokenBalanceEntry[] = tokenBalancesRaw as TokenBalanceEntry[];
          setTokenBalances((prev) => {
            // During the optimistic window keep state as-is — Breez sync is
            // likely still behind and its data would set us back to a
            // pre-swap snapshot.
            if (optimisticWindowActive) {
              effectiveTokens = prev;
              return prev;
            }
            if (effectiveTokens.length === 0 && prev.length > 0 && walletBalance.balanceSat > 0) {
              effectiveTokens = prev;
              return prev;
            }
            return effectiveTokens;
          });
          // Persist to per-wallet cache so future app reopens / wallet
          // switches back here show the balance instantly.
          void WalletCache.cacheTokenBalances(
            walletInfo.masterKeyId,
            walletInfo.subWalletIndex,
            effectiveTokens as Array<Record<string, unknown>>,
          );
        } catch (tokenErr) {
          console.warn('⚠️ [useWallet] Failed to refresh token balances:', tokenErr);
        }

        const hasActivity = walletBalance.balanceSat > 0 || transactionsRef.current.length > 0;
        storageService.updateSubWalletActivity(
          walletInfo.masterKeyId,
          walletInfo.subWalletIndex,
          hasActivity
        ).catch(err => console.warn('⚠️ [useWallet] Failed to update activity:', err));
      } catch (err) {
        console.error('❌ [useWallet] Failed to refresh balance:', err);
        if (activeWalletKeyRef.current === walletKey) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      } finally {
        if (refreshBalancePromiseRef.current?.walletKey === walletKey) {
          refreshBalancePromiseRef.current = null;
        }
      }
    };

    const promise = doRefresh();
    refreshBalancePromiseRef.current = { walletKey, promise };
    return promise;
  }, [getWalletKey]);

  // Internal applier — mutates THIS useWallet instance's state. The public
  // applySwapResult below both calls this locally AND broadcasts via the
  // module-level event bus so other useWallet instances (e.g. HomeScreen's)
  // apply the same delta in lockstep. Without the broadcast, the UI lags
  // until the background refresh lands, because every component that calls
  // useWallet() has its OWN state snapshot.
  const applyDeltaLocal = useCallback((opts: {
    direction: 'BTC_TO_USDB' | 'USDB_TO_BTC';
    spent: bigint;
    received: bigint;
    tokenIdentifier: string;
    tokenDecimals: number;
    paymentId?: string;
  }): void => {
    const { direction, spent, received, tokenIdentifier, tokenDecimals, paymentId } = opts;

    // Balance deltas:
    //   BTC_TO_USDB: BTC balance -= spent (sats), USDB += received (base)
    //   USDB_TO_BTC: USDB balance -= spent (base), BTC += received (sats)
    if (direction === 'BTC_TO_USDB') {
      setBalance((prev) => Math.max(0, prev - Number(spent)));
      setTokenBalances((prev) => {
        const existingIdx = prev.findIndex((e) => {
          const r = e as Record<string, unknown>;
          const id = String(r.tokenIdentifier || (r.tokenMetadata as any)?.identifier || '').trim();
          return id === tokenIdentifier;
        });
        if (existingIdx >= 0) {
          const existing = prev[existingIdx] as Record<string, unknown>;
          const prevBalRaw = existing.balance;
          const prevBal = typeof prevBalRaw === 'bigint'
            ? prevBalRaw
            : BigInt(String(prevBalRaw ?? '0'));
          const next = [...prev];
          next[existingIdx] = { ...existing, balance: prevBal + received } as TokenBalanceEntry;
          return next;
        }
        // First-time receive — synthesize a minimal entry. It'll be
        // replaced with the full SDK shape on the next refresh.
        return [
          ...prev,
          {
            balance: received,
            tokenIdentifier,
            ticker: 'USDB',
            decimals: tokenDecimals,
            tokenMetadata: { identifier: tokenIdentifier, ticker: 'USDB', decimals: tokenDecimals },
          } as unknown as TokenBalanceEntry,
        ];
      });
    } else {
      // USDB → BTC
      setBalance((prev) => prev + Number(received));
      setTokenBalances((prev) => {
        const existingIdx = prev.findIndex((e) => {
          const r = e as Record<string, unknown>;
          const id = String(r.tokenIdentifier || (r.tokenMetadata as any)?.identifier || '').trim();
          return id === tokenIdentifier;
        });
        if (existingIdx < 0) return prev;
        const existing = prev[existingIdx] as Record<string, unknown>;
        const prevBalRaw = existing.balance;
        const prevBal = typeof prevBalRaw === 'bigint'
          ? prevBalRaw
          : BigInt(String(prevBalRaw ?? '0'));
        const nextBal = prevBal > spent ? prevBal - spent : 0n;
        const next = [...prev];
        next[existingIdx] = { ...existing, balance: nextBal } as TokenBalanceEntry;
        return next;
      });
    }

    // Insert an optimistic transaction at the top of the list. The next
    // refreshTransactions() will replace it with the SDK's canonical row.
    const optimisticTx: Transaction = {
      id: paymentId || `pending-swap-${Date.now()}`,
      type: 'receive', // From user's POV: they receive the destination asset
      amount: direction === 'BTC_TO_USDB' ? Number(received) : Number(received),
      feeSats: 0,
      status: 'completed',
      timestamp: Date.now(),
      description: direction === 'BTC_TO_USDB' ? 'BTC → USDB swap' : 'USDB → BTC swap',
      method: 'lightning',
      paymentType: 'conversion',
      asset: direction === 'BTC_TO_USDB' ? 'USDB' : 'BTC',
      tokenIdentifier: direction === 'BTC_TO_USDB' ? tokenIdentifier : undefined,
      kind: 'swap',
      swap: {
        direction,
        fromAsset: direction === 'BTC_TO_USDB' ? 'BTC' : 'USDB',
        fromAmount: Number(spent),
        toAsset: direction === 'BTC_TO_USDB' ? 'USDB' : 'BTC',
        toAmount: Number(received),
      },
    } as Transaction;
    setTransactions((prev) => {
      // If the id already exists (SDK sync landed first), skip.
      if (paymentId && prev.some((t) => t.id === paymentId)) return prev;
      return [optimisticTx, ...prev];
    });

    // Mark optimistic state as authoritative for the next 30 seconds so
    // refreshBalance() doesn't overwrite it with stale pre-swap SDK data.
    optimisticAuthoritativeUntilRef.current = Date.now() + 30_000;

    // Persist the post-swap state to per-wallet caches so a later focus /
    // reload doesn't read the pre-swap cached values. Fire-and-forget —
    // UI is already updated via React state.
    const walletInfo = activeWalletInfoRef.current;
    if (walletInfo) {
      // Use latest in-memory state by reading refs AFTER the state setters
      // have scheduled updates. We reconstruct the expected post-swap
      // snapshots directly from the delta so we don't have to wait for
      // the state updates to flush.
      const nextBtcBalance = direction === 'BTC_TO_USDB'
        ? Math.max(0, balanceRef.current - Number(spent))
        : balanceRef.current + Number(received);
      void WalletCache.cacheBalance(walletInfo.masterKeyId, walletInfo.subWalletIndex, nextBtcBalance);
      // Rebuild tokenBalances snapshot from current state + delta for cache.
      const prevTokens = tokenBalancesRef.current;
      let updatedTokens: TokenBalanceEntry[];
      const idx = prevTokens.findIndex((e) => {
        const r = e as Record<string, unknown>;
        const id = String(r.tokenIdentifier || (r.tokenMetadata as any)?.identifier || '').trim();
        return id === tokenIdentifier;
      });
      if (direction === 'BTC_TO_USDB') {
        if (idx >= 0) {
          const existing = prevTokens[idx] as Record<string, unknown>;
          const prevBal = typeof existing.balance === 'bigint'
            ? (existing.balance as bigint)
            : BigInt(String(existing.balance ?? '0'));
          const copy = [...prevTokens];
          copy[idx] = { ...existing, balance: prevBal + received } as TokenBalanceEntry;
          updatedTokens = copy;
        } else {
          updatedTokens = [
            ...prevTokens,
            {
              balance: received,
              tokenIdentifier,
              ticker: 'USDB',
              decimals: tokenDecimals,
              tokenMetadata: { identifier: tokenIdentifier, ticker: 'USDB', decimals: tokenDecimals },
            } as unknown as TokenBalanceEntry,
          ];
        }
      } else if (idx >= 0) {
        const existing = prevTokens[idx] as Record<string, unknown>;
        const prevBal = typeof existing.balance === 'bigint'
          ? (existing.balance as bigint)
          : BigInt(String(existing.balance ?? '0'));
        const nextBal = prevBal > spent ? prevBal - spent : 0n;
        const copy = [...prevTokens];
        copy[idx] = { ...existing, balance: nextBal } as TokenBalanceEntry;
        updatedTokens = copy;
      } else {
        updatedTokens = prevTokens;
      }
      void WalletCache.cacheTokenBalances(
        walletInfo.masterKeyId,
        walletInfo.subWalletIndex,
        updatedTokens as Array<Record<string, unknown>>,
      );
    }
  }, []);

  // Public applier — with shared Context state, updating this single owner
  // propagates to every consumer (via React re-render). No event bus needed.
  const applySwapResult = applyDeltaLocal;

  const refreshTransactions = useCallback(async (): Promise<void> => {
    const walletInfo = await storageService.getActiveWalletInfo();
    const walletKey = getWalletKey(walletInfo);

    if (!walletInfo || !walletKey) {
      setTransactions([]);
      return;
    }

    // If refresh for this wallet is already in progress, reuse it.
    if (refreshTransactionsPromiseRef.current?.walletKey === walletKey) {
      return refreshTransactionsPromiseRef.current.promise;
    }

    const doRefresh = async (): Promise<void> => {
      try {
        // Load from cache first for instant display
        const cached = await WalletCache.getCachedTransactions(
          walletInfo.masterKeyId,
          walletInfo.subWalletIndex
        );

        if (activeWalletKeyRef.current !== walletKey) {
          return;
        }

        if (cached) {
          setTransactions(cached.transactions);
          setIsRefreshing(true);
        }

        // Fetch fresh data from SDK
        const sdkInitialized = BreezSparkService.isSDKInitialized();

        if (!sdkInitialized) {
          // SDK not ready — keep current/cached transactions displayed.
          if (activeWalletKeyRef.current === walletKey) {
            setIsRefreshing(false);
          }
          return;
        }

        const payments = await BreezSparkService.listPayments();

        // Map TransactionInfo to Transaction type
        const txs: Transaction[] = payments.map((p) => ({
          id: p.id,
          type: p.type,
          amount: p.amountSat,
          feeSats: p.feeSat,
          status: p.status,
          timestamp: p.timestamp,
          description: p.description,
          method: p.method,
          txid: p.txid,
          paymentType: p.paymentType,
          asset: p.asset,
          tokenIdentifier: p.tokenIdentifier,
          kind: p.kind,
          swap: p.swap,
        }));

        if (activeWalletKeyRef.current !== walletKey) {
          return;
        }

        setTransactions(txs);
        setIsRefreshing(false);

        // Update cache with fresh data
        await WalletCache.cacheTransactions(
          walletInfo.masterKeyId,
          walletInfo.subWalletIndex,
          txs
        );

        // Update activity flag
        const hasActivity = txs.length > 0 || balanceRef.current > 0;
        storageService.updateSubWalletActivity(
          walletInfo.masterKeyId,
          walletInfo.subWalletIndex,
          hasActivity
        ).catch(err => console.warn('⚠️ [useWallet] Failed to update activity:', err));
      } catch (err) {
        console.error('❌ [useWallet] Failed to refresh transactions:', err);
        if (activeWalletKeyRef.current === walletKey) {
          setIsRefreshing(false);
        }
      } finally {
        if (refreshTransactionsPromiseRef.current?.walletKey === walletKey) {
          refreshTransactionsPromiseRef.current = null;
        }
      }
    };

    const promise = doRefresh();
    refreshTransactionsPromiseRef.current = { walletKey, promise };
    return promise;
  }, [getWalletKey]);

  // ========================================
  // Cache Loading Trigger
  // ========================================

  // Load wallet-specific cache and refresh whenever the active wallet changes in storage.
  useEffect(() => {
    if (!activeWalletInfo) return;

    const walletKey = getWalletKey(activeWalletInfo);
    if (walletKey === lastCacheLoadKeyRef.current) {
      // Same wallet — already handled (by switchWallet or previous run)
      return;
    }
    lastCacheLoadKeyRef.current = walletKey;

    // If switchWallet is in progress, it handles cache loading — skip to avoid override
    if (isSwitchingRef.current) {
      return;
    }

    // Prevent stale in-flight requests from a previous wallet from writing into state.
    refreshBalancePromiseRef.current = null;
    refreshTransactionsPromiseRef.current = null;
    setIsRefreshing(false);

    let isCancelled = false;

    const loadCachedAndRefresh = async (): Promise<void> => {
      try {
        const [cachedBalance, cachedTxs] = await Promise.all([
          WalletCache.getCachedBalance(activeWalletInfo.masterKeyId, activeWalletInfo.subWalletIndex),
          WalletCache.getCachedTransactions(activeWalletInfo.masterKeyId, activeWalletInfo.subWalletIndex),
        ]);

        if (isCancelled || isSwitchingRef.current) return;

        // Always set balance/transactions for the active wallet — clear stale data from previous wallet
        setBalance(cachedBalance?.balance ?? 0);
        setTransactions(cachedTxs?.transactions ?? []);

        setIsLoading(false);
        setIsRefreshing(true);
      } catch (cacheError) {
        console.warn('⚠️ [useWallet] Failed to load cached wallet data:', cacheError);
      } finally {
        if (!isCancelled && !isSwitchingRef.current) {
          refreshBalance();
          refreshTransactions();
        }
      }
    };

    loadCachedAndRefresh();

    return () => {
      isCancelled = true;
    };
  }, [activeWalletInfo, refreshBalance, refreshTransactions]);

  // ========================================
  // Real-time Payment Event Listener
  // ========================================
  //
  // Subscribe to the Breez/Spark `onPaymentReceived` event so that an
  // incoming payment is credited to the displayed balance immediately,
  // and — crucially — protect that credit from being clobbered by a
  // stale `getBalance()` read.
  //
  // Why the window matters: the Spark operator commits new deposits
  // asynchronously. Between the moment the SDK fires the event ("here's
  // a 250-sat receive") and the moment a follow-up `getBalance()` query
  // returns the new total, there's a window (seconds-to-minutes) during
  // which the operator still reports the *pre-deposit* balance. A
  // routine `refreshBalance()` triggered by focus / navigation in that
  // window would write the stale value over the optimistic credit and
  // make the user's balance momentarily "disappear" — observed in
  // production for users receiving their very first Lightning payment
  // (BTC: 0 → 250 → 0 → 250 after ~5 min).
  //
  // The fix: when the event fires, (a) apply the delta locally and
  // (b) hold `optimisticAuthoritativeUntilRef` for 60 s so the guard at
  // lines ~748 / ~776 refuses to overwrite the balance with a lower SDK
  // value during the window. After the window expires the SDK is the
  // authority again and any genuine subsequent changes converge.
  // Keep the refresh-fns ref pointing at the latest callbacks.
  useEffect(() => {
    refreshFnsRef.current = { balance: refreshBalance, txs: refreshTransactions };
  }, [refreshBalance, refreshTransactions]);

  useEffect(() => {
    if (!isConnected) return;

    // Coalesce a burst of events into one refresh. We ALWAYS reconcile
    // against the SDK after any event — the optimistic bump below is just
    // for instant UX; this is what makes the balance actually settle to
    // the real value (and is the ONLY path that updates the UI after an
    // on-chain deposit is auto-claimed, which arrives as a sync event with
    // no amount). `delayMs` lets us wait briefly for the Spark operator to
    // commit before reading getInfo.
    const scheduleRefresh = (delayMs: number): void => {
      if (eventRefreshTimerRef.current) clearTimeout(eventRefreshTimerRef.current);
      eventRefreshTimerRef.current = global.setTimeout(() => {
        eventRefreshTimerRef.current = null;
        void refreshFnsRef.current.balance();
        void refreshFnsRef.current.txs();
      }, delayMs);
    };

    const unsubscribe = BreezSparkService.onPaymentReceived((payment) => {
      // Sync / claim-succeeded probe events carry no amount. They're our
      // signal that the SDK state changed (most importantly: an on-chain
      // deposit was just claimed into the balance) — reconcile from the
      // SDK. The optimistic window is NOT set here, so the refresh reads
      // the fresh balance directly.
      if (payment.description === '__SYNC_EVENT__') {
        scheduleRefresh(800);
        return;
      }
      // Only credit RECEIVED payments. Sends are debited synchronously
      // by the send flow + the operator commits spends atomically, so
      // the race only affects receives.
      if (payment.type !== 'receive' || payment.amountSat <= 0) {
        // Still reconcile for any other non-receive event shape.
        scheduleRefresh(800);
        return;
      }

      const isUsdb = payment.asset === 'USDB';

      if (isUsdb && payment.tokenIdentifier) {
        // USDB receives: payment.amountSat carries the token amount in
        // base units (see service docs); add it to the matching token
        // entry, or synthesise a minimal row if this is a first-time
        // receive (the next refresh fills in the full SDK shape).
        const tokenId = payment.tokenIdentifier;
        const delta = BigInt(payment.amountSat);
        setTokenBalances((prev) => {
          const idx = prev.findIndex((e) => {
            const r = e as Record<string, unknown>;
            const id = String(r.tokenIdentifier || (r.tokenMetadata as any)?.identifier || '').trim();
            return id === tokenId;
          });
          if (idx >= 0) {
            const existing = prev[idx] as Record<string, unknown>;
            const prevBal = typeof existing.balance === 'bigint'
              ? existing.balance
              : BigInt(String(existing.balance ?? '0'));
            const next = [...prev];
            next[idx] = { ...existing, balance: prevBal + delta } as TokenBalanceEntry;
            return next;
          }
          return [
            ...prev,
            {
              balance: delta,
              tokenIdentifier: tokenId,
              ticker: 'USDB',
              decimals: 6,
              tokenMetadata: { identifier: tokenId, ticker: 'USDB', decimals: 6 },
            } as unknown as TokenBalanceEntry,
          ];
        });
      } else {
        // BTC receive — increment the displayed sat balance. Even if a
        // stale `refreshBalance()` already overwrote us with the pre-
        // deposit total, this `prev + amountSat` re-credits the delta.
        // Double-counting against a *fresh* refresh is impossible because
        // the SDK can't return the post-deposit balance before it has
        // observed (and emitted the event for) the deposit.
        setBalance((prev) => prev + payment.amountSat);
      }

      optimisticAuthoritativeUntilRef.current = Date.now() + 60_000;

      // Reconcile against the SDK shortly after the optimistic bump so the
      // transaction list picks up the new payment and the canonical balance
      // settles. The optimistic window above protects the bumped value from
      // being clobbered by a still-lagging operator read.
      scheduleRefresh(1500);
    });

    return () => {
      unsubscribe();
      if (eventRefreshTimerRef.current) {
        clearTimeout(eventRefreshTimerRef.current);
        eventRefreshTimerRef.current = null;
      }
    };
  }, [isConnected]);

  // ========================================
  // SDK Connection StatusSync
  // ========================================

  // Poll for SDK status changes (handles async initialization from useWalletAuth)
  // This ensures balance loads after SDK becomes available
  useEffect(() => {
    let isMounted = true;
    let interval: ReturnType<typeof global.setInterval> | null = null;

    const checkAndSync = async (): Promise<void> => {
      try {
        if (!isMounted) return;

        const sdkInitialized = BreezSparkService.isSDKInitialized();

        if (sdkInitialized && !isConnected && isMounted) {
          console.log('🔌 [useWallet] SDK became available, setting connected and refreshing...');
          setIsConnected(true);
          // Refresh balance and transactions when SDK becomes available
          try {
            await refreshBalance();
            await refreshTransactions();
            console.log('✅ [useWallet] Post-SDK-connect refresh complete');
          } catch (refreshError) {
            console.error('❌ [useWallet] Refresh error in SDK sync:', refreshError);
          }
        } else if (!sdkInitialized && isConnected && isMounted) {
          console.log('⚠️ [useWallet] SDK disconnected');
          setIsConnected(false);
        }
      } catch (error) {
        console.error('❌ [useWallet] SDK sync check error:', error);
      }
    };

    // Initial check with error handling
    checkAndSync().catch(err => {
      console.error('❌ [useWallet] Initial SDK sync error:', err);
    });

    // Poll every 500ms until SDK is initialized
    try {
      interval = global.setInterval(() => {
        if (!isConnected && isMounted) {
          checkAndSync().catch(err => {
            console.error('❌ [useWallet] Polling SDK sync error:', err);
          });
        }
      }, 500);
    } catch (error) {
      console.error('❌ [useWallet] Failed to start SDK polling:', error);
    }

    return (): void => {
      isMounted = false;
      if (interval) {
        try {
          global.clearInterval(interval);
        } catch (error) {
          console.error('❌ [useWallet] Interval cleanup error:', error);
        }
      }
    };
  }, [isConnected, refreshBalance, refreshTransactions]);

  // ========================================
  // Payment Operations
  // ========================================

  const sendPayment = useCallback(
    async (bolt11: string): Promise<boolean> => {
      try {
        setIsLoading(true);
        setError(null);

        console.log('🔵 [sendPayment] Starting payment...');
        const result = await BreezSparkService.payInvoice(bolt11);
        
        if (!result.success) {
          console.log('❌ [sendPayment] Payment failed:', result.error);
          return false;
        }

        console.log('✅ [sendPayment] Payment successful, paymentId:', result.paymentId);
        
        // Refresh balance and transactions
        console.log('🔄 [sendPayment] Refreshing balance...');
        await refreshBalance();
        
        console.log('🔄 [sendPayment] Refreshing transactions...');
        await refreshTransactions();
        
        console.log('✅ [sendPayment] All refreshes complete');
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Payment failed';
        console.error('❌ [sendPayment] Error:', message);
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [refreshBalance, refreshTransactions]
  );

  const receivePayment = useCallback(
    async (amountSats: number, description?: string): Promise<string> => {
      try {
        setIsLoading(true);
        setError(null);

        const result = await BreezSparkService.receivePayment(
          amountSats,
          description
        );

        return result.paymentRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate invoice';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ========================================
  // Utility Functions
  // ========================================

  const getMnemonic = useCallback(
    async (masterKeyId: string, pin: string): Promise<string> => {
      const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pin);
      if (!mnemonic) {
        throw new Error('Failed to get mnemonic');
      }
      return mnemonic;
    },
    []
  );



  const getAddSubWalletDisabledReason = useCallback(
    (masterKeyId: string): string | null => {
      const masterKey = masterKeys.find((mk) => mk.id === masterKeyId);
      if (!masterKey) return 'Wallet not found';

      // Check limit
      const totalIndices = [
        ...masterKey.subWallets.map((sw) => sw.index),
        ...masterKey.archivedSubWallets.map((sw) => sw.index),
      ];
      if (totalIndices.length >= 20) {
        return 'Maximum number of sub-wallets reached';
      }

      // Check if last sub-wallet has activity
      const lastSubWallet =
        masterKey.subWallets[masterKey.subWallets.length - 1];
      
      if (!lastSubWallet) return null; // No sub-wallets yet, allowed

      // Check if we are connected to this last sub-wallet
      const isConnectedToLast = activeWalletInfo &&
                                activeWalletInfo.masterKeyId === masterKeyId &&
                                activeWalletInfo.subWalletIndex === lastSubWallet.index;

      if (isConnectedToLast) {
         // First check cached value - if we know it has activity, enable immediately
         if (lastSubWallet.hasActivity === true) {
           return null;
         }
         
         // Then check real-time state (more up-to-date than cache)
         const hasActivity = balance > 0 || transactions.length > 0;
         if (hasActivity) return null;
         
         const name = lastSubWallet.nickname || 'Last sub-wallet';
         return `${name} must have transactions before adding another`;
      }

      // Not connected to last sub-wallet - use stored flag
      // Strict Policy: Only allow if explicitly true
      if (lastSubWallet.hasActivity === true) {
        return null;
      }
      
      const name = lastSubWallet.nickname || 'Last sub-wallet';
      return `${name} must have transactions before adding another`;
    },
    [masterKeys, activeWalletInfo, balance, transactions]
  );

  /**
   * Background sync activity for a specific sub-wallet
   * This is used to determine if a sub-wallet has had any activity
   * so we can enable/disable the "Add Sub-Wallet" button.
   */
  const syncSubWalletActivity = useCallback(
    async (
      masterKeyId: string,
      subWalletIndex: number,
      pin: string,
      restorePin?: string | null
    ): Promise<boolean> => {
      const cacheKey = getSubWalletKey(masterKeyId, subWalletIndex);
      const cachedResult = subWalletActivityCacheRef.current.get(cacheKey);

      if (cachedResult !== undefined) {
        return cachedResult;
      }

      const knownMasterKey = masterKeys.find((mk) => mk.id === masterKeyId);
      const knownSubWallet = knownMasterKey?.subWallets.find((sw) => sw.index === subWalletIndex);

      if (knownSubWallet?.hasActivity !== undefined) {
        subWalletActivityCacheRef.current.set(cacheKey, knownSubWallet.hasActivity);
        return knownSubWallet.hasActivity;
      }

      console.log('🔄 [useWallet] Syncing sub-wallet activity:', {
        masterKeyId,
        subWalletIndex,
      });

      try {
        // 1. Get mnemonic for the target master key
        const mnemonic = await storageService.getMasterKeyMnemonic(masterKeyId, pin);
        if (!mnemonic) return false;

        // 2. Identify current connection to restore later
        const originalWallet = await storageService.getActiveWalletInfo();

        // 3. Derive target mnemonic and initialize SDK
        const derivedMnemonic = deriveSubWalletMnemonic(mnemonic, subWalletIndex);
        
        // Disconnect current
        await BreezSparkService.disconnectSDK().catch(() => {});
        
        // Initialize target
        await BreezSparkService.initializeSDK(derivedMnemonic); // Temp connection for activity check - no notification registration needed
        
        // 4. Fetch transactions
        const payments = await BreezSparkService.listPayments();
        const hasActivity = payments.length > 0;

        // 5. Update cache + storage
        subWalletActivityCacheRef.current.set(cacheKey, hasActivity);
        await storageService.updateSubWalletActivity(masterKeyId, subWalletIndex, hasActivity);
        await loadWalletData(); // Refresh local state

        // 6. Restore original connection
        if (originalWallet && (restorePin || pin)) {
          try {
            // Use restorePin if provided, otherwise fall back to current pin (if it was same wallet)
            const rPin = restorePin || pin;
            const orgMnemonic = await storageService.getMasterKeyMnemonic(originalWallet.masterKeyId, rPin);
            if (orgMnemonic) {
              const orgDerived = deriveSubWalletMnemonic(orgMnemonic, originalWallet.subWalletIndex);
              await BreezSparkService.disconnectSDK().catch(() => {});
              await BreezSparkService.initializeSDK(orgDerived, undefined, originalWallet.subWalletNickname, { masterKeyId: originalWallet.masterKeyId, subWalletIndex: originalWallet.subWalletIndex });
              console.log('✅ [useWallet] Restored original wallet connection');
            }
          } catch (restoreError) {
            console.warn('⚠️ [useWallet] Failed to restore original connection after sync:', restoreError);
          }
        }

        return hasActivity;
      } catch (err) {
        console.warn('⚠️ [useWallet] syncSubWalletActivity failed:', err);
        return false;
      }
    },
    [getSubWalletKey, loadWalletData, masterKeys]
  );



  const usdbBalance = useMemo((): number => {
    // Breez SDK token balance entries use `tokenIdentifier` (bech32 btkn1…).
    // Ticker/symbol may or may not be populated depending on metadata. Prefer
    // identifier match against our env-configured USDB token, fall back to
    // ticker match for robustness.
    const envUsdbId = (process.env.EXPO_PUBLIC_USDB_TOKEN_IDENTIFIER || '').trim();

    const usdb = tokenBalances.find((raw) => {
      const entry = raw as Record<string, unknown>;
      // Breez shape: { tokenMetadata: { identifier, ticker, decimals, ... }, balance }
      const meta = (entry.tokenMetadata || entry.metadata || entry.token || entry) as Record<string, unknown>;
      const id = String(meta.identifier || meta.tokenIdentifier || meta.id || entry.tokenIdentifier || entry.identifier || '').trim();
      if (envUsdbId && id === envUsdbId) return true;
      const ticker = String(meta.ticker || meta.symbol || entry.ticker || entry.symbol || '').toUpperCase();
      return ticker === 'USDB';
    }) as Record<string, unknown> | undefined;

    if (!usdb) return 0;

    const meta = (usdb.tokenMetadata || usdb.metadata || usdb.token || usdb) as Record<string, unknown>;
    const raw = usdb.balance ?? usdb.amount ?? usdb.baseUnits ?? meta.balance ?? 0;
    const decimalsRaw = meta.decimals ?? usdb.decimals;
    const decimals = Number(decimalsRaw);
    const n = typeof raw === 'bigint' ? Number(raw) : Number(raw);
    if (!Number.isFinite(n)) return 0;
    if (Number.isFinite(decimals) && decimals >= 0) {
      return n / (10 ** decimals);
    }
    return n;
  }, [tokenBalances]);

  const getBalanceForAsset = useCallback((asset: WalletAsset): number => {
    return asset === 'USDB' ? usdbBalance : balance;
  }, [balance, usdbBalance]);

  const getTransactionsForAsset = useCallback((asset: WalletAsset): Transaction[] => {
    if (asset === 'BTC') return transactions;
    return transactions.filter((tx) => {
      const paymentType = String(tx.paymentType || '').toLowerCase();
      return tx.asset === 'USDB' || paymentType === 'conversion' || paymentType === 'spark';
    });
  }, [transactions]);

  const canAddSubWallet = useCallback(
    (masterKeyId: string): boolean => {
      return getAddSubWalletDisabledReason(masterKeyId) === null;
    },
    [getAddSubWalletDisabledReason]
  );

  // ========================================
  // Return Hook Value
  // ========================================



  return {
    // State
    isLoading,
    isRefreshing,
    isConnected,
    error,
    activeWalletInfo,
    balance,
    transactions,
    tokenBalances,
    usdbBalance,
    masterKeys,
    activeMasterKey,
    activeSubWallet,

    // Actions
    createMasterKey,
    importMasterKey,
    addSubWallet,
    archiveSubWallet,
    restoreSubWallet,
    switchWallet,
    deleteMasterKey,
    renameMasterKey,
    renameSubWallet,
    refreshBalance,
    refreshTransactions,
    applySwapResult,
    getBalanceForAsset,
    getTransactionsForAsset,
    sendPayment,
    receivePayment,
    syncSubWalletActivity,
    getMnemonic,
    canAddSubWallet,
    getAddSubWalletDisabledReason,
    loadWalletData,

  };
}
