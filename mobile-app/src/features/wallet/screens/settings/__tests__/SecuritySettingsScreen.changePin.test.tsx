import React from 'react';
import { Alert, Modal } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SecuritySettingsScreen } from '../SecuritySettingsScreen';

const changePin = jest.fn<Promise<boolean>, [string]>();
const mockUseWalletAuth = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => effect(),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  AuthenticationType: { FACIAL_RECOGNITION: 1, FINGERPRINT: 2 },
}));

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { Pressable, Text, TextInput } = require('react-native');
  return {
    Text,
    Switch: () => null,
    IconButton: () => null,
    Button: ({ children, onPress, disabled, ...props }: any) => (
      <Pressable onPress={onPress} disabled={disabled} {...props}><Text>{children}</Text></Pressable>
    ),
    TextInput: (props: any) => <TextInput {...props} />,
  };
});

jest.mock('../../../../../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { biometricEnabled: false } }),
}));

jest.mock('../../../../../hooks/useWalletAuth', () => ({
  useWalletAuth: () => mockUseWalletAuth(),
}));

jest.mock('../../../../../hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ themeMode: 'light' }),
}));

jest.mock('../../../../../utils/theme-helpers', () => ({
  BRAND_COLOR: '#c90',
  getGradientColors: () => ['#000', '#fff'],
  getPrimaryTextColor: () => '#000',
  getSecondaryTextColor: () => '#666',
}));

jest.mock('../../../components/PinLockoutBanner', () => ({
  PinLockoutBanner: () => null,
}));

function renderScreen() {
  return render(<SecuritySettingsScreen />);
}

describe('SecuritySettingsScreen Change PIN', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    changePin.mockResolvedValue(true);
    mockUseWalletAuth.mockReturnValue({
      enableBiometric: jest.fn(),
      disableBiometric: jest.fn(),
      changePin,
      currentMasterKeyId: 'master-1',
      activeWalletInfo: {
        masterKeyId: 'master-1',
        masterKeyNickname: 'Travel wallet',
        subWalletIndex: 0,
        subWalletNickname: 'Main',
      },
      isLoading: false,
      error: null,
    });
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  });

  it('identifies the active master wallet and exposes masked accessible PIN inputs', () => {
    const screen = renderScreen();

    expect(screen.getByText('Change the PIN for Travel wallet.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('change-pin-open'));

    const newPin = screen.getByTestId('change-pin-new');
    const confirmPin = screen.getByTestId('change-pin-confirm');
    expect(newPin.props.secureTextEntry).toBe(true);
    expect(confirmPin.props.secureTextEntry).toBe(true);
    expect(screen.getByLabelText('New PIN')).toBe(newPin);
    expect(screen.getByLabelText('Confirm new PIN')).toBe(confirmPin);
  });

  it('validates a mismatch without calling the auth hook', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('change-pin-open'));
    fireEvent.changeText(screen.getByTestId('change-pin-new'), '123456');
    fireEvent.changeText(screen.getByTestId('change-pin-confirm'), '654321');
    fireEvent.press(screen.getByTestId('change-pin-save'));

    expect(screen.getByText('New PINs do not match.')).toBeTruthy();
    expect(changePin).not.toHaveBeenCalled();
  });

  it('clears fields on cancel and Android modal back before reopening', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('change-pin-open'));
    fireEvent.changeText(screen.getByTestId('change-pin-new'), '123456');
    fireEvent.changeText(screen.getByTestId('change-pin-confirm'), '123456');
    fireEvent.press(screen.getByTestId('change-pin-cancel'));

    fireEvent.press(screen.getByTestId('change-pin-open'));
    expect(screen.getByTestId('change-pin-new').props.value).toBe('');
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
    expect(screen.queryByTestId('change-pin-new')).toBeNull();
  });

  it('prevents duplicate submissions synchronously and clears/dismisses after success', async () => {
    let resolveChange: (value: boolean) => void = () => undefined;
    changePin.mockImplementation(() => new Promise((resolve) => { resolveChange = resolve; }));
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId('change-pin-open'));
    fireEvent.changeText(screen.getByTestId('change-pin-new'), '123456');
    fireEvent.changeText(screen.getByTestId('change-pin-confirm'), '123456');
    fireEvent.press(screen.getByTestId('change-pin-save'));
    fireEvent.press(screen.getByTestId('change-pin-save'));

    expect(changePin).toHaveBeenCalledTimes(1);
    resolveChange(true);

    await waitFor(() => expect(screen.queryByTestId('change-pin-new')).toBeNull());
    expect(Alert.alert).toHaveBeenCalledWith(
      'PIN changed',
      'Your current wallet now uses the new PIN.'
    );
  });
});
