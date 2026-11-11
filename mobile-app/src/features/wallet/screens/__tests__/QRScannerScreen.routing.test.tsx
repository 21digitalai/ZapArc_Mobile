import React from 'react';
import { existsSync } from 'fs';
import path from 'path';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { QRScannerScreen } from '../QRScannerScreen';

const mockPush = jest.fn();
const mockParsePaymentRequest = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockLaunchImageLibraryAsync = jest.fn();
const mockScanFromURLAsync = jest.fn();
const mockUseCameraPermissions = jest.fn(() => [{ granted: true }, jest.fn()]);
const mockShowError = jest.fn();
const mockUseFocusEffect = jest.fn();
let mockCameraPayload = 'broken-camera-qr';
const mockReact = jest.requireActual<typeof import('react')>('react');
const mockReactNative = jest.requireActual<typeof import('react-native')>('react-native');

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    replace: jest.fn(),
  },
  useFocusEffect: (callback: () => void | (() => void)) => mockUseFocusEffect(callback),
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('expo-camera', () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: { data: string }) => void }) => (
    mockReact.createElement(mockReactNative.Button, {
      title: 'Simulate camera scan',
      onPress: () => onBarcodeScanned?.({ data: mockCameraPayload }),
    })
  ),
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
  extractSdkErrorMessage: (error: unknown) => error instanceof Error ? error.message : 'scanner processing failed',
  normalizeLightningInput: (input: string) => {
    const withoutScheme = input.replace(/^lightning:/i, '').trim();
    try {
      const url = new URL(withoutScheme);
      const payloads = url.searchParams.getAll('lightning');
      return payloads.length === 1 && payloads[0].trim() ? payloads[0].trim() : withoutScheme;
    } catch {
      return withoutScheme;
    }
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
  it('keeps the receive-claim route real and the retired generic LNURL route absent', () => {
    expect(existsSync(path.join(process.cwd(), 'app', 'wallet', 'receive-claim.tsx'))).toBe(true);
    expect(existsSync(path.join(process.cwd(), 'app', 'wallet', 'lnurl.tsx'))).toBe(false);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
    mockShowError.mockClear();
    mockUseFocusEffect.mockClear();
    mockUseFocusEffect.mockImplementationOnce((callback: () => void | (() => void)) => callback());
    mockCameraPayload = 'broken-camera-qr';
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

  it('reports unknown receive scans as unresolved instead of claiming they request payment', async () => {
    mockUseLocalSearchParams.mockReturnValue({ mode: 'receive' });
    mockParsePaymentRequest.mockResolvedValue({ isValid: false, type: 'unknown' });
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'https://lnbits.example/unknown');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This QR code is not a supported Lightning, LNURL, Spark, or Bitcoin payment request.'));
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

  it('processes one concurrent camera payload and latches its sustained repeated failure', async () => {
    let rejectParse: ((error: Error) => void) | undefined;
    mockParsePaymentRequest.mockImplementation(() => new Promise((_resolve, reject) => { rejectParse = reject; }));

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    fireEvent.press(screen.getByText('Simulate camera scan'));

    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(1);
    rejectParse!(new Error('native parser failed'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('Simulate camera scan'));
    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(1);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      fireEvent.press(screen.getByText('Simulate camera scan'));
    }
    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledTimes(1);
  });

  it('accepts a different camera payload after a failed camera payload is latched', async () => {
    mockParsePaymentRequest
      .mockResolvedValueOnce({ isValid: false, type: 'unknown' })
      .mockResolvedValueOnce({ isValid: true, type: 'bolt11' });

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(1));

    mockCameraPayload = 'lnbc1newcamerainvoice';
    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  it('retries the same failed camera payload after the scanner is deliberately re-focused', async () => {
    mockParsePaymentRequest
      .mockResolvedValueOnce({ isValid: false, type: 'unknown' })
      .mockResolvedValueOnce({ isValid: true, type: 'bolt11' });

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('Simulate camera scan'));
    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(1);

    const refocusCallback = mockUseFocusEffect.mock.calls[0]?.[0];
    expect(refocusCallback).toBeDefined();
    refocusCallback!();

    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(2);
  });

  it('lets manual entry and gallery bypass a camera failure latch', async () => {
    mockParsePaymentRequest
      .mockResolvedValueOnce({ isValid: false, type: 'unknown' })
      .mockResolvedValueOnce({ isValid: true, type: 'bolt11' })
      .mockResolvedValueOnce({ isValid: false, type: 'unknown' })
      .mockResolvedValueOnce({ isValid: true, type: 'bolt11' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///manual-bypass.png' }],
    });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnbc1gallerybypass', type: 'qr' }]);

    const firstScanner = render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'lnbc1manualbypass');
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    firstScanner.unmount();
    mockPush.mockClear();
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(2));
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  });

  it('navigates exactly once for a concurrent successful camera burst', async () => {
    let resolveParse: ((value: { isValid: boolean; type: string }) => void) | undefined;
    mockParsePaymentRequest.mockImplementation(() => new Promise((resolve) => { resolveParse = resolve; }));

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Simulate camera scan'));
    fireEvent.press(screen.getByText('Simulate camera scan'));
    resolveParse!({ isValid: true, type: 'bolt11' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockParsePaymentRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps a route failure generic instead of exposing its scanner exception', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: true, type: 'bolt11' });
    mockPush.mockImplementationOnce(() => {
      throw new Error('provider response must not reach the toast');
    });

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'lnbc1testinvoice');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This QR code could not be processed. Try again or scan a different code.'));
  });

  it.each([
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

  it('does not route an unresolved gallery LNURL to a nonexistent page', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: false, type: 'unknown' });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///lnurl.png' }] });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'lnurl1unavailable', type: 'qr' }]);

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This is a recognized LNURL, but its voucher status is unavailable. No claim or expiry status could be confirmed.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not treat a lightning-wrapped unresolved LNURL as an invoice', async () => {
    mockParsePaymentRequest.mockResolvedValue({ isValid: false, type: 'unknown' });

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'lightning:lnurl1withdraw');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This is a recognized LNURL, but its voucher status is unavailable. No claim or expiry status could be confirmed.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    ['general scanner', {}],
    ['receive-only scanner', { mode: 'receive' }],
  ])('recognizes an unresolved website-wrapped LNURL in the %s', async (_mode, params) => {
    mockUseLocalSearchParams.mockReturnValue(params);
    mockParsePaymentRequest.mockRejectedValue(new Error('provider unavailable'));

    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(
      screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'),
      'https://example.invalid/voucher?lightning=LNURL1SYNTHETIC',
    );
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(mockShowError).toHaveBeenCalledWith('This is a recognized LNURL, but its voucher status is unavailable. No claim or expiry status could be confirmed.'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps gallery and manual entry available when camera permission is denied', async () => {
    mockUseCameraPermissions.mockReturnValue([{ granted: false }, jest.fn()]);
    render(<QRScannerScreen />);

    fireEvent.press(screen.getByText('Enter code manually instead'));
    expect(screen.getByText('Enter Payment Code')).toBeTruthy();
    expect(screen.getByText('Scan from Gallery')).toBeTruthy();
  });
});
