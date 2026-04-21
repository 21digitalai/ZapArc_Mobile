// Hooks index - exports all custom hooks

// User and app authentication
export * from './useUser';
export * from './useAuth';
export * from './useGoogleAuth';

// Wallet hooks
// useWallet goes through the Context so every consumer shares one state.
// The internal implementation is in ./useWallet (re-exported here for types +
// the internal hook used by WalletProvider).
export * from './useWallet';
// Override the bare `useWallet` re-export above with the Context-backed one
// so every caller reads the same shared state.
export { useWallet } from '../contexts/WalletContext';
export { WalletProvider } from '../contexts/WalletContext';
export * from './useWalletAuth';
export * from './useSwap';

// Language and i18n
export * from './useLanguage';

// Settings
export * from './useSettings';

// Lightning Address
export * from './useLightningAddress';

// Theme
export * from './useTheme';

// Offline and sync
export * from './useOfflineSync';

// Ads
export * from './useAds';
