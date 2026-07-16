/* eslint-disable @typescript-eslint/no-var-requires */
/* global require */

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: '' }),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { expoProjectId: 'test-project' } },
}));

jest.mock('../notificationTriggerService', () => ({
  NotificationTriggerService: {
    registerDevice: jest.fn().mockResolvedValue(undefined),
    syncSubscriptions: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockSendPayment = jest.fn();
const mockPrepareSendPayment = jest.fn();
const mockParse = jest.fn();
const mockGetCrossChainRoutes = jest.fn();
const mockAddEventListener = jest.fn().mockResolvedValue('listener-id');
const mockRemoveEventListener = jest.fn().mockResolvedValue(undefined);

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
  Seed: {
    Mnemonic: function (params: unknown) {
      return params;
    },
  },
  Network: { Mainnet: 'mainnet' },
  OnchainConfirmationSpeed: { Fast: 'fast', Medium: 'medium', Slow: 'slow' },
  MaxFee: {
    NetworkRecommended: function (inner: unknown) {
      return { type: 'networkRecommended', ...((inner as object) || {}) };
    },
  },
  SendPaymentOptions: {
    BitcoinAddress: function ({ confirmationSpeed }: { confirmationSpeed: string }) {
      return { type: 'bitcoinAddress', confirmationSpeed };
    },
  },
  PaymentRequest: {
    CrossChain: { new: (params: unknown) => ({ tag: 'CrossChain', inner: params }) },
  },
  CrossChainRouteFilter: {
    Send: { new: (params: unknown) => ({ tag: 'CrossChainSend', inner: params }) },
  },
  defaultConfig: jest.fn(() => ({})),
  connect: jest.fn().mockResolvedValue({
    sendPayment: (...args: unknown[]) => mockSendPayment(...args),
    prepareSendPayment: (...args: unknown[]) => mockPrepareSendPayment(...args),
    parse: (...args: unknown[]) => mockParse(...args),
    getCrossChainRoutes: (...args: unknown[]) => mockGetCrossChainRoutes(...args),
    addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
    removeEventListener: (...args: unknown[]) => mockRemoveEventListener(...args),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getLightningAddress: jest.fn().mockResolvedValue(null),
    getInfo: jest.fn().mockResolvedValue({ identityPubkey: undefined }),
  }),
}));

describe('BreezSparkService.sendOnchainPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['fast', 'medium', 'slow'] as const)(
    'passes correct confirmationSpeed (%s) to SDK sendPayment',
    async (speed) => {
      const svc = require('../breezSparkService');
      await svc.initializeSDK('test mnemonic words go here twelve words');

      mockSendPayment.mockResolvedValueOnce({ payment: { id: `payment-${speed}` } });

      const prepareResponse = { paymentMethod: { tag: 'BitcoinAddress' } };
      const result = await svc.sendOnchainPayment(prepareResponse, speed, 'idem-key');

      expect(result).toEqual({ success: true, paymentId: `payment-${speed}` });
      expect(mockSendPayment).toHaveBeenCalledWith({
        prepareResponse,
        idempotencyKey: 'idem-key',
        options: {
          type: 'bitcoinAddress',
          confirmationSpeed: speed,
        },
      });
    }
  );

  it('returns failure when SDK sendPayment throws', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');

    mockSendPayment.mockRejectedValueOnce(new Error('fee estimation unavailable'));

    const result = await svc.sendOnchainPayment({}, 'medium');

    expect(result).toMatchObject({ success: false, error: 'fee estimation unavailable' });
  });

  it('returns not initialized error when no sdk instance', async () => {
    const svc = require('../breezSparkService');
    await svc.disconnectSDK();

    const result = await svc.sendOnchainPayment({}, 'medium');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });
});

