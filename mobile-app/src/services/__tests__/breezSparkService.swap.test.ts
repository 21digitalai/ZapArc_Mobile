/* eslint-disable @typescript-eslint/no-var-requires */

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: '' }),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { expoProjectId: 'test-project' } },
}));

jest.mock('../notificationTriggerService', () => ({
  NotificationTriggerService: {
    registerDevice: jest.fn().mockResolvedValue(undefined),
    sendTransactionNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockSdk = {
  getTokenIssuer: jest.fn(),
  getInfo: jest.fn(),
  getTokensMetadata: jest.fn(),
  fetchConversionLimits: jest.fn(),
  addEventListener: jest.fn().mockResolvedValue('listener-id'),
  removeEventListener: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getLightningAddress: jest.fn().mockResolvedValue(null),
  sendPayment: jest.fn(),
  listPayments: jest.fn().mockResolvedValue({ payments: [] }),
};

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
  Seed: { Mnemonic: function (params: unknown) { return params; } },
  Network: { Mainnet: 'mainnet' },
  MaxFee: { NetworkRecommended: function (inner: unknown) { return { ...((inner as object) || {}) }; } },
  defaultConfig: jest.fn(() => ({})),
  connect: jest.fn().mockImplementation(async () => mockSdk),
}));

describe('breezSparkService swap helpers', () => {
  beforeEach(async () => {
    jest.resetModules();
    Object.values(mockSdk).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as jest.Mock).mockReset();
      }
    });
    mockSdk.addEventListener.mockResolvedValue('listener-id');
    mockSdk.removeEventListener.mockResolvedValue(undefined);
    mockSdk.disconnect.mockResolvedValue(undefined);
    mockSdk.getLightningAddress.mockResolvedValue(null);
    mockSdk.listPayments.mockResolvedValue({ payments: [] });
  });

  it('resolves swap tokens via runtime discovery and caches metadata', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');

    mockSdk.getTokenIssuer.mockResolvedValue({ ticker: 'USDB', identifier: 'usdb-token-id' });
    mockSdk.getInfo.mockResolvedValue({
      tokenBalances: [{ ticker: 'USDB', tokenIdentifier: 'usdb-token-id' }],
      identityPubkey: undefined,
    });
    mockSdk.getTokensMetadata.mockResolvedValue({
      tokensMetadata: [{ ticker: 'USDB', identifier: 'usdb-token-id', decimals: 6 }],
    });

    const first = await svc.resolveSwapTokens();
    const second = await svc.resolveSwapTokens();

    expect(first[0]).toMatchObject({
      id: 'USDB',
      tokenIdentifier: 'usdb-token-id',
      internalDecimals: 6,
    });
    expect(second[0].tokenIdentifier).toBe('usdb-token-id');
    expect(mockSdk.getTokensMetadata).toHaveBeenCalledTimes(1);
  });

  it('fetches BTC->USDB limits with FromBitcoin conversionType', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');

    mockSdk.getTokenIssuer.mockResolvedValue({ ticker: 'USDB', identifier: 'usdb-token-id' });
    mockSdk.getInfo.mockResolvedValue({ tokenBalances: [{ ticker: 'USDB', tokenIdentifier: 'usdb-token-id' }], identityPubkey: undefined });
    mockSdk.getTokensMetadata.mockResolvedValue({ tokensMetadata: [{ ticker: 'USDB', identifier: 'usdb-token-id', decimals: 6 }] });
    mockSdk.fetchConversionLimits.mockResolvedValue({ min: 100n, max: 200000n });

    const limits = await svc.fetchSwapLimits('BTC_TO_USDB');

    expect(limits).toEqual({ min: 100n, max: 200000n });
    expect(mockSdk.fetchConversionLimits).toHaveBeenCalledWith({
      conversionType: { tag: 'FromBitcoin' },
    });
  });

  it('fetches USDB->BTC limits with ToBitcoin + fromTokenIdentifier', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');

    mockSdk.getTokenIssuer.mockResolvedValue({ ticker: 'USDB', identifier: 'usdb-token-id' });
    mockSdk.getInfo.mockResolvedValue({ tokenBalances: [{ ticker: 'USDB', tokenIdentifier: 'usdb-token-id' }], identityPubkey: undefined });
    mockSdk.getTokensMetadata.mockResolvedValue({ tokensMetadata: [{ ticker: 'USDB', identifier: 'usdb-token-id', decimals: 6 }] });
    mockSdk.fetchConversionLimits.mockResolvedValue({ minAmount: '10', maxAmount: '99999' });

    const limits = await svc.fetchSwapLimits('USDB_TO_BTC');

    expect(limits).toEqual({ min: 10n, max: 99999n });
    expect(mockSdk.fetchConversionLimits).toHaveBeenCalledWith({
      conversionType: { tag: 'ToBitcoin', fromTokenIdentifier: 'usdb-token-id' },
    });
  });
});
