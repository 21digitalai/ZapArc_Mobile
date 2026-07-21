import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { QRScannerScreen } from '../QRScannerScreen';

const mockPush = jest.fn();
const mockParsePaymentRequest = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock('../../../../services/breezSparkService', () => ({
  BreezSparkService: {
    parsePaymentRequest: (...args: unknown[]) => mockParsePaymentRequest(...args),
  },
}));

jest.mock('../../../../components', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return {
    StyledTextInput: (props: any) => React.createElement(TextInput, props),
  };
});

describe('QRScannerScreen scan routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
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
});
