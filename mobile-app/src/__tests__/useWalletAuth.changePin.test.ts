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
    isWalletUnlocked: jest.fn().mockResolvedValue(true),
    getActiveWalletInfo: jest.fn().mockResolvedValue({ masterKeyId: 'wallet-a', subWalletIndex: 0 }),
    getLastActivity: jest.fn().mockResolvedValue(Date.now()),
    updateActivity: jest.fn(),
    verifyMasterKeyPin: jest.fn().mockResolvedValue(true),
    getPinAuthStatus: jest.fn().mockResolvedValue({ isLocked: false, remainingMs: 0 }),
    rotateActiveMasterKeyPin: jest.fn().mockResolvedValue(true),
    storeBiometricPin: jest.fn(),
    deleteBiometricPin: jest.fn(),
    hasBiometricPin: jest.fn(),
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

import { settingsService, storageService } from '../services';
import { primeSessionPin, useWalletAuth } from '../hooks/useWalletAuth';

describe('useWalletAuth changePin biometric recovery', () => {
  beforeEach(() => jest.clearAllMocks());

  it('disables biometric unlock when a post-rotation rebind and verified clear both fail', async () => {
    (storageService.storeBiometricPin as jest.Mock).mockRejectedValue(new Error('keystore write failed'));
    (storageService.deleteBiometricPin as jest.Mock).mockRejectedValue(new Error('keystore delete failed'));
    (settingsService.updateUserSettings as jest.Mock).mockResolvedValue({ biometricEnabled: false });

    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.currentMasterKeyId).toBe('wallet-a'));
    primeSessionPin('111111');

    await act(async () => {
      await expect(result.current.changePin('222222')).resolves.toBe(true);
    });

    expect(storageService.rotateActiveMasterKeyPin).toHaveBeenCalledWith('wallet-a', '111111', '222222');
    expect(storageService.deleteBiometricPin).toHaveBeenCalledWith('wallet-a');
    expect(settingsService.updateUserSettings).toHaveBeenCalledWith({ biometricEnabled: false });
    expect(result.current.biometricEnabled).toBe(false);
    expect(result.current.error).toMatch(/biometric unlock was disabled/i);
  });

  it('rejects PIN rotation after the unlocked session credential is cleared', async () => {
    primeSessionPin(null);
    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.currentMasterKeyId).toBe('wallet-a'));

    await act(async () => {
      await expect(result.current.changePin('222222')).resolves.toBe(false);
    });

    expect(storageService.rotateActiveMasterKeyPin).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/unlock this wallet/i);
  });

  it('serializes duplicate PIN changes without recording a false failed attempt', async () => {
    let finishRotation: ((changed: boolean) => void) | undefined;
    (storageService.rotateActiveMasterKeyPin as jest.Mock).mockImplementation(
      () => new Promise<boolean>((resolve) => {
        finishRotation = resolve;
      })
    );
    (storageService.getPinAuthStatus as jest.Mock).mockResolvedValue({
      isLocked: false,
      remainingMs: 0,
      failedAttempts: 0,
    });

    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => expect(result.current.currentMasterKeyId).toBe('wallet-a'));
    primeSessionPin('111111');

    let firstChange: Promise<boolean> | undefined;
    let secondChange: Promise<boolean> | undefined;
    await act(async () => {
      firstChange = result.current.changePin('222222');
      secondChange = result.current.changePin('222222');
    });

    expect(storageService.rotateActiveMasterKeyPin).toHaveBeenCalledTimes(1);
    await expect(secondChange).resolves.toBe(false);
    expect(storageService.getPinAuthStatus).not.toHaveBeenCalled();

    await act(async () => {
      finishRotation?.(true);
      await expect(firstChange).resolves.toBe(true);
    });

    expect(storageService.getPinAuthStatus).not.toHaveBeenCalled();
  });
});
