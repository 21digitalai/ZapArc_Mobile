import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

import { HomeScreen } from '../HomeScreen';

const mockGetActiveAsset = jest.fn<Promise<'BTC' | 'USDB'>, []>();

jest.mock('../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'dark' }),
}));

jest.mock('../../../../hooks/useWallet', () => ({
  useWallet: () => ({
    balance: 123456,
    transactions: [],
    usdbBalance: 0,
    isLoading: false,
    isConnected: false,
    refreshBalance: jest.fn().mockResolvedValue(undefined),
    refreshTransactions: jest.fn().mockResolvedValue(undefined),
    getBalanceForAsset: (asset: 'BTC' | 'USDB') => (asset === 'USDB' ? 0 : 123456),
    getTransactionsForAsset: () => [],
    activeWalletInfo: { masterKeyNickname: 'Main', subWalletNickname: 'Wallet 1' },
    loadWalletData: jest.fn(),
  }),
}));

jest.mock('../../../../hooks/useWalletAuth', () => ({
  useWalletAuth: () => ({
    lock: jest.fn().mockResolvedValue(undefined),
    enableBiometric: jest.fn().mockResolvedValue(false),
  }),
}));

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'wallet.send': 'Send',
        'wallet.receive': 'Receive',
        'payments.scanQR': 'Scan QR',
        'swap.title': 'Swap',
        'home.assetTab.btc': 'BTC',
        'home.assetTab.usdb': 'USDB',
        'wallet.balance': 'Balance',
        'wallet.transactions': 'Transactions',
        'common.seeAll': 'See all',
        'wallet.noTransactions': 'No transactions yet',
        'wallet.getStarted': 'Get started by making your first payment',
        'wallet.walletFallback': 'Wallet',
        'wallet.mainWalletFallback': 'Main',
      };
      return labels[key] ?? key;
    },
  }),
}));

jest.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({
    format: (sats: number) => ({ primary: `${sats} sats`, secondary: '$0.00' }),
    formatTx: () => ({ primary: '0 sats', secondaryCompact: '$0.00' }),
    refreshSettings: jest.fn(),
    rates: { USD: 1 },
    secondaryFiatCurrency: 'USD',
  }),
}));

jest.mock('../../../../services/breezSparkService', () => ({
  onPaymentReceived: jest.fn(() => () => undefined),
}));

jest.mock('../../../../services/settingsService', () => ({
  settingsService: {
    getActiveAsset: (...args: unknown[]) => mockGetActiveAsset(...args as []),
    setActiveAsset: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../utils/walletSecurityOnboarding', () => ({
  enableNotificationsIfNeeded: jest.fn().mockResolvedValue(undefined),
  getActiveSecurityReminder: jest.fn().mockResolvedValue(null),
  dismissBiometricBanner: jest.fn().mockResolvedValue(undefined),
  dismissNotificationsBanner: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/transactionRows', () => ({
  buildTransactionRows: () => [],
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    setParams: jest.fn(),
  },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

describe('HomeScreen quick actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all four quick actions for BTC tab', async () => {
    mockGetActiveAsset.mockResolvedValue('BTC');

    render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText('Swap')).toBeTruthy();
    });

    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Receive')).toBeTruthy();
    expect(screen.getByText('Scan QR')).toBeTruthy();
  });

  it('renders all four quick actions for USDB tab with zero balance', async () => {
    mockGetActiveAsset.mockResolvedValue('USDB');

    render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText('No USDB yet')).toBeTruthy();
    });

    expect(screen.getByText('Swap')).toBeTruthy();
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Receive')).toBeTruthy();
    expect(screen.getByText('Scan QR')).toBeTruthy();
  });
});
