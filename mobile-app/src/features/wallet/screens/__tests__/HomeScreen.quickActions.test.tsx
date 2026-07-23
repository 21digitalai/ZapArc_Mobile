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
    mockGetActiveAsset.mockResolvedValue('BTC');
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

  it('keeps the inline pending row through refresh until the terminal toast handoff', async () => {
    jest.useFakeTimers();
    mockWalletTransactions = [{ id: 'pending-1', type: 'send', status: 'pending', amount: 42 }];
    mockGetActiveAsset.mockResolvedValue('BTC');
    const view = render(<HomeScreen />);

    await waitFor(() => expect(screen.getByLabelText('Pending payment')).toBeTruthy());
    expect(screen.getByText('⏳ Pending • 42 sats')).toBeTruthy();
    await act(async () => {
      mockPaymentListener?.({ id: 'pending-1', type: 'send', status: 'pending', amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    expect(screen.queryByText('Payment sent')).toBeNull();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();

    mockWalletTransactions = [];
    view.rerender(<HomeScreen />);
    expect(screen.getByLabelText('Pending payment')).toBeTruthy();

    await act(async () => {
      mockPaymentListener?.({ id: 'pending-1', type: 'send', status: 'completed', amountSat: 42 });
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(screen.queryByLabelText('Pending payment')).toBeNull();
    jest.useRealTimers();
  });

  it('keeps the aggregate row interactive when another payment remains pending during a terminal handoff', async () => {
    jest.useFakeTimers();
    mockWalletTransactions = [
      { id: 'pending-a', type: 'send', status: 'pending', amount: 42 },
      { id: 'pending-b', type: 'send', status: 'pending', amount: 1250 },
    ];
    const view = render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('⏳ Pending • 1,292 sats')).toBeTruthy());
    await act(async () => {
      mockPaymentListener?.({ id: 'pending-a', type: 'send', status: 'pending', amountSat: 42 });
      mockPaymentListener?.({ id: 'pending-a', type: 'send', status: 'completed', amountSat: 42 });
      mockWalletTransactions = [{ id: 'pending-b', type: 'send', status: 'pending', amount: 1250 }];
      view.rerender(<HomeScreen />);
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(screen.getByLabelText('Pending payment')).toBeTruthy();
    expect(screen.getByLabelText('Pending payment').props.accessibilityState).toEqual({ disabled: false });
    expect(screen.getByText('⏳ Pending • 1,250 sats')).toBeTruthy();
    jest.useRealTimers();
  });

  it('waits for B terminal handoff after stale A handoff is superseded', async () => {
    jest.useFakeTimers();
    mockWalletTransactions = [
      { id: 'pending-a', type: 'send', status: 'pending', amount: 42 },
      { id: 'pending-b', type: 'send', status: 'pending', amount: 1250 },
    ];
    const view = render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('⏳ Pending • 1,292 sats')).toBeTruthy());
    await act(async () => {
      mockPaymentListener?.({ id: 'pending-a', type: 'send', status: 'pending', amountSat: 42 });
      mockPaymentListener?.({ id: 'pending-a', type: 'send', status: 'completed', amountSat: 42 });
      mockWalletTransactions = [{ id: 'pending-b', type: 'send', status: 'pending', amount: 1250 }];
      view.rerender(<HomeScreen />);
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(screen.getByLabelText('Pending payment')).toBeTruthy());

    await act(async () => {
      mockPaymentListener?.({ id: 'pending-b', type: 'send', status: 'pending', amountSat: 1250 });
      mockPaymentListener?.({ id: 'pending-b', type: 'send', status: 'completed', amountSat: 1250 });
      mockWalletTransactions = [];
      view.rerender(<HomeScreen />);
    });

    expect(screen.getByLabelText('Pending payment')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1999); });
    expect(screen.getByLabelText('Pending payment')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(screen.queryByLabelText('Pending payment')).toBeNull());
    jest.useRealTimers();
  });

  it('renders the authoritative pending amount in formatted sats', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'amount-1', paymentAmount: '1250',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending with 1,250 sats')).toBeTruthy());
  });

  it('keeps Pending copy safe when the outgoing amount is unavailable', async () => {
    mockUseLocalSearchParams.mockReturnValue({ paymentPending: 'true', paymentId: 'no-amount' });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    expect(screen.queryByText('Payment pending with 0 sats')).toBeNull();
  });

  it('does not leak a previous payment amount into a later Pending banner', async () => {
    render(<HomeScreen />);

    await waitFor(() => expect(mockPaymentListener).toBeDefined());
    await act(async () => {
      mockPaymentListener?.({ id: 'first-amount', type: 'send', status: 'pending', amountSat: 1250 });
    });
    await waitFor(() => expect(screen.getByText('Payment pending with 1,250 sats')).toBeTruthy());

    await act(async () => {
      mockPaymentListener?.({ id: 'second-amount', type: 'send', status: 'pending' });
    });
    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    expect(screen.queryByText('Payment pending with 1,250 sats')).toBeNull();
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
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true',
      paymentId: 'fast-success',
      paymentAmount: '42',
    });
    mockGetPayment.mockResolvedValue({
      id: 'fast-success', type: 'send', status: 'completed', amountSat: 42,
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(mockGetPayment).toHaveBeenCalledWith('fast-success');
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('reconciles a failed payment when its event fired before Home mounted', async () => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true',
      paymentId: 'fast-failed',
      paymentAmount: '42',
    });
    mockGetPayment.mockResolvedValue({
      id: 'fast-failed', type: 'send', status: 'failed', amountSat: 42,
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => expect(screen.getByText('Payment failed — balance restored')).toBeTruthy());
    expect(screen.queryByText('Payment pending')).toBeNull();
    expect(mockGetPayment).toHaveBeenCalledWith('fast-failed');
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('replaces a pending banner once when a tracked payment completes by event', async () => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'event-success', paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(mockPaymentListener).toBeDefined());
    await act(async () => {
      mockPaymentListener?.({ id: 'event-success', type: 'send', status: 'completed', amountSat: 42 });
      mockPaymentListener?.({ id: 'event-success', type: 'send', status: 'completed', amountSat: 42 });
    });

    expect(screen.getByText('Payment pending')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());
    expect(screen.queryByText('Payment pending')).toBeNull();
    jest.useRealTimers();
  });

  it.each([
    ['completed', 'Payment sent'],
    ['failed', 'Payment failed — balance restored'],
  ])('keeps a fast Pending to %s terminal banner visible for its full duration', async (status, terminalTitle) => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: `fast-${status}`, paymentAmount: '42',
    });

    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(1000);
      mockPaymentListener?.({ id: `fast-${status}`, type: 'send', status, amountSat: 42 });
    });

    expect(screen.getByText('Payment pending')).toBeTruthy();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(999); });
    expect(screen.getByText('Payment pending')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(screen.getByText(terminalTitle)).toBeTruthy());
    expect(screen.queryAllByText(terminalTitle)).toHaveLength(1);
    expect(screen.queryByText('Payment pending')).toBeNull();
    expect(screen.queryByLabelText('Pending payment')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(3499);
    });
    expect(screen.getByText(terminalTitle)).toBeTruthy();
    expect(screen.queryAllByText(terminalTitle)).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(terminalTitle)).toBeNull();
    jest.useRealTimers();
  });

  it.each([
    ['completed', 'Payment sent'],
    ['failed', 'Payment failed — balance restored'],
  ])('does not extend the %s terminal banner when its event is duplicated', async (status, terminalTitle) => {
    jest.useFakeTimers();
    const paymentId = `duplicate-terminal-${status}`;
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId, paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(1000);
      mockPaymentListener?.({ id: paymentId, type: 'send', status, amountSat: 42 });
      jest.advanceTimersByTime(1000);
    });
    await waitFor(() => expect(screen.getByText(terminalTitle)).toBeTruthy());

    await act(async () => { jest.advanceTimersByTime(3499); });
    expect(screen.getByText(terminalTitle)).toBeTruthy();

    await act(async () => {
      mockPaymentListener?.({ id: paymentId, type: 'send', status, amountSat: 42 });
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(terminalTitle)).toBeNull();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it.each([
    ['completed', 'Payment sent'],
    ['failed', 'Payment failed — balance restored'],
  ])('replaces Pending immediately when %s arrives at the minimum dwell', async (status, terminalTitle) => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: `threshold-${status}`, paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(2000);
      mockPaymentListener?.({ id: `threshold-${status}`, type: 'send', status, amountSat: 42 });
    });
    await waitFor(() => expect(screen.getByText(terminalTitle)).toBeTruthy());
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it.each([
    ['completed', 'Payment sent'],
    ['failed', 'Payment failed — balance restored'],
  ])('replaces Pending immediately when %s arrives after the minimum dwell', async (status, terminalTitle) => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: `after-dwell-${status}`, paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(2001);
      mockPaymentListener?.({ id: `after-dwell-${status}`, type: 'send', status, amountSat: 42 });
    });

    await waitFor(() => expect(screen.getByText(terminalTitle)).toBeTruthy());
    expect(screen.queryByText('Payment pending')).toBeNull();
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('keeps Pending through its minimum dwell, then gives the terminal banner a full lifetime after exit', async () => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'transition-lifecycle', paymentAmount: '1250',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending with 1,250 sats')).toBeTruthy());
    await act(async () => {
      mockPaymentListener?.({ id: 'transition-lifecycle', type: 'send', status: 'completed', amountSat: 1250 });
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByText('Payment pending')).toBeTruthy();
    expect(screen.queryByText('Payment sent')).toBeNull();

    await act(async () => { jest.advanceTimersByTime(1); });
    expect(screen.queryByText('Payment sent')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(219); });
    expect(screen.queryByText('Payment sent')).toBeNull();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(screen.getByText('Payment sent')).toBeTruthy());

    await act(async () => { jest.advanceTimersByTime(3499); });
    expect(screen.getByText('Payment sent')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(screen.queryByText('Payment sent')).toBeNull();
    jest.useRealTimers();
  });

  it('cancels a queued terminal replacement when Home unmounts', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'unmount-queued-terminal', paymentAmount: '42',
    });
    const view = render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(2000);
      mockPaymentListener?.({ id: 'unmount-queued-terminal', type: 'send', status: 'completed', amountSat: 42 });
    });

    view.unmount();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does not let a queued terminal overwrite a newer payment toast', async () => {
    jest.useFakeTimers();
    mockUseLocalSearchParams.mockReturnValue({
      paymentPending: 'true', paymentId: 'stale-queued-terminal', paymentAmount: '42',
    });
    render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => {
      jest.advanceTimersByTime(1000);
      mockPaymentListener?.({ id: 'stale-queued-terminal', type: 'send', status: 'completed', amountSat: 42 });
      mockPaymentListener?.({ id: 'newer-receive', type: 'receive', status: 'completed', amountSat: 21 });
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(screen.getByText('Payment received')).toBeTruthy());
    expect(screen.queryByText('Payment sent')).toBeNull();
    jest.useRealTimers();
  });

  it('reconciles a failed tracked payment when Home regains focus', async () => {
    jest.useFakeTimers();
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

    await waitFor(() => expect(screen.getByText('Payment pending')).toBeTruthy());
    await act(async () => { jest.advanceTimersByTime(2000); });
    await waitFor(() => expect(screen.getByText('Payment failed — balance restored')).toBeTruthy());
    expect(mockRefreshBalance).toHaveBeenCalled();
    expect(mockRefreshTransactions).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
