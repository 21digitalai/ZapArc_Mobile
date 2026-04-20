import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

import { SwapScreen } from '../SwapScreen';

const mockUseSwap = jest.fn();

jest.mock('../../../../hooks/useSwap', () => ({
  useSwap: (...args: unknown[]) => mockUseSwap(...args),
}));


jest.mock('../../components/SwapAmountCard', () => ({
  SwapAmountCard: ({ label, currency }: { label: string; currency: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, `${label}: ${currency}`);
  },
}));

jest.mock('../../components/SwapRateLine', () => ({
  SwapRateLine: ({ inlineError }: { inlineError?: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, inlineError || 'rate-line');
  },
}));

jest.mock('../../components/SwapReviewModal', () => ({
  SwapReviewModal: () => null,
}));

jest.mock('../../components/SwapResultView', () => ({
  SwapResultView: () => null,
}));

jest.mock('../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'dark' }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: any) => React.createElement(View, null, children),
  };
});

const baseSwap = {
  direction: 'BTC_TO_USDB',
  amountInput: '1000',
  slippageBps: 50,
  state: { status: 'quoteLoaded', quote: { amount: 1000n, receiveAmount: 10n, rate: '0.01', feeSat: 12n } },
  isOffline: false,
  limitsUnavailable: false,
  setAmountInput: jest.fn(),
  flipDirection: jest.fn(),
  setSlippageBps: jest.fn(),
  openReview: jest.fn(),
  closeReview: jest.fn(),
  confirmSwap: jest.fn(),
  tryAgainFromRefund: jest.fn(),
};

describe('SwapScreen integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSwap.mockReturnValue(baseSwap);
  });

  it('renders swap cards and opens review', () => {
    render(<SwapScreen />);

    expect(screen.getByText('Swap')).toBeTruthy();
    expect(screen.getByText('Review')).toBeTruthy();

    fireEvent.press(screen.getByText('Review'));
    expect(baseSwap.openReview).toHaveBeenCalled();
  });

  it('shows connectivity banners', () => {
    mockUseSwap.mockReturnValue({ ...baseSwap, isOffline: true, limitsUnavailable: true });

    render(<SwapScreen />);

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText('Limits unavailable')).toBeTruthy();
  });
  it('rendersBtcOnTop_forBtcToUsdbDirection', () => {
    mockUseSwap.mockReturnValue({ ...baseSwap, direction: 'BTC_TO_USDB' });

    render(<SwapScreen />);

    expect(screen.getByText('You pay: sats')).toBeTruthy();
    expect(screen.getByText('You receive: USDB')).toBeTruthy();
  });

  it('rendersUsdbOnTop_forUsdbToBtcDirection', () => {
    mockUseSwap.mockReturnValue({ ...baseSwap, direction: 'USDB_TO_BTC' });

    render(<SwapScreen />);

    expect(screen.getByText('You pay: USDB')).toBeTruthy();
    expect(screen.getByText('You receive: sats')).toBeTruthy();
  });

  it('swapsCards_onFlipButtonTap', () => {
    render(<SwapScreen />);

    fireEvent.press(screen.getByLabelText('Flip swap direction'));

    expect(baseSwap.flipDirection).toHaveBeenCalled();
  });

});
