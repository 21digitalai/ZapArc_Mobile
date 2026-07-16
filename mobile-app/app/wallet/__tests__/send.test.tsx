import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SendScreen from '../send';

jest.mock('../../../src/config/features', () => ({
  SWAP_FEATURE_ENABLED: true,
  MULTI_ASSET_UI_ENABLED: true,
  CROSS_CHAIN_SEND_ENABLED: true,
  CONTACTS_BACKUP_ENABLED: false,
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(View, null, children),
    SafeAreaView: ({ children }: any) => React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { Text, TextInput, TouchableOpacity, View } = require('react-native');

  const Button = ({ children, onPress, testID }: any) =>
    React.createElement(TouchableOpacity, { onPress, testID }, React.createElement(Text, null, children));

  const Menu = ({ anchor, children }: any) =>
    React.createElement(View, null, anchor, children);

  Menu.Item = ({ title, onPress }: any) =>
    React.createElement(TouchableOpacity, { onPress }, React.createElement(Text, null, title));

  return {
    PaperProvider: ({ children }: any) => React.createElement(View, null, children),
    Text,
    Button,
    TextInput,
    Menu,
    IconButton: ({ onPress }: any) => React.createElement(TouchableOpacity, { onPress }),
  };
});

const mockParsePaymentRequest = jest.fn();
const mockPrepareSendPayment = jest.fn();
const mockPrepareCrossChainSendPayment = jest.fn();
const mockGetCrossChainSendRoutesForAddress = jest.fn();
const mockSendOnchainPayment = jest.fn();
const mockSendPayment = jest.fn();

const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    navigate: jest.fn(),
    setParams: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useFocusEffect: jest.fn((callback: () => void) => callback()),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../../src/contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'light' }),
}));

jest.mock('../../../src/hooks/useWallet', () => ({
  useWallet: () => ({
    balance: 500000,
    refreshBalance: jest.fn().mockResolvedValue(undefined),
    getBalanceForAsset: (asset: 'BTC' | 'USDB') => (asset === 'USDB' ? 250 : 500000),
  }),
}));

jest.mock('../../../src/hooks/useCurrency', () => ({
  useCurrency: () => ({
    secondaryFiatCurrency: 'usd',
    convertToSats: (value: number) => Math.round(value),
    formatSatsWithFiat: (sats: number) => ({ satsDisplay: `${sats} sats`, fiatDisplay: '$1.00' }),
    rates: { usd: 100000, eur: 100000 },
    isLoadingRates: false,
  }),
}));

jest.mock('../../../src/hooks/useLightningAddress', () => ({
  useLightningAddress: () => ({ addressInfo: null }),
}));

jest.mock('../../../src/features/addressBook/hooks/useContacts', () => ({
  useContacts: () => ({ contacts: [], refreshContacts: jest.fn() }),
}));

jest.mock('../../../src/features/addressBook/components/ContactSelectionModal', () => ({
  ContactSelectionModal: () => null,
}));

jest.mock('../../../src/components', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return {
    StyledTextInput: ({ value, onChangeText, placeholder, label, testID, ...props }: { value?: string; onChangeText?: (v: string) => void; placeholder?: string; label?: string; testID?: string }) => {
      const resolvedTestId = testID
        || (placeholder ? 'destination-input' : undefined)
        || (typeof label === 'string' && label.toLowerCase().includes('amount') ? 'amount-input' : undefined);
      return React.createElement(TextInput, { value, onChangeText, placeholder, testID: resolvedTestId, ...props });
    },
  };
});

jest.mock('../../../src/services/breezSparkService', () => ({
  BreezSparkService: {
    parsePaymentRequest: (...args: unknown[]) => mockParsePaymentRequest(...args),
    prepareSendPayment: (...args: unknown[]) => mockPrepareSendPayment(...args),
    prepareCrossChainSendPayment: (...args: unknown[]) => mockPrepareCrossChainSendPayment(...args),
    getCrossChainSendRoutesForAddress: (...args: unknown[]) => mockGetCrossChainSendRoutesForAddress(...args),
    sendOnchainPayment: (...args: unknown[]) => mockSendOnchainPayment(...args),
    sendPayment: (...args: unknown[]) => mockSendPayment(...args),
    resolveSwapTokens: jest.fn().mockResolvedValue([{ tokenIdentifier: 'usdb-token', decimals: 2 }]),
  },
}));

const renderScreen = () =>
  render(
    <SafeAreaProvider>
      <PaperProvider>
        <SendScreen />
      </PaperProvider>
    </SafeAreaProvider>
  );

