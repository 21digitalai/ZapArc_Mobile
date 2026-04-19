import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SwapResultView } from '../SwapResultView';

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

describe('SwapResultView', () => {
  it('renders success state', () => {
    const { getByText } = render(
      <SwapResultView kind="success" paidAmount="100 sats" receivedAmount="1.00 USDB" />
    );

    expect(getByText('swap.success.title')).toBeTruthy();
    expect(getByText('swap.success.paid: 100 sats')).toBeTruthy();
    expect(getByText('swap.success.received: 1.00 USDB')).toBeTruthy();
  });

  it('renders dust residual in USDB units', () => {
    const { getByText } = render(
      <SwapResultView kind="dustResidual" residualUsdb="0.03 USDB" />
    );

    expect(getByText('USDB residual: 0.03 USDB')).toBeTruthy();
  });

  it('renders refunded with two actions', () => {
    const onRetry = jest.fn();
    const onIncreaseSlippage = jest.fn();
    const { getByText } = render(
      <SwapResultView kind="refunded" onRetry={onRetry} onIncreaseSlippage={onIncreaseSlippage} />
    );

    fireEvent.press(getByText('swap.refunded.tryAgain'));
    fireEvent.press(getByText('swap.refunded.increaseSlippage'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onIncreaseSlippage).toHaveBeenCalledTimes(1);
  });

  it('renders error with retry', () => {
    const onRetry = jest.fn();
    const { getByText } = render(
      <SwapResultView kind="error" errorMessage="Swap failed hard" onRetry={onRetry} />
    );

    expect(getByText('Swap failed hard')).toBeTruthy();
    fireEvent.press(getByText('swap.error.retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
