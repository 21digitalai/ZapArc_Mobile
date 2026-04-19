import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SwapRateLine } from '../SwapRateLine';

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

describe('SwapRateLine', () => {
  const baseProps = {
    rateText: '1 SAT = 0.01 USDB',
    feeText: '0.02 USDB',
    slippageBps: 50,
    onSlippagePresetSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders rate/fee/slippage row', () => {
    const { getByText } = render(<SwapRateLine {...baseProps} />);

    expect(getByText('swap.rate: 1 SAT = 0.01 USDB')).toBeTruthy();
    expect(getByText('swap.fee: 0.02 USDB')).toBeTruthy();
    expect(getByText('swap.slippage: swap.slippagePreset05')).toBeTruthy();
  });

  it('shows advanced chips and marks active preset', () => {
    const { getByLabelText } = render(<SwapRateLine {...baseProps} />);

    expect(getByLabelText('Select slippage swap.slippagePreset05').props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Select slippage swap.slippagePreset01').props.accessibilityState.selected).toBe(false);
  });

  it('calls preset selection when chip is pressed', () => {
    const { getByLabelText } = render(<SwapRateLine {...baseProps} />);

    fireEvent.press(getByLabelText('Select slippage swap.slippagePreset10'));
    expect(baseProps.onSlippagePresetSelect).toHaveBeenCalledWith(100);
  });

  it('renders inline error when provided', () => {
    const { getByText } = render(<SwapRateLine {...baseProps} inlineError="swap.error.limitsUnavailable" />);

    expect(getByText('swap.error.limitsUnavailable')).toBeTruthy();
  });
});
