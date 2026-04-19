import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SwapAmountCard } from '../SwapAmountCard';

describe('SwapAmountCard', () => {
  const baseProps = {
    label: 'You pay',
    currency: 'BTC',
    amount: '0.01',
    onAmountChange: jest.fn(),
    onMax: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders plain currency label', () => {
    const { getByText, queryByText } = render(<SwapAmountCard {...baseProps} />);

    expect(getByText('BTC')).toBeTruthy();
    expect(queryByText('▾')).toBeNull();
  });

  it('renders opacity-pulse skeleton when isLoading=true', () => {
    const { getByTestId } = render(<SwapAmountCard {...baseProps} isLoading />);

    expect(getByTestId('swap-amount-card-skeleton')).toBeTruthy();
  });

  it('calls onAmountChange when text input changes', () => {
    const { getByLabelText } = render(<SwapAmountCard {...baseProps} />);

    fireEvent.changeText(getByLabelText('Swap amount'), '12.5');
    expect(baseProps.onAmountChange).toHaveBeenCalledWith('12.5');
  });

  it('calls onMax when max pressed and enabled', () => {
    const { getByLabelText } = render(<SwapAmountCard {...baseProps} maxDisabled={false} />);

    fireEvent.press(getByLabelText('Set maximum amount'));
    expect(baseProps.onMax).toHaveBeenCalledTimes(1);
  });

  it('disables max and does not call onMax when maxDisabled=true', () => {
    const { getByLabelText } = render(
      <SwapAmountCard {...baseProps} maxDisabled maxDisabledTooltip="Need more funds" />
    );

    const maxButton = getByLabelText('Set maximum amount');
    expect(maxButton.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(maxButton);
    expect(baseProps.onMax).not.toHaveBeenCalled();
  });

  it('shows maxDisabledTooltip when max is disabled', () => {
    const { getByText } = render(
      <SwapAmountCard {...baseProps} maxDisabled maxDisabledTooltip="Need more funds" />
    );

    expect(getByText('Need more funds')).toBeTruthy();
  });

  it('disables input when isReadOnly=true', () => {
    const { getByLabelText } = render(<SwapAmountCard {...baseProps} isReadOnly />);

    expect(getByLabelText('Swap amount').props.editable).toBe(false);
  });

  it('has accessibilityLabel on max button', () => {
    const { getByLabelText } = render(<SwapAmountCard {...baseProps} />);

    expect(getByLabelText('Set maximum amount')).toBeTruthy();
  });
});
