import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../storageService', () => ({
  storageService: { getActiveWalletInfo: jest.fn() },
}));
jest.mock('../breezSparkService', () => ({
  checkLightningAddressAvailable: jest.fn(),
  registerLightningAddress: jest.fn(),
  getLightningAddress: jest.fn(),
  unregisterLightningAddress: jest.fn(),
  isSDKInitialized: jest.fn(() => false),
  getConnectedWalletIdentity: jest.fn(() => null),
}));

import {
  cacheAddress,
  clearAddressCache,
  getAddress,
  getCachedAddress,
} from '../lightningAddressService';
import { getConnectedWalletIdentity, getLightningAddress, isSDKInitialized } from '../breezSparkService';

const main = { masterKeyId: 'wallet-a', subWalletIndex: 0 };
const secondary = { masterKeyId: 'wallet-a', subWalletIndex: 1 };

describe('LightningAddressService wallet-scoped cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    (isSDKInitialized as jest.Mock).mockReturnValue(false);
    (getConnectedWalletIdentity as jest.Mock).mockReturnValue(null);
  });

  it('migrates the legacy global address only into Main', async () => {
    await AsyncStorage.setItem('@lightning_address_info', JSON.stringify({
      lightningAddress: 'main@breez.tips',
      username: 'main',
      description: 'Main',
      lnurl: 'lnurl-main',
    }));

    await expect(getCachedAddress(secondary)).resolves.toBeNull();
    await expect(getCachedAddress(main)).resolves.toMatchObject({
      lightningAddress: 'main@breez.tips',
    });
    await expect(AsyncStorage.getItem('@lightning_address_info')).resolves.toBeNull();
  });

  it('keeps Main and secondary addresses isolated', async () => {
    await cacheAddress({
      lightningAddress: 'main@breez.tips', username: 'main', description: 'Main', lnurl: 'lnurl-main',
    }, main);
    await cacheAddress({
      lightningAddress: 'second@breez.tips', username: 'second', description: 'Second', lnurl: 'lnurl-second',
    }, secondary);

    await expect(getCachedAddress(main)).resolves.toMatchObject({
      lightningAddress: 'main@breez.tips',
    });
    await expect(getCachedAddress(secondary)).resolves.toMatchObject({
      lightningAddress: 'second@breez.tips',
    });

    await clearAddressCache(secondary);
    await expect(getCachedAddress(secondary)).resolves.toBeNull();
    await expect(getCachedAddress(main)).resolves.toMatchObject({
      lightningAddress: 'main@breez.tips',
    });
  });

  it('preserves the selected wallet cache when the connected SDK belongs to another wallet', async () => {
    await cacheAddress({
      lightningAddress: 'main@breez.tips', username: 'main', description: 'Main', lnurl: 'lnurl-main',
    }, main);
    (isSDKInitialized as jest.Mock).mockReturnValue(true);
    (getConnectedWalletIdentity as jest.Mock).mockReturnValue(secondary);

    await expect(getAddress(main)).resolves.toMatchObject({
      success: true,
      data: { lightningAddress: 'main@breez.tips' },
    });
    expect(getLightningAddress).not.toHaveBeenCalled();
    await expect(getCachedAddress(main)).resolves.toMatchObject({
      lightningAddress: 'main@breez.tips',
    });
  });

  it('clears a scoped cache only after the matching SDK confirms no address', async () => {
    await cacheAddress({
      lightningAddress: 'main@breez.tips', username: 'main', description: 'Main', lnurl: 'lnurl-main',
    }, main);
    (isSDKInitialized as jest.Mock).mockReturnValue(true);
    (getConnectedWalletIdentity as jest.Mock).mockReturnValue(main);
    (getLightningAddress as jest.Mock).mockResolvedValue(null);

    await expect(getAddress(main)).resolves.toEqual({ success: true, data: null });
    await expect(getCachedAddress(main)).resolves.toBeNull();
  });
});
