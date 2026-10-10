import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
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
    getActiveWalletInfo: jest
      .fn()
      .mockResolvedValue({ masterKeyId: 'wallet-a', subWalletIndex: 0 }),
    getLastActivity: jest.fn().mockResolvedValue(Date.now()),
    updateActivity: jest.fn(),
    rotateActiveMasterKeyPin: jest.fn().mockResolvedValue(true),
    storeBiometricPin: jest.fn(),
    deleteBiometricPin: jest.fn(),
  },
  settingsService: {
    getUserSettings: jest
      .fn()
      .mockResolvedValue({ autoLockTimeout: 0, biometricEnabled: false }),
    updateUserSettings: jest.fn(),
  },
}));

jest.mock('../services/breezSparkService', () => ({
  disconnectSDK: jest.fn(),
  initializeSDK: jest.fn(),
}));
jest.mock('../services/walletCacheService', () => ({
  getCachedBalance: jest.fn().mockResolvedValue(null),
  getCachedTransactions: jest.fn().mockResolvedValue(null),
  setPreloadedData: jest.fn(),
  emitWalletSwitch: jest.fn(),
}));

import { settingsService, storageService } from '../services';
import { primeSessionPin, useWalletAuth } from '../hooks/useWalletAuth';

describe('useWalletAuth changePin after biometric opt-in', () => {
  it('clears the biometric credential after a PIN change without prompting', async () => {
    const { result } = renderHook(() => useWalletAuth());
    await waitFor(() => {
      expect(result.current.currentMasterKeyId).toBe('wallet-a');
      expect(result.current.biometricEnabled).toBe(false);
    });
    primeSessionPin('111111');

    await act(async () => {
      await expect(result.current.enableBiometric()).resolves.toEqual({ ok: true });
    });
    expect(result.current.biometricEnabled).toBe(true);

    (storageService.storeBiometricPin as jest.Mock).mockClear();
    await act(async () => {
      await expect(result.current.changePin('222222', 'wallet-a')).resolves.toBe(true);
    });

    expect(settingsService.updateUserSettings).toHaveBeenCalledWith({
      biometricEnabled: true,
    });
    expect(storageService.deleteBiometricPin).toHaveBeenCalledWith('wallet-a');
    expect(storageService.storeBiometricPin).not.toHaveBeenCalled();
  });
});