describe('SendScreen on-chain flow', () => {
  const switchToOnchainTab = () => {
    fireEvent.press(screen.getByText('₿ On-chain'));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockUseLocalSearchParams.mockReturnValue({});

    mockParsePaymentRequest.mockResolvedValue({ type: 'bitcoinAddress', isValid: true });
    mockPrepareSendPayment.mockResolvedValue({
      paymentMethod: {
        tag: 'BitcoinAddress',
        inner: {
          feeQuote: {
            speedFast: { feeSats: 30, estimatedConfirmationTime: '10' },
            speedMedium: { feeSats: 20, estimatedConfirmationTime: '30' },
            speedSlow: { feeSats: 10, estimatedConfirmationTime: '60' },
          },
        },
      },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    cleanup();
  });

  it('uses tab selection for on-chain flow', async () => {
    renderScreen();
    switchToOnchainTab();

    expect(screen.getByText('Bitcoin on-chain transaction')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('bc1... or 1... or 3...'), 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview On-chain Transaction'));

    await waitFor(() => {
      expect(mockParsePaymentRequest).toHaveBeenCalled();
    });
  });

  it('switches from On-chain to the cross-chain surface before preparing a USDC send', async () => {
    const rawRoute = {
      provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDC', supportedSources: [{ tag: 'Bitcoin' }],
    };
    mockParsePaymentRequest.mockResolvedValue({ type: 'crossChainAddress', isValid: true });
    mockGetCrossChainSendRoutesForAddress.mockResolvedValue([{
      route: rawRoute,
      destination: { provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDC', decimals: 6, exactOutEligible: false },
    }]);
    mockPrepareCrossChainSendPayment.mockResolvedValue({
      paymentMethod: {
        tag: 'CrossChainAddress',
        inner: {
          estimatedOut: 990000, feeAmount: 10000, sourceTransferFeeSats: 12,
          feeMode: 'FeesExcluded', expiresAt: '2026-07-16T16:00:00Z',
        },
      },
    });

    renderScreen();
    switchToOnchainTab();
    fireEvent.press(screen.getByText('USDC'));

    expect(screen.queryByText('Bitcoin on-chain transaction')).toBeNull();
    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], '0xabc');

    await waitFor(() => {
      expect(mockGetCrossChainSendRoutesForAddress).toHaveBeenCalledWith('0xabc', 'USDC', { asset: 'BTC' });
      expect(screen.getByText('base (8453)')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('base (8453)'));
    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview Payment'));

    await waitFor(() => {
      expect(mockPrepareCrossChainSendPayment).toHaveBeenCalledWith('0xabc', rawRoute, 1000, undefined);
    });
    expect(screen.getByText('Recipient receives')).toBeTruthy();
    expect(screen.getByText('USDC')).toBeTruthy();
    expect(screen.getByText('Destination network')).toBeTruthy();
    expect(screen.getByText('base (8453)')).toBeTruthy();
    expect(screen.getByText('Paying from')).toBeTruthy();
    expect(screen.getByText('BTC wallet')).toBeTruthy();
    expect(screen.getByText('Recipient delivery')).toBeTruthy();
    expect(screen.getByText('990,000 USDC')).toBeTruthy();
    expect(screen.getByText('SDK route fee')).toBeTruthy();
    expect(screen.getByText('10,000 USDC (FeesExcluded)')).toBeTruthy();
    expect(screen.getByText('Quote expires')).toBeTruthy();
    expect(screen.getByText('2026-07-16T16:00:00Z')).toBeTruthy();
  });

  it('uses the inherited USDB token context when resolving a stablecoin route', async () => {
    const rawRoute = {
      provider: 'Orchestra', chain: 'solana', asset: 'USDT', supportedSources: [{
        tag: 'Token', inner: { tokenIdentifier: 'usdb-token' },
      }],
    };
    mockUseLocalSearchParams.mockReturnValue({ asset: 'USDB' });
    mockParsePaymentRequest.mockResolvedValue({ type: 'crossChainAddress', isValid: true });
    mockGetCrossChainSendRoutesForAddress.mockResolvedValue([{
      route: rawRoute,
      destination: { provider: 'Orchestra', chain: 'solana', asset: 'USDT', decimals: 6, exactOutEligible: false },
    }]);

    renderScreen();
    fireEvent.press(screen.getByText('USDT'));
    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], 'So11111111111111111111111111111111111111112');

    await waitFor(() => {
      expect(mockGetCrossChainSendRoutesForAddress).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'USDT',
        { asset: 'USDB', tokenIdentifier: 'usdb-token' },
      );
      expect(screen.getByText('solana')).toBeTruthy();
    });
  });

  it('lists dynamic EVM, Solana, and Tron routes and requires a network choice for an ambiguous address', async () => {
    const routes = [
      { route: { chain: 'base', chainId: '8453' }, destination: { provider: 'Breez', chain: 'Base', chainId: '8453', asset: 'USDT' as const, decimals: 6, exactOutEligible: false } },
      { route: { chain: 'arbitrum', chainId: '42161' }, destination: { provider: 'Breez', chain: 'Arbitrum', chainId: '42161', asset: 'USDT' as const, decimals: 6, exactOutEligible: false } },
      { route: { chain: 'solana' }, destination: { provider: 'Breez', chain: 'Solana', asset: 'USDT' as const, decimals: 6, exactOutEligible: false } },
      { route: { chain: 'tron' }, destination: { provider: 'Breez', chain: 'Tron', asset: 'USDT' as const, decimals: 6, exactOutEligible: false } },
    ];
    mockGetCrossChainSendRoutesForAddress.mockResolvedValue(routes);

    renderScreen();
    fireEvent.press(screen.getByText('USDT'));
    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], '0xambiguous');

    await waitFor(() => {
      expect(screen.getByText('Base (8453)')).toBeTruthy();
      expect(screen.getByText('Arbitrum (42161)')).toBeTruthy();
      expect(screen.getByText('Solana')).toBeTruthy();
      expect(screen.getByText('Tron')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview Payment'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Enter a supported recipient address and select a destination network.');
    });
  });

  it('clears a stale route choice when a route refresh becomes ambiguous or unavailable', async () => {
    const baseRoute = { provider: 'Breez', chain: 'Base', chainId: '8453', asset: 'USDC' as const, decimals: 6, exactOutEligible: false };
    const solanaRoute = { provider: 'Breez', chain: 'Solana', asset: 'USDC' as const, decimals: 6, exactOutEligible: false };
    mockGetCrossChainSendRoutesForAddress
      .mockResolvedValueOnce([{ route: { chain: 'base' }, destination: baseRoute }])
      .mockResolvedValueOnce([{ route: { chain: 'base' }, destination: baseRoute }, { route: { chain: 'solana' }, destination: solanaRoute }])
      .mockResolvedValueOnce([]);

    renderScreen();
    fireEvent.press(screen.getByText('USDC'));
    const input = screen.getAllByTestId('destination-input')[0];
    fireEvent.changeText(input, '0xfirst');
    await waitFor(() => expect(screen.getByText('Base (8453)')).toBeTruthy());

    fireEvent.changeText(input, '0xrefresh');
    await waitFor(() => expect(screen.getByText('Solana')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview Payment'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Enter a supported recipient address and select a destination network.');
    });

    fireEvent.changeText(input, '0xnone');
    await waitFor(() => expect(screen.getByText('No USDC route is currently available for this address.')).toBeTruthy());
  });

  it('shows on-chain preview with fee + speed selector and updates fee by speed', async () => {
    renderScreen();
    switchToOnchainTab();

    fireEvent.changeText(screen.getByPlaceholderText('bc1... or 1... or 3...'), 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview On-chain Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Confirmation Speed')).toBeTruthy();
      expect(screen.getByText('Fast')).toBeTruthy();
      expect(screen.getByText('Medium')).toBeTruthy();
      expect(screen.getByText('Slow')).toBeTruthy();
      expect(screen.getByText('Fee:')).toBeTruthy();
      expect(screen.getAllByText('20 sats').length).toBeGreaterThan(0);
    });

    fireEvent.press(screen.getByText('Fast'));

    await waitFor(() => {
      expect(screen.getAllByText('30 sats').length).toBeGreaterThan(0);
      expect(screen.getByText('1,030 sats')).toBeTruthy();
    });
  });

  it('rejects invalid and empty amount edge cases', async () => {
    mockParsePaymentRequest.mockResolvedValueOnce({ type: 'unknown', isValid: false });
    renderScreen();
    switchToOnchainTab();

    fireEvent.changeText(screen.getByPlaceholderText('bc1... or 1... or 3...'), 'not-a-payment-request');
    fireEvent.press(screen.getByText('Preview On-chain Transaction'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Payment Error',
        expect.stringContaining('valid Lightning invoice')
      );
    });

    mockParsePaymentRequest.mockResolvedValue({ type: 'bitcoinAddress', isValid: true });
    fireEvent.changeText(screen.getByPlaceholderText('bc1... or 1... or 3...'), 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    fireEvent.changeText(screen.getByTestId('amount-input'), '');
    fireEvent.press(screen.getByText('Preview On-chain Transaction'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please enter a valid amount in sats');
    });
  });


  it('shows USDB bolt11 parse error and allows switching to BTC', async () => {
    mockUseLocalSearchParams.mockReturnValue({ asset: 'USDB' });
    mockParsePaymentRequest.mockResolvedValue({ type: 'bolt11', isValid: true });

    renderScreen();

    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], 'lnbc1exampleinvoice');
    fireEvent.changeText(screen.getByTestId('amount-input'), '1.25');
    fireEvent.press(screen.getByText('Preview Payment'));

    await waitFor(() => {
      expect(screen.getByText('USDB transfers stay on Spark. Lightning invoices are BTC-only.')).toBeTruthy();
      expect(screen.getByText('Switch to BTC')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Switch to BTC'));

    await waitFor(() => {
      expect(screen.getByText('500,000 sats')).toBeTruthy();
    });
  });

  it('handles fee estimation/prepare failures', async () => {
    mockPrepareSendPayment.mockRejectedValueOnce(new Error('fee quote unavailable'));

    renderScreen();
    switchToOnchainTab();
    fireEvent.changeText(screen.getByPlaceholderText('bc1... or 1... or 3...'), 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    fireEvent.changeText(screen.getByTestId('amount-input'), '1000');
    fireEvent.press(screen.getByText('Preview On-chain Transaction'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Payment Error', 'fee quote unavailable');
    });
  });
});
