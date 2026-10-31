import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { QRScannerScreen } from '../QRScannerScreen';

const mockPush = jest.fn();
const mockParsePaymentRequest = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockLaunchImageLibraryAsync = jest.fn();
const mockScanFromURLAsync = jest.fn();
const mockUseCameraPermissions = jest.fn(() => [{ granted: true }, jest.fn()]);
const mockShowError = jest.fn();
const mockReact = jest.requireActual<typeof import('react')>('react');
const mockReactNative = jest.requireActual<typeof import('react-native')>('react-native');

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    replace: jest.fn(),
  },
  useFocusEffect: jest.fn((callback: () => void | (() => void)) => callback()),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => mockUseCameraPermissions(),
  scanFromURLAsync: (...args: unknown[]) => mockScanFromURLAsync(...args),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock('../../../../services/breezSparkService', () => ({
  BreezSparkService: {
    parsePaymentRequest: (...args: unknown[]) => mockParsePaymentRequest(...args),
  },
}));

jest.mock('../../../../components', () => {
  return {
    StyledTextInput: (props: React.ComponentProps<typeof mockReactNative.TextInput>) => (
      mockReact.createElement(mockReactNative.TextInput, props)
    ),
  };
});

jest.mock('../../components/FeedbackComponents', () => ({
  useFeedback: () => ({ showError: (...args: unknown[]) => mockShowError(...args) }),
}));

describe('QRScannerScreen scan routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
    mockShowError.mockClear();
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  });

  const submitManualInput = async (value: string): Promise<void> => {
    render(<QRScannerScreen />);

    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), value);
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
  };

  it('routes bolt11 invoice to BTC lightning send flow', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });

    await submitManualInput('lnbc1testinvoice');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wallet/send',
      params: {
        asset: 'BTC',
        tab: 'lightning',
        paymentInput: 'lnbc1testinvoice',
      },
    });
  });

  it('routes an LNURL-withdraw QR to the receive claim flow', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'lnurlWithdraw' });

    await submitManualInput('LNURL1WITHDRAWTEST');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wallet/receive-claim',
      params: { lnurl: 'LNURL1WITHDRAWTEST' },
    });
  });

  it('keeps outgoing invoices out of the receive-only scanner flow', async () => {
    mockUseLocalSearchParams.mockReturnValue({ mode: 'receive' });
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'lnbc1payment');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This QR requests a payment. Scan an LNURL-withdraw QR code to receive sats.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rejects a USDB Spark invoice while the multi-asset UI is disabled', async () => {
    mockUseLocalSearchParams.mockReturnValue({ asset: 'USDB' });
    mockParsePaymentRequest.mockResolvedValue({ isValid: false });

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'spark:abc123?tokenIdentifier=usdb-mainnet');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('USDB transfers are not available in this version. Scan a Bitcoin or Lightning QR code instead.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('routes bitcoin address to BTC onchain send flow', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bitcoinAddress' });

    await submitManualInput('bc1qexampleaddress');

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wallet/send',
      params: {
        asset: 'BTC',
        tab: 'onchain',
        paymentInput: 'bc1qexampleaddress',
      },
    });
  });

  it('routes a gallery QR through the same BTC lightning send flow', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///payment-qr.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1galleryinvoice', type: 'qr' }]);

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wallet/send',
      params: { asset: 'BTC', tab: 'lightning', paymentInput: 'lnbc1galleryinvoice' },
    }));
  });

  it('keeps cancellation quiet and reports ambiguous or empty gallery scans', async () => {
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    expect(mockShowError).not.toHaveBeenCalled();

    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///ambiguous.png' }] });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'one' }, { data: 'two' }]);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('More than one QR code was found. Choose an image with only one QR code.'));
  });

  it('reports when a selected image has no QR code', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///no-qr.png' }] });
    mockScanFromURLAsync.mockResolvedValue([]);

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('No QR code was found. Choose an image with one QR code.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reports unsupported gallery content without routing or submitting a payment', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: false });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///unsupported.png' }] });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'not-a-payment-request', type: 'qr' }]);

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This QR code is not a supported Lightning, LNURL, Spark, or Bitcoin payment request.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reports image scan failures without routing', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///corrupt.png' }] });
    mockScanFromURLAsync.mockRejectedValue(new Error('decode failed'));

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This image could not be scanned. Try a clearer image with one QR code.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('ignores rapid duplicate gallery taps while a picker is pending', async () => {
    let resolvePicker: ((value: { canceled: boolean; assets: never[] }) => void) | undefined;
    mockLaunchImageLibraryAsync.mockImplementation(() => new Promise((resolve) => { resolvePicker = resolve; }));

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    fireEvent.press(screen.getByText('Scan from Gallery'));

    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    resolvePicker!({ canceled: true, assets: [] });
    await waitFor(() => expect(screen.getByText('Scan from Gallery')).toBeTruthy());
  });

  it.each([
    ['lnurl', 'lnurl1example', { pathname: '/wallet/lnurl', params: { lnurl: 'lnurl1example' } }],
    ['lightning address', 'alice@example.com', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'lightning', paymentInput: 'alice@example.com' } }],
    ['bitcoin address', 'bc1qgalleryaddress', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'onchain', paymentInput: 'bc1qgalleryaddress' } }],
    ['spark address', 'sp1gallerysparkaddress', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'lightning', paymentInput: 'sp1gallerysparkaddress' } }],
    ['spark invoice', 'spark:galleryinvoice', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'lightning', paymentInput: 'spark:galleryinvoice' } }],
  ])('routes gallery %s through the existing parser', async (_kind, payload, expectedRoute) => {
    mockParsePaymentRequest.mockResolvedValue({
      isValid: true,
      type: _kind === 'lnurl'
        ? 'lnurl'
        : _kind === 'bitcoin address'
          ? 'bitcoinAddress'
          : _kind === 'spark address'
            ? 'sparkAddress'
            : _kind === 'spark invoice'
              ? 'unknown'
              : 'lightningAddress',
    });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///payment-qr.png' }] });
    mockScanFromURLAsync.mockResolvedValue([{ data: payload, type: 'qr' }]);

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expectedRoute));
  });

  it('keeps gallery and manual entry available when camera permission is denied', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);
    render(<QRScannerScreen />);

    fireEvent.press(screen.getByText('Enter code manually instead'));
    expect(screen.getByText('Enter Payment Code')).toBeTruthy();
    expect(screen.getByText('Scan from Gallery')).toBeTruthy();
  });
});
