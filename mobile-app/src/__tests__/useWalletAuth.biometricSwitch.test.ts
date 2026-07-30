import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'android' },
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(true),
  isEnrolledAsync: jest.fn().mockResolvedValue(true),
  supportedAuthenticationTypesAsync: jest.fn().mockResolvedValue([1]),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

jest.mock('../services', () => ({
  storageService: {
    isWalletUnlocked: jest.fn().mockResolvedValue(false),
    getActiveWalletInfo: jest.fn().mockResolvedValue({ masterKeyId: 'wallet-a', subWalletIndex: 0 }),
    getLastActivity: jest.fn().mockResolvedValue(Date.now()),
    updateActivity: jest.fn(),
    getBiometricPin: jest.fn(),
    storeBiometricPin: jest.fn(),
    verifyMasterKeyPin: jest.fn(),
    setActiveWallet: jest.fn(),
    unlockWallet: jest.fn(),
    getMasterKeyMnemonic: jest.fn().mockResolvedValue(null),
    loadMultiWalletStorage: jest.fn(),
    deleteBiometricPin: jest.fn(),
  },
  settingsService: {
    getUserSettings: jest.fn().mockResolvedValue({ autoLockTimeout: 0, biometricEnabled: true }),
    updateUserSettings: jest.fn(),
  },
}));

jest.mock('../services/breezSparkService', () => ({ disconnectSDK: jest.fn(), initializeSDK: jest.fn() }));
jest.mock('../services/walletCacheService', () => ({
  getCachedBalance: jest.fn().mockResolvedValue(null), getCachedTransactions: jest.fn().mockResolvedValue(null),
  setPreloadedData: jest.fn(), emitWalletSwitch: jest.fn(),
}));

import { storageService, settingsService } from '../services';
import { primeSessionPin, useWalletAuth } from '../hooks/useWalletAuth';

describe('useWalletAuth biometric master-wallet switching', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses each target wallet protected PIN without re-enrolling it', async () => {
    (storageService.getBiometricPin as jest.Mock)
      .mockResolvedValueOnce('111111')
      .mockResolvedValueOnce('222222');
    (storageService.verifyMasterKeyPin as jest.Mock).mockResolvedValue(true);
    (storageService.setActiveWallet as jest.Mock).mockResolvedValue(undefined);
    (storageService.unlockWallet as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.biometricAvailable).toBe(true));

    await act(async () => {
      await expect(result.current.selectWalletWithBiometric('wallet-a', 0)).resolves.toBe(true);
    });
    await act(async () => {
      await expect(result.current.selectWalletWithBiometric('wallet-b', 1)).resolves.toBe(true);
    });

    expect(storageService.getBiometricPin).toHaveBeenNthCalledWith(1, 'wallet-a', expect.any(Object));
    expect(storageService.getBiometricPin).toHaveBeenNthCalledWith(2, 'wallet-b', expect.any(Object));
    expect(storageService.verifyMasterKeyPin).toHaveBeenNthCalledWith(1, 'wallet-a', '111111');
    expect(storageService.verifyMasterKeyPin).toHaveBeenNthCalledWith(2, 'wallet-b', '222222');
    expect(storageService.setActiveWallet).toHaveBeenNthCalledWith(1, 'wallet-a', 0);
    expect(storageService.setActiveWallet).toHaveBeenNthCalledWith(2, 'wallet-b', 1);
    expect(storageService.storeBiometricPin).not.toHaveBeenCalled();
  });

  it('keeps the manual-PIN fallback when the target entry is absent or unavailable', async () => {
    (storageService.getBiometricPin as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('biometric invalidated'));
    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.biometricAvailable).toBe(true));

    await act(async () => {
      await expect(result.current.selectWalletWithBiometric('wallet-b', 0)).resolves.toBe(false);
    });
    await act(async () => {
      await expect(result.current.selectWalletWithBiometric('wallet-b', 0)).resolves.toBe(false);
    });
    expect(storageService.verifyMasterKeyPin).not.toHaveBeenCalled();
    expect(storageService.setActiveWallet).not.toHaveBeenCalled();

    (storageService.verifyMasterKeyPin as jest.Mock).mockResolvedValue(true);
    (storageService.setActiveWallet as jest.Mock).mockResolvedValue(undefined);
    (storageService.unlockWallet as jest.Mock).mockResolvedValue(undefined);
    await act(async () => {
      await expect(result.current.selectWallet('wallet-b', 0, '222222')).resolves.toBe(true);
    });
    expect(storageService.storeBiometricPin).toHaveBeenCalledWith('wallet-b', '222222');
  });

  it('disabling biometrics clears every master-wallet entry and the global preference', async () => {
    (storageService.loadMultiWalletStorage as jest.Mock).mockResolvedValue({
      masterKeys: [{ id: 'wallet-a' }, { id: 'wallet-b' }],
    });
    (storageService.deleteBiometricPin as jest.Mock).mockResolvedValue(undefined);
    (settingsService.updateUserSettings as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.biometricAvailable).toBe(true));

    await act(async () => {
      await expect(result.current.disableBiometric()).resolves.toEqual({ ok: true });
    });

    expect(storageService.deleteBiometricPin).toHaveBeenCalledTimes(2);
    expect(storageService.deleteBiometricPin).toHaveBeenCalledWith('wallet-a');
    expect(storageService.deleteBiometricPin).toHaveBeenCalledWith('wallet-b');
    expect(settingsService.updateUserSettings).toHaveBeenCalledWith({ biometricEnabled: false });
    expect(result.current.biometricEnabled).toBe(false);
  });

  it('switches sub-wallets without PIN verification or biometric storage access', async () => {
    primeSessionPin('111111');
    (storageService.getActiveWalletInfo as jest.Mock).mockResolvedValue({
      masterKeyId: 'wallet-b', subWalletIndex: 2,
    });
    (storageService.setActiveWallet as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.currentMasterKeyId).toBe('wallet-b'));

    await act(async () => {
      await expect(result.current.selectSubWallet(2)).resolves.toBe(true);
    });

    expect(storageService.setActiveWallet).toHaveBeenCalledWith('wallet-b', 2);
    expect(storageService.verifyMasterKeyPin).not.toHaveBeenCalled();
    expect(storageService.getBiometricPin).not.toHaveBeenCalled();
    expect(storageService.storeBiometricPin).not.toHaveBeenCalled();
  });
});
