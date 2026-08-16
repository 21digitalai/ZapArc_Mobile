import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import {
  dismissLightningAddressBanner,
  getActiveSecurityReminder,
} from '../walletSecurityOnboarding';
import { settingsService } from '../../../../services';
import { googleDriveBackupService } from '../../../../services/googleDriveBackupService';
import { getCachedAddress } from '../../../../services/lightningAddressService';

jest.mock('../../../../services', () => ({
  settingsService: { getUserSettings: jest.fn() },
}));
jest.mock('../../../../services/googleDriveBackupService', () => ({
  googleDriveBackupService: {
    getLocalFingerprint: jest.fn(),
    isConnected: jest.fn(),
  },
}));
jest.mock('../../../../services/lightningAddressService', () => ({
  getCachedAddress: jest.fn(),
}));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
}));

const mockedSettings = settingsService as jest.Mocked<typeof settingsService>;
const mockedBiometrics = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockedBackup = googleDriveBackupService as jest.Mocked<typeof googleDriveBackupService>;
const mockedAddress = getCachedAddress as jest.MockedFunction<typeof getCachedAddress>;

describe('getActiveSecurityReminder', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    (AsyncStorage as jest.Mocked<typeof AsyncStorage>).clear();
    mockedSettings.getUserSettings.mockResolvedValue({
      biometricEnabled: false,
      notificationsEnabled: false,
    } as never);
    mockedBiometrics.hasHardwareAsync.mockResolvedValue(true);
    mockedBiometrics.isEnrolledAsync.mockResolvedValue(true);
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
    mockedBackup.getLocalFingerprint.mockResolvedValue(null);
    mockedBackup.isConnected.mockResolvedValue(false);
    mockedAddress.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps biometric and notifications ahead of Lightning Address', async () => {
    expect(await getActiveSecurityReminder()).toBe('biometric');

    mockedSettings.getUserSettings.mockResolvedValue({
      biometricEnabled: true,
      notificationsEnabled: false,
    } as never);
    expect(await getActiveSecurityReminder()).toBe('notifications');
  });

  it('offers Lightning Address immediately after security prompts resolve', async () => {
    mockedSettings.getUserSettings.mockResolvedValue({
      biometricEnabled: true,
      notificationsEnabled: true,
    } as never);
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);

    expect(await getActiveSecurityReminder()).toBe('lightning-address');
  });

  it('suppresses Lightning Address when an address already exists', async () => {
    mockedSettings.getUserSettings.mockResolvedValue({
      biometricEnabled: true,
      notificationsEnabled: true,
    } as never);
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedAddress.mockResolvedValue({ lightningAddress: 'alice@zaparc.com' } as never);

    expect(await getActiveSecurityReminder({
      masterKeyId: 'wallet-a',
      subWalletIndex: 0,
    })).toBeNull();
    expect(mockedAddress).toHaveBeenLastCalledWith({
      masterKeyId: 'wallet-a',
      subWalletIndex: 0,
    });
  });

  it('keeps cloud backup behind the cooldown after Lightning Address is dismissed', async () => {
    mockedSettings.getUserSettings.mockResolvedValue({
      biometricEnabled: true,
      notificationsEnabled: true,
    } as never);
    mockedNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    await AsyncStorage.setItem('@zap_arc/wallet_banners_first_seen_at_v1', '0');
    await dismissLightningAddressBanner();

    expect(await getActiveSecurityReminder()).toBeNull();
  });
});
