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
}));

import {
  cacheAddress,
  clearAddressCache,
  getCachedAddress,
} from '../lightningAddressService';

const main = { masterKeyId: 'wallet-a', subWalletIndex: 0 };
const secondary = { masterKeyId: 'wallet-a', subWalletIndex: 1 };

describe('LightningAddressService wallet-scoped cache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
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
});