describe('normalizeCrossChainDestinationRoutes', () => {
  it('keeps live EVM, Solana, and Tron routes for the selected stablecoin', () => {
    const svc = require('../breezSparkService');

    const routes = svc.normalizeCrossChainDestinationRoutes([
      { provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDC', decimals: 6, exactOutEligible: true },
      { provider: 'Orchestra', chain: 'solana', asset: 'USDC', decimals: 6, exactOutEligible: false },
      { provider: 'Boltz', chain: 'tron', asset: 'USDC', decimals: 6, exactOutEligible: true },
      { provider: 'Orchestra', chain: 'ethereum', chainId: '1', asset: 'USDT', decimals: 6, exactOutEligible: true },
    ], 'USDC');

    expect(routes).toEqual([
      expect.objectContaining({ chain: 'base', chainId: '8453', asset: 'USDC' }),
      expect.objectContaining({ chain: 'solana', asset: 'USDC' }),
      expect.objectContaining({ chain: 'tron', asset: 'USDC' }),
    ]);
  });

  it('deduplicates provider routes and rejects malformed or wrong-asset records', () => {
    const svc = require('../breezSparkService');

    const routes = svc.normalizeCrossChainDestinationRoutes([
      { provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDT', decimals: 6 },
      { provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDT', decimals: 6 },
      { provider: 'Orchestra', chain: '', asset: 'USDT' },
      { provider: 'Orchestra', chain: 'solana', asset: 'USDC' },
    ], 'USDT');

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ chain: 'base', asset: 'USDT', decimals: 6 });
  });
});

describe('getCrossChainSendRoutesForAddress', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses the recipient, fetches Send routes, and preserves the raw SDK route', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    const addressDetails = { chain: 'base', address: '0xabc' };
    const rawRoute = {
      provider: 'Orchestra', chain: 'base', chainId: '8453', asset: 'USDC', decimals: 6,
    };
    mockParse.mockResolvedValueOnce({ tag: 'CrossChainAddress', inner: [addressDetails] });
    mockGetCrossChainRoutes.mockResolvedValueOnce([rawRoute]);

    const routes = await svc.getCrossChainSendRoutesForAddress(' 0xabc ', 'USDC');

    expect(mockParse).toHaveBeenCalledWith('0xabc');
    expect(mockGetCrossChainRoutes).toHaveBeenCalledWith({
      tag: 'CrossChainSend', inner: { addressDetails },
    });
    expect(routes).toEqual([{
      route: rawRoute,
      destination: expect.objectContaining({ chain: 'base', chainId: '8453', asset: 'USDC' }),
    }]);
  });

  it('rejects a non-cross-chain address before requesting routes', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockResolvedValueOnce({ tag: 'BitcoinAddress', inner: {} });

    await expect(svc.getCrossChainSendRoutesForAddress('bc1invalid', 'USDT'))
      .rejects.toThrow('Enter a valid EVM, Solana, or Tron address');
    expect(mockGetCrossChainRoutes).not.toHaveBeenCalled();
  });

  it('keeps only routes compatible with the inherited BTC or USDB source', () => {
    const svc = require('../breezSparkService');
    const btcRoute = { supportedSources: [{ tag: 'Bitcoin' }] };
    const usdbRoute = { supportedSources: [{ tag: 'Token', inner: { tokenIdentifier: 'usdb-token' } }] };

    expect(svc.isCrossChainRouteCompatibleWithFundingSource(btcRoute, { asset: 'BTC' })).toBe(true);
    expect(svc.isCrossChainRouteCompatibleWithFundingSource(usdbRoute, { asset: 'BTC' })).toBe(false);
    expect(svc.isCrossChainRouteCompatibleWithFundingSource(usdbRoute, {
      asset: 'USDB', tokenIdentifier: 'usdb-token',
    })).toBe(true);
    expect(svc.isCrossChainRouteCompatibleWithFundingSource(usdbRoute, {
      asset: 'USDB', tokenIdentifier: 'other-token',
    })).toBe(false);
  });
});

describe('prepareCrossChainSendPayment', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [undefined, 2500],
    ['usdb-token-id', 2500000],
  ])('forwards source token and source amount units', async (tokenIdentifier, amount) => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockPrepareSendPayment.mockResolvedValueOnce({ paymentMethod: { tag: 'CrossChainAddress' } });

    await svc.prepareCrossChainSendPayment('0xabc', { chain: 'base', asset: 'USDC' }, amount, { tokenIdentifier });

    expect(mockPrepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: BigInt(amount),
      tokenIdentifier,
      paymentRequest: expect.objectContaining({ tag: 'CrossChain' }),
    }));
  });
});
