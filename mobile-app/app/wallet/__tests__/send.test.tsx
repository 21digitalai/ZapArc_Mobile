import React from 'react';
import { Alert, BackHandler } from 'react-native';
import { render, fireEvent, waitFor, screen, cleanup } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import SendScreen from '../send';

jest.mock('../../../src/config/features', () => ({
  SWAP_FEATURE_ENABLED: true,
  MULTI_ASSET_UI_ENABLED: true,
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
const mockSendOnchainPayment = jest.fn();
const mockSendPayment = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockScanFromURLAsync = jest.fn();
const mockRequestCameraPermission = jest.fn();
const mockContacts = [{
  id: 'contact-1',
  name: 'Alice',
  lightningAddress: 'alice@example.com',
  createdAt: 1,
  updatedAt: 1,
}];

const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    navigate: jest.fn(),
    replace: jest.fn(),
    setParams: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useFocusEffect: jest.fn((callback: () => void) => callback()),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, mockRequestCameraPermission],
  scanFromURLAsync: (...args: unknown[]) => mockScanFromURLAsync(...args),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
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
  useContacts: () => ({ contacts: mockContacts, refreshContacts: jest.fn() }),
}));

jest.mock('../../../src/features/addressBook/components/ContactSelectionModal', () => ({
  ContactSelectionModal: ({ visible, onSelect, contacts }: any) => {
    if (!visible) return null;
    const React = require('react');
    const { Text, TouchableOpacity } = require('react-native');
    return React.createElement(
      TouchableOpacity,
      { testID: 'select-first-contact', onPress: () => onSelect(contacts[0]) },
      React.createElement(Text, null, 'Select first contact'),
    );
  },
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
  classifyInvoiceError: (error: unknown) => {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (/invoice.*expired|expired.*invoice/.test(message)) return 'expired';
    if (/raw enum value|match any cases|unexpected|unknown|invalid enum discriminator|variant index|uniffi/.test(message)) return 'unreadable';
    return null;
  },
  getPaymentErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  BreezSparkService: {
    parsePaymentRequest: (...args: unknown[]) => mockParsePaymentRequest(...args),
    prepareSendPayment: (...args: unknown[]) => mockPrepareSendPayment(...args),
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
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });

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

  it('replaces native enum preparation errors with localized safe invoice copy', async () => {
    mockParsePaymentRequest.mockResolvedValue({
      type: 'bolt11',
      isValid: true,
      amountSat: 1000,
    });
    mockPrepareSendPayment.mockRejectedValueOnce(
      new Error("Getting raw enum value doesn't match any cases"),
    );

    renderScreen();
    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], 'lnbc1nativeenum');
    fireEvent.press(screen.getByText('Preview Payment'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invoice cannot be read',
        'This Lightning invoice may be expired or created in a format this version cannot read. Ask the sender for a new invoice and try again.',
      );
    });
    expect(Alert.alert).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/enum|uniffi|variant/i),
    );
  });
});

