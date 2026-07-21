import React from 'react';
import { render } from '@testing-library/react-native';

import SwapRoute from '../swap';

const mockUseLocalSearchParams = jest.fn();
const mockSwapScreen = jest.fn<null, [{ initialDirection: string }]>(() => null);

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  router: { back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../../src/config/features', () => ({
  SWAP_FEATURE_ENABLED: true,
}));

jest.mock('../../../src/features/wallet/screens/SwapScreen', () => ({
  SwapScreen: (props: { initialDirection: string }) => mockSwapScreen(props),
}));

describe('wallet/swap route', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReset();
    mockSwapScreen.mockClear();
  });

  it('defaults to BTC_TO_USDB when no navigation context is provided', () => {
    mockUseLocalSearchParams.mockReturnValue({});

    render(<SwapRoute />);

    expect(mockSwapScreen).toHaveBeenCalledWith(expect.objectContaining({ initialDirection: 'BTC_TO_USDB' }));
  });

  it('derives USDB_TO_BTC from the asset query param', () => {
    mockUseLocalSearchParams.mockReturnValue({ asset: 'USDB' });

    render(<SwapRoute />);

    expect(mockSwapScreen).toHaveBeenCalledWith(expect.objectContaining({ initialDirection: 'USDB_TO_BTC' }));
  });

  it('falls back to the legacy direction param when asset is missing', () => {
    mockUseLocalSearchParams.mockReturnValue({ direction: 'USDB_TO_BTC' });

    render(<SwapRoute />);

    expect(mockSwapScreen).toHaveBeenCalledWith(expect.objectContaining({ initialDirection: 'USDB_TO_BTC' }));
  });
});
