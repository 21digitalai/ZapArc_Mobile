import { act, renderHook, waitFor } from '@testing-library/react-native';

let mockWalletSwitchListener: ((event: {
  masterKeyId: string;
  subWalletIndex: number;
  balance: number;
  transactions: unknown[];
}) => void) | null = null;

jest.mock('../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(), isEnrolledAsync: jest.fn(),
}));
jest.mock('../hooks/useWalletAuth', () => ({ primeSessionPin: jest.fn() }));
jest.mock('../services', () => ({
  storageService: {
    loadMultiWalletStorage: jest.fn(), verifyMasterKeyPin: jest.fn(),
    deleteBiometricPin: jest.fn(), deleteMasterKey: jest.fn(),
    getActiveWalletInfo: jest.fn(), updateSubWalletActivity: jest.fn(),
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
  onWalletSwitch: jest.fn((listener) => {
    mockWalletSwitchListener = listener;
    return jest.fn();
  }),
}));
jest.mock('../services/notificationSubscriptionService', () => ({
  clearMasterKeyAddresses: jest.fn().mockResolvedValue(undefined),
}));

import { storageService } from '../services';
import * as WalletCache from '../services/walletCacheService';
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

  it('updates the mounted provider on the first secondary-to-Main return', async () => {
    let activeIndex = 0;
    const storageFor = (index: number) => ({
      activeMasterKeyId: 'wallet-a',
      activeSubWalletIndex: index,
      masterKeys: [{
        id: 'wallet-a',
        nickname: 'A',
        subWallets: [
          { index: 0, nickname: 'Main' },
          { index: 1, nickname: 'Secondary' },
        ],
      }],
    });

    (storageService.loadMultiWalletStorage as jest.Mock)
      .mockImplementation(async () => storageFor(activeIndex));
    (storageService.getActiveWalletInfo as jest.Mock)
      .mockImplementation(async () => ({ masterKeyId: 'wallet-a', subWalletIndex: activeIndex }));
    (WalletCache.getCachedBalance as jest.Mock)
      .mockImplementation(async (_masterKeyId: string, index: number) => ({
        balance: index === 0 ? 100 : 20,
        isStale: false,
      }));
    (WalletCache.getCachedTransactions as jest.Mock)
      .mockImplementation(async (_masterKeyId: string, index: number) => ({
        transactions: [{ id: index === 0 ? 'main-tx' : 'secondary-tx' }],
        isStale: false,
      }));

    const { result } = renderHook(() => useWalletStateInternal());
    await waitFor(() => expect(result.current.activeSubWallet?.index).toBe(0));
    expect(mockWalletSwitchListener).not.toBeNull();

    activeIndex = 1;
    await act(async () => {
      mockWalletSwitchListener?.({
        masterKeyId: 'wallet-a', subWalletIndex: 1, balance: 20,
        transactions: [{ id: 'secondary-tx' }],
      });
    });
    await waitFor(() => {
      expect(result.current.activeSubWallet?.index).toBe(1);
      expect(result.current.balance).toBe(20);
      expect(result.current.transactions[0]?.id).toBe('secondary-tx');
    });

    activeIndex = 0;
    await act(async () => {
      mockWalletSwitchListener?.({
        masterKeyId: 'wallet-a', subWalletIndex: 0, balance: 100,
        transactions: [{ id: 'main-tx' }],
      });
    });
    await waitFor(() => {
      expect(result.current.activeSubWallet?.index).toBe(0);
      expect(result.current.balance).toBe(100);
      expect(result.current.transactions[0]?.id).toBe('main-tx');
    });
  });
});
