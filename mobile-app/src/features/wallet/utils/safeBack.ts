export type WalletParentRoute =
  | '/wallet/home'
  | '/wallet/settings'
  | '/wallet/settings/address-book';

export interface SafeBackRouter {
  canGoBack: () => boolean;
  back: () => void;
  replace: (route: WalletParentRoute) => void;
}

export interface SafeBackOptions {
  isRoot?: boolean;
  lockMs?: number;
  schedule?: (callback: () => void, delay: number) => unknown;
}

/** Builds a wallet back handler with a deterministic logical-parent fallback. */
export function createSafeBackHandler(
  router: SafeBackRouter,
  fallbackRoute: WalletParentRoute,
  options: SafeBackOptions = {},
): () => boolean {
  let transitionPending = false;
  const schedule = options.schedule ?? setTimeout;
  const lockMs = options.lockMs ?? 300;

  return (): boolean => {
    if (options.isRoot || transitionPending) return false;

    transitionPending = true;
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallbackRoute);
    }
    schedule(() => { transitionPending = false; }, lockMs);
    return true;
  };
}
