// WalletContext
// Single shared provider around the heavy useWalletStateInternal hook so
// every screen sees the same balance / transactions / token balances / auth
// state. Previously each call to `useWallet()` created its own isolated
// state instance, which forced us to use module-level event buses to keep
// them in sync. With a Context there's exactly ONE state owner and all
// consumers update together.
//
// Mount <WalletProvider> at the root of the authenticated tree. Screens
// access state via `useWallet()` — signature unchanged so no call-site
// edits are needed.

import React, { createContext, useContext, type ReactNode } from 'react';
import {
  useWalletStateInternal,
  type WalletState,
  type WalletActions,
} from '../hooks/useWallet';

type WalletContextValue = WalletState & WalletActions;

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const value = useWalletStateInternal();
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/**
 * Access wallet state + actions. MUST be called inside a `<WalletProvider>`.
 * Returns the same object shape the old `useWallet` hook exposed, so existing
 * call sites don't need changes.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet called outside of <WalletProvider>. Mount the provider at the app root.');
  }
  return ctx;
}
