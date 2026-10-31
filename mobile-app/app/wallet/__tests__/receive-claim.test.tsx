import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ReceiveClaimScreen from '../receive-claim';

const mockResolve = jest.fn();
const mockClaim = jest.fn();
const mockGetPayment = jest.fn();
const mockSetItem = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ lnurl: 'lnurl1controlledfixture' }),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { SafeAreaView: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children) };
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { Text, TextInput, TouchableOpacity } = require('react-native');
  return {
    Text,
    TextInput,
    Button: ({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) => React.createElement(TouchableOpacity, { onPress, disabled }, React.createElement(Text, null, children)),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: (...args: unknown[]) => mockSetItem(...args),
  removeItem: jest.fn(),
}));

jest.mock('../../../src/services/breezSparkService', () => ({
  resolveLnurlWithdraw: (...args: unknown[]) => mockResolve(...args),
  claimLnurlWithdraw: (...args: unknown[]) => mockClaim(...args),
  getPayment: (...args: unknown[]) => mockGetPayment(...args),
}));
jest.mock('../../../src/contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'light' }) }));
jest.mock('../../../src/hooks/useWallet', () => ({ useWallet: () => ({ activeWalletInfo: { masterKeyId: 'wallet', subWalletIndex: 0 }, refreshBalance: jest.fn(), refreshTransactions: jest.fn() }) }));
jest.mock('../../../src/services/i18nService', () => ({ t: (key: string) => key }));
jest.mock('../../../src/utils/theme-helpers', () => ({ BRAND_COLOR: '#000', getAppBackgroundColor: () => '#fff', getPrimaryTextColor: () => '#000' }));

describe('receive claim post-submit reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue({ minSats: 21, maxSats: 21, description: 'Fixture claim' });
    mockClaim.mockResolvedValue({ paymentId: 'accepted-payment' });
    mockSetItem.mockResolvedValue(undefined);
    mockGetPayment.mockRejectedValue(new Error('temporary lookup failure'));
  });

  it('keeps an accepted claim pending when reconciliation fails and cannot submit it again', async () => {
    render(<ReceiveClaimScreen />);
    await waitFor(() => expect(screen.getByText('receiveClaim.claim')).toBeTruthy());

    fireEvent.press(screen.getByText('receiveClaim.claim'));

    await waitFor(() => expect(screen.getByText('receiveClaim.pending')).toBeTruthy());
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('receiveClaim.claim')).toBeNull();
  });
});
