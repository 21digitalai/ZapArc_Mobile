import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { WalletManagementScreen } from '../WalletManagementScreen';
import { PinEntryScreen } from '../PinEntryScreen';

const mockUseWallet = jest.fn();
const mockUseWalletAuth = jest.fn();
const mockParams = jest.fn();
const mockChangePin = jest.fn<Promise<boolean>, [string, string]>();
const mockSelectWallet = jest.fn<Promise<boolean>, [string, number, string]>();
const mockAuthState = { currentMasterKeyId: 'master-a' };

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-local-authentication', () => ({}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: jest.fn(() => false), push: jest.fn(), replace: jest.fn(), setParams: jest.fn() }, useFocusEffect: (effect: () => void | (() => void)) => effect(), useLocalSearchParams: () => mockParams() }));
jest.mock('../../../../services/breezSparkService', () => ({ beginDisconnectSDK: jest.fn() }));
jest.mock('../../../../components', () => ({ StyledTextInput: () => null }));
jest.mock('../../../../hooks/useWallet', () => ({ useWallet: () => mockUseWallet() }));
jest.mock('../../../../hooks/useWalletAuth', () => ({ useWalletAuth: () => mockUseWalletAuth() }));
jest.mock('../../../../hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../../../../contexts/ThemeContext', () => ({ useAppTheme: () => ({ themeMode: 'light' }) }));
jest.mock('../../../../utils/theme-helpers', () => ({ BRAND_COLOR: '#c90', getGradientColors: () => ['#000', '#fff'], getPrimaryTextColor: () => '#fff', getSecondaryTextColor: () => '#aaa', getIconColor: () => '#aaa' }));
jest.mock('../../../../services', () => ({ securityService: { enableScreenshotPrevention: jest.fn(), disableScreenshotPrevention: jest.fn() }, storageService: {} }));
jest.mock('../../../../services/settingsService', () => ({ settingsService: {} }));
jest.mock('react-native-paper', () => {
  const { Text, TouchableOpacity, TextInput: NativeTextInput } = require('react-native');
  const Menu = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Menu.Item = ({ onPress, title, testID }: { onPress: () => void; title: string; testID?: string }) => <TouchableOpacity onPress={onPress} testID={testID}><Text>{title}</Text></TouchableOpacity>;
  return { Text, IconButton: ({ onPress }: { onPress?: () => void }) => <TouchableOpacity onPress={onPress} />, Button: ({ children, onPress, testID }: { children: React.ReactNode; onPress: () => void; testID?: string }) => <TouchableOpacity onPress={onPress} testID={testID}><Text>{children}</Text></TouchableOpacity>, Menu, Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>, Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>, ActivityIndicator: () => null, TextInput: ({ value, onChangeText, testID }: { value: string; onChangeText: (value: string) => void; testID?: string }) => <NativeTextInput value={value} onChangeText={onChangeText} testID={testID} /> };
});

const mockRouter = jest.requireMock('expo-router').router;

const masterKeys = [
  { id: 'master-a', nickname: 'Alpha', subWallets: [{ index: 0, nickname: 'Main A' }] },
  { id: 'master-b', nickname: 'Beta', subWallets: [{ index: 0, nickname: 'Main B' }] },
];

describe('wallet-menu Change PIN routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.mockReturnValue({});
    mockAuthState.currentMasterKeyId = 'master-a';
    mockChangePin.mockResolvedValue(true);
    mockSelectWallet.mockResolvedValue(true);
    mockUseWallet.mockReturnValue({ masterKeys, activeMasterKey: masterKeys[0], activeSubWallet: masterKeys[0].subWallets[0], addSubWallet: jest.fn(), archiveSubWallet: jest.fn(), deleteMasterKey: jest.fn(), renameMasterKey: jest.fn(), renameSubWallet: jest.fn(), canAddSubWallet: () => true, getAddSubWalletDisabledReason: () => null, syncSubWalletActivity: jest.fn(), getMnemonic: jest.fn() });
    mockUseWalletAuth.mockImplementation(() => ({ selectSubWallet: jest.fn(), getSessionPin: jest.fn(), changePin: mockChangePin, currentMasterKeyId: mockAuthState.currentMasterKeyId, isLoading: false, error: null, unlock: jest.fn(), unlockWithBiometric: jest.fn(), biometricAvailable: false, biometricEnabled: false, biometricType: 'fingerprint', activeWalletInfo: { masterKeyId: mockAuthState.currentMasterKeyId, masterKeyNickname: 'Alpha', subWalletIndex: 0, subWalletNickname: 'Main A' }, selectWallet: mockSelectWallet, selectWalletWithBiometric: jest.fn(), getPinAuthStatus: jest.fn(async () => null) }));
  });

  it('opens a six-digit Change PIN modal for the active master and mutates only that master', async () => {
    const screen = render(<WalletManagementScreen />);
    fireEvent.press(screen.getByTestId('change-pin-master-a'));
    expect(screen.getByTestId('change-pin-new')).toBeTruthy();
    expect(mockChangePin).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('change-pin-new'), '123456');
    fireEvent.changeText(screen.getByTestId('change-pin-confirm'), '123456');
    fireEvent.press(screen.getByTestId('change-pin-save'));
    await waitFor(() => expect(mockChangePin).toHaveBeenCalledWith('123456', 'master-a'));
  });

  it('routes an inactive master to its exact unlock target before opening Change PIN', () => {
    const screen = render(<WalletManagementScreen />);
    fireEvent.press(screen.getByTestId('change-pin-master-b'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/wallet/unlock', params: { masterKeyId: 'master-b', subWalletIndex: '0', changePinAfterUnlock: 'true' } });
    expect(mockChangePin).not.toHaveBeenCalled();
  });

  it('returns from the target-wallet PIN route to the selected master only after successful unlock', async () => {
    mockParams.mockReturnValue({ masterKeyId: 'master-b', subWalletIndex: '0', changePinAfterUnlock: 'true' });
    const screen = render(<PinEntryScreen />);
    for (const digit of '123456') fireEvent.press(screen.getByText(digit));
    await waitFor(() => expect(mockSelectWallet).toHaveBeenCalledWith('master-b', 0, '123456'));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/wallet/manage', params: { changePinMasterKeyId: 'master-b' } });
  });

  it('aborts a mid-flow wallet switch without calling changePin', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<WalletManagementScreen />);
    fireEvent.press(screen.getByTestId('change-pin-master-a'));
    mockAuthState.currentMasterKeyId = 'master-b';
    screen.rerender(<WalletManagementScreen />);
    fireEvent.changeText(screen.getByTestId('change-pin-new'), '123456');
    fireEvent.changeText(screen.getByTestId('change-pin-confirm'), '123456');
    fireEvent.press(screen.getByTestId('change-pin-save'));
    expect(mockChangePin).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Wallet changed', expect.any(String));
    alertSpy.mockRestore();
  });
});
