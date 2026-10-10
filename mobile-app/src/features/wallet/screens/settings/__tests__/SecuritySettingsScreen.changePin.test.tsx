import React from 'react';
import { render } from '@testing-library/react-native';
import { SecuritySettingsScreen } from '../SecuritySettingsScreen';

const mockUseWalletAuth = jest.fn();

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn() }, useFocusEffect: (effect: () => void | (() => void)) => effect() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-local-authentication', () => ({ hasHardwareAsync: jest.fn(async () => false), isEnrolledAsync: jest.fn(async () => false), supportedAuthenticationTypesAsync: jest.fn(async () => []), AuthenticationType: { FACIAL_RECOGNITION: 1, FINGERPRINT: 2 } }));
jest.mock('react-native-paper', () => {
  const { Text } = require('react-native');
  return { Text, Switch: () => null, IconButton: () => null };
});
jest.mock('../../../../../hooks/useSettings', () => ({ useSettings: () => ({ settings: { biometricEnabled: false } }) }));
jest.mock('../../../../../hooks/useWalletAuth', () => ({ useWalletAuth: () => mockUseWalletAuth() }));
jest.mock('../../../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'light' }) }));
jest.mock('../../../../../utils/theme-helpers', () => ({ BRAND_COLOR: '#c90', getGradientColors: () => ['#000', '#fff'], getPrimaryTextColor: () => '#000', getSecondaryTextColor: () => '#666' }));
jest.mock('../../../components/PinLockoutBanner', () => ({ PinLockoutBanner: () => null }));

describe('SecuritySettingsScreen', () => {
  beforeEach(() => {
    mockUseWalletAuth.mockReturnValue({ enableBiometric: jest.fn(), disableBiometric: jest.fn(), isLoading: false, error: null });
  });

  it('does not expose wallet-specific Change PIN controls', () => {
    const screen = render(<SecuritySettingsScreen />);
    expect(screen.queryByText('Change PIN')).toBeNull();
  });
});
