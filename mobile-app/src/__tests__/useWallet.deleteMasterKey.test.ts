import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(), isEnrolledAsync: jest.fn(),
}));
jest.mock('../hooks/useWalletAuth', () => ({ primeSessionPin: jest.fn() }));
jest.mock('../services', () => ({
  storageService: {
    loadMultiWalletStorage: jest.fn(), verifyMasterKeyPin: jest.fn(),
    deleteBiometricPin: jest.fn(), deleteMasterKey: jest.fn(),
  },
  settingsService: {},
}));
jest.mock('../services/breezSparkService', () => ({
  disconnectSDK: jest.fn().mockResolvedValue(undefined), isSDKInitialized: jest.fn(() => false),
}));
jest.mock('../services/walletCacheService', () => ({
  getCachedBalance: jest.fn().mockResolvedValue(null),
  getCachedTransactions: jest.fn().mockResolvedValue(null),
  getCachedTokenBalances: jest.fn().mockResolvedValue(null),
  consumePreloadedBalance: jest.fn().mockReturnValue(null),
  consumePreloadedTransactions: jest.fn().mockReturnValue(null),
}));
jest.mock('../services/notificationSubscriptionService', () => ({
  clearMasterKeyAddresses: jest.fn().mockResolvedValue(undefined),
}));

import { storageService } from '../services';
import { useWalletStateInternal } from '../hooks/useWallet';

describe('useWalletStateInternal master-wallet deletion', () => {
  it('deletes the wallet-specific biometric entry before deleting the master key', async () => {
    (storageService.loadMultiWalletStorage as jest.Mock)
      .mockResolvedValueOnce({
        activeMasterKeyId: 'wallet-a', activeSubWalletIndex: 0,
        masterKeys: [{ id: 'wallet-a', nickname: 'A', subWallets: [{ index: 0, nickname: 'Main' }] }],
      })
      .mockResolvedValueOnce({ activeMasterKeyId: null, activeSubWalletIndex: 0, masterKeys: [] });
    (storageService.verifyMasterKeyPin as jest.Mock).mockResolvedValue(true);
    (storageService.deleteBiometricPin as jest.Mock).mockResolvedValue(undefined);
    (storageService.deleteMasterKey as jest.Mock).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWalletStateInternal());
    await waitFor(() => expect(result.current.activeMasterKey?.id).toBe('wallet-a'));

    await act(async () => {
      await expect(result.current.deleteMasterKey('wallet-a', '111111')).resolves.toEqual({
        activeDeleted: true, nextActiveId: null,
      });
    });

    expect(storageService.deleteBiometricPin).toHaveBeenCalledWith('wallet-a');
    expect(storageService.deleteMasterKey).toHaveBeenCalledWith('wallet-a');
    expect((storageService.deleteBiometricPin as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((storageService.deleteMasterKey as jest.Mock).mock.invocationCallOrder[0]);
  });
});
