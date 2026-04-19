import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { SwapReviewModal } from '../SwapReviewModal';

const mockUnlockWithBiometric = jest.fn<Promise<boolean>, []>();
const mockGetSessionPin = jest.fn<string | null, []>();

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../../../../hooks/useWalletAuth', () => ({
  useWalletAuth: () => ({
    unlockWithBiometric: mockUnlockWithBiometric,
    getSessionPin: mockGetSessionPin,
  }),
}));

describe('SwapReviewModal', () => {
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();

  const baseProps = {
    visible: true,
    direction: 'BTC_TO_USDB' as const,
    payAmount: '100 sats',
    receiveAmount: '1.00 USDB',
    rateText: '1 SAT = 0.01 USDB',
    feeText: '0.02 USDB',
    slippageText: '0.5%',
    onDismiss,
    onConfirm,
  };

  const renderModal = (props: React.ComponentProps<typeof SwapReviewModal>) =>
    render(
      <PaperProvider>
        <SwapReviewModal {...props} />
      </PaperProvider>
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockUnlockWithBiometric.mockResolvedValue(true);
    mockGetSessionPin.mockReturnValue(null);
  });

  it('renders review rows', () => {
    const { getByText } = renderModal(baseProps);

    expect(getByText('swap.review.title')).toBeTruthy();
    expect(getByText('BTC → USDB')).toBeTruthy();
    expect(getByText('100 sats')).toBeTruthy();
    expect(getByText('1.00 USDB')).toBeTruthy();
    expect(getByText('1 SAT = 0.01 USDB')).toBeTruthy();
  });

  it('disables confirm after first tap (double-tap guard)', async () => {
    const { getByLabelText } = renderModal(baseProps);
    const confirmButton = getByLabelText('Confirm swap');

    fireEvent.press(confirmButton);
    fireEvent.press(confirmButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('re-enables confirm when authError arrives', async () => {
    mockUnlockWithBiometric.mockResolvedValue(false);

    const { getByLabelText, rerender } = renderModal(baseProps);

    fireEvent.press(getByLabelText('Confirm swap'));

    await waitFor(() => {
      expect(onConfirm).not.toHaveBeenCalled();
    });

    rerender(
      <PaperProvider>
        <SwapReviewModal {...baseProps} authError="Authentication failed" />
      </PaperProvider>
    );

    mockUnlockWithBiometric.mockResolvedValue(true);
    fireEvent.press(getByLabelText('Confirm swap'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('allows confirm through PIN fallback when biometric fails', async () => {
    mockUnlockWithBiometric.mockResolvedValue(false);
    mockGetSessionPin.mockReturnValue('123456');

    const { getByLabelText } = renderModal(baseProps);

    fireEvent.press(getByLabelText('Confirm swap'));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
