import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { QRScannerScreen } from '../QRScannerScreen';

const mockPush = jest.fn();
const mockParsePaymentRequest = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
const mockLaunchImageLibraryAsync = jest.fn();
const mockScanFromURLAsync = jest.fn();
const mockUseCameraPermissions = jest.fn(() => [{ granted: true }, jest.fn()]);
const mockReact = jest.requireActual<typeof import('react')>('react');
const mockReactNative = jest.requireActual<typeof import('react-native')>('react-native');

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
  },
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

describe('QRScannerScreen scan routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);
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

  it('rejects a USDB Spark invoice while the multi-asset UI is disabled', async () => {
    mockUseLocalSearchParams.mockReturnValue({ asset: 'USDB' });
    mockParsePaymentRequest.mockResolvedValue({ isValid: false });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Enter Manually'));
    fireEvent.changeText(screen.getByPlaceholderText('lnbc... or LNURL... or user@domain.com'), 'spark:abc123?tokenIdentifier=usdb-mainnet');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(
      'USDB not supported',
      expect.stringContaining('not available in this version'),
      expect.any(Array)
    ));
    expect(mockPush).not.toHaveBeenCalled();
    alertSpy.mockRestore();
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
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<QRScannerScreen />);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();

    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///ambiguous.png' }] });
    mockScanFromURLAsync.mockResolvedValue([{ data: 'one' }, { data: 'two' }]);
    fireEvent.press(screen.getByText('Scan from Gallery'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Multiple QR codes found', expect.any(String)));
    alertSpy.mockRestore();
  });

  it.each([
    ['lnurl', 'lnurl1example', { pathname: '/wallet/lnurl', params: { lnurl: 'lnurl1example' } }],
    ['lightning address', 'alice@example.com', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'lightning', paymentInput: 'alice@example.com' } }],
    ['bitcoin address', 'bc1qgalleryaddress', { pathname: '/wallet/send', params: { asset: 'BTC', tab: 'onchain', paymentInput: 'bc1qgalleryaddress' } }],
  ])('routes gallery %s through the existing parser', async (_kind, payload, expectedRoute) => {
    mockParsePaymentRequest.mockResolvedValue({
      isValid: true,
      type: _kind === 'lnurl' ? 'lnurl' : _kind === 'bitcoin address' ? 'bitcoinAddress' : 'lightningAddress',
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
