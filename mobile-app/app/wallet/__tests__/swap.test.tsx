import React from 'react';
import { render } from '@testing-library/react-native';

import SwapRoute from '../swap';

const mockUseLocalSearchParams = jest.fn();
const mockSwapScreen = jest.fn<null, [{ initialDirection: string }]>(() => null);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  router: { back: jest.fn() },
}));

jest.mock('../../../src/features/wallet/screens/SwapScreen', () => ({
  SwapScreen: (props: { initialDirection: string }) => mockSwapScreen(props),
}));

describe('wallet/swap route', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReset();
    mockSwapScreen.mockClear();
  });

  it('defaults to BTC_TO_USDB when direction param is missing', () => {
    mockUseLocalSearchParams.mockReturnValue({});

    render(<SwapRoute />);

    expect(mockSwapScreen).toHaveBeenCalledWith(expect.objectContaining({ initialDirection: 'BTC_TO_USDB' }));
  });

  it('uses USDB_TO_BTC when provided via query param', () => {
    mockUseLocalSearchParams.mockReturnValue({ direction: 'USDB_TO_BTC' });

    render(<SwapRoute />);

    expect(mockSwapScreen).toHaveBeenCalledWith(expect.objectContaining({ initialDirection: 'USDB_TO_BTC' }));
  });
});
