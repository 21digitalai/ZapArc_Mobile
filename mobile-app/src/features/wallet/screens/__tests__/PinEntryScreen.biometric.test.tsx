import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PinEntryScreen } from '../PinEntryScreen';

const mockUnlockWithBiometric = jest.fn<Promise<boolean>, []>();
const mockUnlockWithPin = jest.fn<Promise<boolean>, [string]>();
const mockAuthState = {
  biometricAvailable: true,
  biometricEnabled: true,
};

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: { dismissAll: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-paper', () => {
  const { Text } = require('react-native');
  return { Text, IconButton: () => null };
});

jest.mock('../../../../hooks/useWalletAuth', () => ({
  useWalletAuth: () => ({
    unlock: mockUnlockWithPin,
    unlockWithBiometric: mockUnlockWithBiometric,
    biometricAvailable: mockAuthState.biometricAvailable,
    biometricEnabled: mockAuthState.biometricEnabled,
    biometricType: 'fingerprint',
    activeWalletInfo: {
      masterKeyId: 'wallet-main',
      masterKeyNickname: 'Wallet',
      subWalletIndex: 0,
      subWalletNickname: 'Main',
    },
    selectWallet: jest.fn(),
    selectWalletWithBiometric: jest.fn(),
    getPinAuthStatus: jest.fn(async () => null),
  }),
}));

jest.mock('../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'light' }),
}));

jest.mock('../../../../utils/theme-helpers', () => ({
  BRAND_COLOR: '#c90',
  getGradientColors: () => ['#000', '#fff'],
  getPrimaryTextColor: () => '#fff',
  getSecondaryTextColor: () => '#aaa',
}));

describe('PinEntryScreen biometric cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.biometricAvailable = true;
    mockAuthState.biometricEnabled = true;
    mockUnlockWithBiometric.mockResolvedValue(false);
    mockUnlockWithPin.mockResolvedValue(true);
  });

  it('auto-prompts once, then leaves PIN available after cancellation and state changes', async () => {
    const screen = render(<PinEntryScreen />);
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1));

    mockAuthState.biometricEnabled = false;
    screen.rerender(<PinEntryScreen />);
    mockAuthState.biometricEnabled = true;
    screen.rerender(<PinEntryScreen />);

    expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1')).toBeTruthy();

    fireEvent.press(screen.getByText('auth.useFingerprint'));
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(2));
  });

  it('accepts a complete PIN after the cancelled automatic prompt', async () => {
    const screen = render(<PinEntryScreen />);
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1));

    for (const digit of '123456') {
      fireEvent.press(screen.getByText(digit));
    }

    await waitFor(() => expect(mockUnlockWithPin).toHaveBeenCalledWith('123456'));
    expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1);
  });

  it('shows a PIN fallback after an explicit retry cannot read a biometric key', async () => {
    const screen = render(<PinEntryScreen />);
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('auth.useFingerprint'));

    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(2));
    expect(screen.getByText('auth.biometricUnlockUnavailable')).toBeTruthy();
  });

  it('clears the retry guard after a rejected explicit prompt so a later tap can retry', async () => {
    mockUnlockWithBiometric
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('biometric invalidated'))
      .mockResolvedValueOnce(false);
    const screen = render(<PinEntryScreen />);
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('auth.useFingerprint'));
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(2));
    fireEvent.press(screen.getByText('auth.useFingerprint'));
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(3));
    expect(screen.getByText('auth.biometricUnlockUnavailable')).toBeTruthy();
  });

  it('routes home after a successful explicit retry', async () => {
    mockUnlockWithBiometric
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const screen = render(<PinEntryScreen />);
    await waitFor(() => expect(mockUnlockWithBiometric).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByText('auth.useFingerprint'));

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/wallet/home')
    );
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it('hides biometric retry when enrollment is unavailable', () => {
    mockAuthState.biometricAvailable = false;
    const screen = render(<PinEntryScreen />);

    expect(screen.queryByText('auth.useFingerprint')).toBeNull();
  });
});
