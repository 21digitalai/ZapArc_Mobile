import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { HomeScreen } from '../HomeScreen';

const mockGetActiveAsset = jest.fn<Promise<'BTC' | 'USDB'>, []>();
let mockPaymentListener: ((payment: any) => void) | undefined;
let mockFocusCallback: (() => void) | undefined;
let mockWalletTransactions: any[] = [];
const mockRefreshBalance = jest.fn().mockResolvedValue(undefined);
const mockRefreshTransactions = jest.fn().mockResolvedValue(undefined);
const mockGetPayment = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'dark' }),
}));

jest.mock('../../../../hooks/useWallet', () => ({
  useWallet: () => ({
    balance: 123456,
    transactions: mockWalletTransactions,
    usdbBalance: 0,
    isLoading: false,
    isConnected: false,
    refreshBalance: mockRefreshBalance,
    refreshTransactions: mockRefreshTransactions,
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

jest.mock('../../../../hooks/useLightningAddress', () => ({
  useLightningAddress: () => ({ addressInfo: null, isRegistered: false }),
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
  onPaymentReceived: jest.fn((listener) => {
    mockPaymentListener = listener;
    return () => undefined;
  }),
  getPayment: (...args: unknown[]) => mockGetPayment(...args),
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
  useFocusEffect: jest.fn((callback) => {
    mockFocusCallback = callback;
  }),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
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
    mockPaymentListener = undefined;
    mockFocusCallback = undefined;
    mockWalletTransactions = [];
    mockUseLocalSearchParams.mockReturnValue({});
    mockGetPayment.mockResolvedValue(null);
  });

  it('renders BTC quick actions while multi-asset UI is disabled', async () => {
    mockGetActiveAsset.mockResolvedValue('BTC');

    render(<HomeScreen />);

    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Receive')).toBeTruthy();
    expect(screen.getByText('Scan QR')).toBeTruthy();
  });

  it('coerces a persisted USDB tab to BTC while multi-asset UI is disabled', async () => {
    mockGetActiveAsset.mockResolvedValue('USDB');

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Balance')).toBeTruthy());
    expect(screen.getByText('Send')).toBeTruthy();
    expect(screen.getByText('Receive')).toBeTruthy();
    expect(screen.getByText('Scan QR')).toBeTruthy();
  });

  it('shows compact pending UI, refreshes on terminal state, and removes it after settlement', async () => {
    mockWalletTransactions = [{ id: 'pending-1', type: 'send', status: 'pending', amountSat: 42 }];
    mockGetActiveAsset.mockResolvedValue('BTC');
    const view = render(<HomeScreen />);

    await waitFor(() => expect(screen.getByLabelText('Pending payment')).toBeTruthy());
    await act(async () => {
      mockPaymentListener?.({ id: 'pending-1', type: 'send', status: 'pending', amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    expect(screen.queryByText('Payment sent')).toBeNull();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();

    mockWalletTransactions = [];
    view.rerender(<HomeScreen />);
    await waitFor(() => expect(screen.queryByLabelText('Pending payment')).toBeNull());
  });

  it('shows a failed outgoing event as failed, not sent', async () => {
    mockGetActiveAsset.mockResolvedValue('BTC');
    render(<HomeScreen />);

    await waitFor(() => expect(mockPaymentListener).toBeDefined());
    await act(async () => {
      mockPaymentListener?.({ id: 'failed-1', type: 'send', status: 'failed', amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText('Payment failed — balance restored')).toBeTruthy());
    expect(screen.queryByText('Payment sent')).toBeNull();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
  });

  it('deduplicates matching completed outgoing payment notifications', async () => {
    mockGetActiveAsset.mockResolvedValue('BTC');
    render(<HomeScreen />);

    await waitFor(() => expect(mockPaymentListener).toBeDefined());
    await act(async () => {
      mockPaymentListener?.({ id: 'complete-1', type: 'send', status: 'completed', amountSat: 42 });
      mockPaymentListener?.({ id: 'complete-1', type: 'send', status: 'completed', amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(mockRefreshBalance).toHaveBeenCalledTimes(2);
    expect(mockRefreshTransactions).toHaveBeenCalledTimes(2);
  });

  it('reconciles a completed payment when its event fired before Home mounted', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true',
      paymentId: 'fast-success',
      paymentAmount: '42',
    });
    mockGetPayment.mockResolvedValue({
      id: 'fast-success', type: 'send', status: 'completed', amountSat: 42,
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(mockGetPayment).toHaveBeenCalledWith('fast-success');
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
  });

  it('replaces a pending banner once when a tracked payment completes by event', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'event-success', paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(mockPaymentListener).toBeDefined());
    await act(async () => {
      mockPaymentListener?.({ id: 'event-success', type: 'send', status: 'completed', amountSat: 42 });
      mockPaymentListener?.({ id: 'event-success', type: 'send', status: 'completed', amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(screen.queryByText('Payment pending')).toBeNull();
  });

  it('reconciles a failed tracked payment when Home regains focus', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'focus-failed', paymentAmount: '42',
    });
    mockGetPayment.mockResolvedValueOnce(null).mockResolvedValue({
      id: 'focus-failed', type: 'send', status: 'failed', amountSat: 42,
    });
    render(<HomeScreen />);

    await waitFor(() => expect(mockFocusCallback).toBeDefined());
    await act(async () => {
      mockFocusCallback?.();
    });

    await waitFor(() => expect(screen.getByText('Payment failed — balance restored')).toBeTruthy());
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
  });
});