describe('SendScreen gallery scan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockUseLocalSearchParams.mockReturnValue({});
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  });

  afterEach(() => cleanup());

  it('shows camera and gallery scan actions together', () => {
    renderScreen();

    expect(screen.getByText('Scan QR Code')).toBeTruthy();
    expect(screen.getByText('Gallery Image')).toBeTruthy();
  });

  it('decodes a selected gallery QR through the Send parser without requesting camera access', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///gallery-qr.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1galleryinvoice', type: 'qr' }]);
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(mockParsePaymentRequest).toHaveBeenCalledWith('lnbc1galleryinvoice');
      expect(screen.getAllByTestId('destination-input')[0].props.value).toBe('lnbc1galleryinvoice');
    });
    expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  });

  it('replaces raw enum failures with a friendly gallery-scan alert and preserves the invoice', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///unreadable-invoice.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1unreadableinvoice', type: 'qr' }]);
    mockParsePaymentRequest.mockRejectedValue(
      new Error("Getting raw enum value doesn't match any cases"),
    );

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invoice cannot be read',
        expect.stringContaining('may be expired or created in a format'),
      );
      expect(screen.getAllByTestId('destination-input')[0].props.value)
        .toBe('lnbc1unreadableinvoice');
    });
    expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls)).not.toMatch(/enum|uniffi|variant/i);
  });

  it('rejects a confirmed expired gallery invoice and preserves it for replacement', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///expired-invoice.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1expiredinvoice', type: 'qr' }]);
    mockParsePaymentRequest.mockResolvedValue({
      isValid: true,
      type: 'bolt11',
      expiresAt: Date.now() - 1,
    });

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Invoice expired',
        expect.stringContaining('Ask the sender for a new invoice'),
      );
      expect(screen.getAllByTestId('destination-input')[0].props.value)
        .toBe('lnbc1expiredinvoice');
    });
  });

  it('reprocesses the same gallery image and replaces edited input', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///same-gallery-qr.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1repeatinvoice', type: 'qr' }]);
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(screen.getAllByTestId('destination-input')[0].props.value).toBe('lnbc1repeatinvoice');
    });

    fireEvent.changeText(screen.getAllByTestId('destination-input')[0], 'manually edited destination');
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(mockScanFromURLAsync).toHaveBeenCalledTimes(2);
      expect(mockParsePaymentRequest).toHaveBeenCalledWith('lnbc1repeatinvoice');
      expect(screen.getAllByTestId('destination-input')[0].props.value).toBe('lnbc1repeatinvoice');
    });
  });

  it('reprocesses the same gallery image and replaces a selected contact', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///same-gallery-qr.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1repeatinvoice', type: 'qr' }]);
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));
    await waitFor(() => expect(screen.getAllByTestId('destination-input')[0].props.value).toBe('lnbc1repeatinvoice'));

    fireEvent.press(screen.getByTestId('open-contact-picker'));
    fireEvent.press(screen.getByTestId('select-first-contact'));
    expect(screen.getByText('Alice')).toBeTruthy();

    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => {
      expect(mockScanFromURLAsync).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Alice')).toBeNull();
      expect(screen.getAllByTestId('destination-input')[0].props.value).toBe('lnbc1repeatinvoice');
    });
  });

  it.each([
    ['no QR', [], 'No QR code found in that image.'],
    ['multiple QR codes', [{ data: 'one' }, { data: 'two' }], 'Please select an image with one QR code.'],
  ])('reports %s gallery results without parsing a payment', async (_label, scanResult, message) => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///gallery-qr.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue(scanResult);

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('QR scan', message));
    expect(mockParsePaymentRequest).not.toHaveBeenCalled();
  });

  it('guards rapid duplicate gallery taps and reports picker failures', async () => {
    let rejectPicker: ((error: Error) => void) | undefined;
    mockLaunchImageLibraryAsync.mockImplementation(() => new Promise((_, reject) => { rejectPicker = reject; }));

    renderScreen();
    fireEvent.press(screen.getByText('Gallery Image'));
    fireEvent.press(screen.getByText('Gallery Image'));

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    rejectPicker!(new Error('picker unavailable'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('QR scan', 'Could not read a QR code from that image.'));
  });
});

describe('SendScreen Android back handling', () => {
  it('consumes rapid input-step back events and navigates only once', () => {
    const subscription = { remove: jest.fn() };
    const addListener = jest.spyOn(BackHandler, 'addEventListener').mockReturnValue(subscription);

    renderScreen();

    const handler = addListener.mock.calls
      .find(([eventName]) => eventName === 'hardwareBackPress')?.[1];

    expect(handler).toBeDefined();
    expect(handler!()).toBe(true);
    expect(handler!()).toBe(true);
    expect(require('expo-router').router.replace).toHaveBeenCalledWith('/wallet/home');
    expect(require('expo-router').router.replace).toHaveBeenCalledTimes(1);
  });
});
