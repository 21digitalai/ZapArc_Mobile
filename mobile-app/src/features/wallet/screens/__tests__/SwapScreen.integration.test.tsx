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

jest.mock('../../../../hooks/useWallet', () => ({
  useWallet: () => ({
    balance: 0,
    usdbBalance: 0,
    refreshBalance: jest.fn(),
    refreshTransactions: jest.fn(),
    applySwapResult: jest.fn(),
  }),
}));

jest.mock('../../../../hooks/useCurrency', () => ({
  useCurrency: () => ({
    rates: { usd: 100000 },
  }),
}));

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'swap.title': 'Swap',
        'swap.reviewButton': 'Review',
        'swap.error.offline': 'Offline',
        'swap.error.limitsUnavailable': 'Limits unavailable',
        'swap.flipDirection': 'Flip swap direction',
        'swap.youPay': 'You pay',
        'swap.youReceive': 'You receive',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('../../../../config/features', () => ({
  SWAP_FEATURE_ENABLED: true,
  MULTI_ASSET_UI_ENABLED: true,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: any) => React.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

const baseSwap = {
  direction: 'BTC_TO_USDB',
  amountInput: '1000',
  slippageBps: 50,
  usdbDecimals: 6,
  state: { status: 'quoteLoaded', quote: { amount: 1000n, receiveAmount: 10n, rate: 0.01, feeSat: 12n, direction: 'BTC_TO_USDB', usdbDecimals: 6 } },
  isOffline: false,
  limitsUnavailable: false,
  setAmountInput: jest.fn(),
  setAvailableBalance: jest.fn(),
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

    fireEvent.press(screen.getByLabelText('Review'));
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
