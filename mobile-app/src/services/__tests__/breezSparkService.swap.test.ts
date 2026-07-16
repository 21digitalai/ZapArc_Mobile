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
  receivePayment: jest.fn(),
  prepareSendPayment: jest.fn(),
};

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

// prepareSwap requires a BTC/USD rate to convert source↔destination units.
// Provide a cached rate so the swap helpers can price; individual tests
// override this to exercise the no-rate guard.
const mockCurrency = {
  getCachedRates: jest.fn(() => ({ usd: 100000 })),
  getExchangeRates: jest.fn().mockResolvedValue({ usd: 100000 }),
};
jest.mock('../../utils/currency', () => mockCurrency);

jest.mock('@breeztech/breez-sdk-spark-react-native', () => {
  function FromBitcoin(this: Record<string, unknown>) {
    this.tag = 'FromBitcoin';
  }
  FromBitcoin.new = () => ({ tag: 'FromBitcoin' });

  function ToBitcoin(this: Record<string, unknown>, { fromTokenIdentifier }: { fromTokenIdentifier: string }) {
    this.tag = 'ToBitcoin';
    this.fromTokenIdentifier = fromTokenIdentifier;
  }
  ToBitcoin.new = ({ fromTokenIdentifier }: { fromTokenIdentifier: string }) => ({ tag: 'ToBitcoin', fromTokenIdentifier });

  return {
    Seed: { Mnemonic: function (params: unknown) { return params; } },
    Network: { Mainnet: 'mainnet' },
    MaxFee: { NetworkRecommended: function (inner: unknown) { return { ...((inner as object) || {}) }; } },
    ConversionType: { FromBitcoin, ToBitcoin },
    defaultConfig: jest.fn(() => ({})),
    connect: jest.fn().mockImplementation(async () => mockSdk),
  };
});

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
    mockSdk.receivePayment.mockResolvedValue({ paymentRequest: 'spark:req' });
    mockSdk.prepareSendPayment.mockResolvedValue({ receiveAmount: 900n, feeSat: 10n, rate: 1.2 });
    mockSdk.sendPayment.mockResolvedValue({ payment: { id: 'payment-1' } });
    mockCurrency.getCachedRates.mockReturnValue({ usd: 100000 });
    mockCurrency.getExchangeRates.mockResolvedValue({ usd: 100000 });
  });

  async function initAndResolve() {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockSdk.getTokenIssuer.mockResolvedValue({ ticker: 'USDB', identifier: 'usdb-token-id' });
    mockSdk.getInfo.mockResolvedValue({ tokenBalances: [{ ticker: 'USDB', tokenIdentifier: 'usdb-token-id' }], identityPubkey: undefined });
    mockSdk.getTokensMetadata.mockResolvedValue({ tokensMetadata: [{ ticker: 'USDB', identifier: 'usdb-token-id', decimals: 6 }] });
    await svc.resolveSwapTokens();
    return svc;
  }

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

    expect(first[0]).toMatchObject({ id: 'USDB', tokenIdentifier: 'usdb-token-id', internalDecimals: 6 });
    expect(second[0].tokenIdentifier).toBe('usdb-token-id');
    expect(mockSdk.getTokensMetadata).toHaveBeenCalledTimes(1);
  });

  it('fetches BTC->USDB limits with FromBitcoin conversionType', async () => {
    const svc = await initAndResolve();
    mockSdk.fetchConversionLimits.mockResolvedValue({ min: 100n, max: 200000n });

    const limits = await svc.fetchSwapLimits('BTC_TO_USDB');

    expect(limits).toEqual({ min: 100n, max: 200000n });
    expect(mockSdk.fetchConversionLimits).toHaveBeenCalledWith(expect.objectContaining({
      tokenIdentifier: 'usdb-token-id',
      conversionType: expect.objectContaining({ tag: 'FromBitcoin' }),
    }));
  });

  it('fetches USDB->BTC limits with ToBitcoin + fromTokenIdentifier', async () => {
    const svc = await initAndResolve();
    mockSdk.fetchConversionLimits.mockResolvedValue({ minAmount: '10', maxAmount: '99999' });

    const limits = await svc.fetchSwapLimits('USDB_TO_BTC');

    expect(limits).toEqual({ min: 10n, max: 99999n });
    expect(mockSdk.fetchConversionLimits).toHaveBeenCalledWith({
      conversionType: { tag: 'ToBitcoin', fromTokenIdentifier: 'usdb-token-id' },
    });
  });

  it('prepareSwap BTC_TO_USDB sets FromBitcoin and converts sats to USDB base units', async () => {
    const svc = await initAndResolve();
    await svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 1000n, slippageBps: 50 });

    expect(mockSdk.receivePayment).toHaveBeenCalledWith({
      paymentMethod: expect.objectContaining({
        tag: 'SparkInvoice',
        inner: expect.objectContaining({ tokenIdentifier: 'usdb-token-id' }),
      }),
    });
    // The SDK amount is the DESTINATION unit (USDB base units), not the raw
    // sats. At rate $100,000/BTC and 6 USDB decimals: 1000 sats = $1.00 =
    // 1,000,000 base units.
    expect(mockSdk.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1000000n,
      conversionOptions: expect.objectContaining({ conversionType: { tag: 'FromBitcoin' }, maxSlippageBps: 50, completionTimeoutSecs: 30 }),
    }));
  });

  it('prepareSwap USDB_TO_BTC omits top-level token identifier and sets ToBitcoin source token', async () => {
    const svc = await initAndResolve();
    await svc.prepareSwap({ direction: 'USDB_TO_BTC', amount: 2000n, slippageBps: 100 });

    expect(mockSdk.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      tokenIdentifier: undefined,
      conversionOptions: expect.objectContaining({
        conversionType: { tag: 'ToBitcoin', fromTokenIdentifier: 'usdb-token-id' },
      }),
    }));
  });

  it('executeSwap success returns payment id', async () => {
    const svc = await initAndResolve();
    const quote = await svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 3000n, slippageBps: 50 });

    const outcome = await svc.executeSwap(quote);

    expect(outcome).toEqual(expect.objectContaining({
      kind: 'success',
      result: expect.objectContaining({ paymentId: 'payment-1' }),
    }));
  });

  it('executeSwap returns refunded when sendPayment throws slippage/refund error', async () => {
    const svc = await initAndResolve();
    mockSdk.sendPayment.mockRejectedValueOnce(new Error('conversion refunded due to slippage'));
    const quote = await svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 3000n, slippageBps: 1 });

    const outcome = await svc.executeSwap(quote);

    expect(outcome).toEqual({ kind: 'refunded' });
  });

  it('executeSwap returns refunded when resolved payment includes refund marker', async () => {
    const svc = await initAndResolve();
    mockSdk.sendPayment.mockResolvedValueOnce({ payment: { id: 'p2', refundStatus: 'refunded' } });
    const quote = await svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 3000n, slippageBps: 1 });

    const outcome = await svc.executeSwap(quote);

    expect(outcome).toEqual({ kind: 'refunded' });
  });

  it('executeSwap timeout returns retryable error', async () => {
    const svc = await initAndResolve();
    mockSdk.sendPayment.mockRejectedValueOnce(new Error('completion_timeout_secs exceeded'));
    const quote = await svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 3000n, slippageBps: 50 });

    const outcome = await svc.executeSwap(quote);

    expect(outcome.kind).toBe('error');
    expect(outcome.retryable).toBe(true);
  });

  it('executeSwap reports only the RESERVED-but-unspent USDB as dust residual', async () => {
    const svc = await initAndResolve();
    // The prepare reserved 100 base units (conversionEstimate.amountIn); the
    // swap actually consumed 96 (balance 100 -> 4), so the true slippage
    // residual is 100 - 96 = 4 — NOT the whole 4-unit remaining balance by
    // coincidence, but the reserved-minus-consumed delta.
    mockSdk.prepareSendPayment.mockResolvedValueOnce({
      amount: 3000n,
      conversionEstimate: { amountIn: 100n, amountOut: 3000n, fee: 0n },
    });
    mockSdk.getInfo
      .mockResolvedValueOnce({ tokenBalances: [{ tokenIdentifier: 'usdb-token-id', balance: 100n }] })
      .mockResolvedValueOnce({ tokenBalances: [{ tokenIdentifier: 'usdb-token-id', balance: 4n }] });

    const quote = await svc.prepareSwap({ direction: 'USDB_TO_BTC', amount: 3000n, slippageBps: 50 });
    const outcome = await svc.executeSwap(quote);

    expect(outcome.kind).toBe('dustResidual');
    expect((outcome as { residualUsdbBaseUnits: bigint }).residualUsdbBaseUnits).toBe(4n);
  });

  it('executeSwap does NOT report a partial-swap remainder as dust', async () => {
    const svc = await initAndResolve();
    // Reserved 30 units, consumed all 30 (balance 100 -> 70). The 70 left is the
    // user's intentional remainder, not dust — residual must be 0 -> success.
    mockSdk.prepareSendPayment.mockResolvedValueOnce({
      amount: 3000n,
      conversionEstimate: { amountIn: 30n, amountOut: 3000n, fee: 0n },
    });
    mockSdk.getInfo
      .mockResolvedValueOnce({ tokenBalances: [{ tokenIdentifier: 'usdb-token-id', balance: 100n }] })
      .mockResolvedValueOnce({ tokenBalances: [{ tokenIdentifier: 'usdb-token-id', balance: 70n }] });

    const quote = await svc.prepareSwap({ direction: 'USDB_TO_BTC', amount: 3000n, slippageBps: 50 });
    const outcome = await svc.executeSwap(quote);

    expect(outcome.kind).toBe('success');
  });

  it('prepareSwap throws instead of building a garbage quote when no rate is available', async () => {
    const svc = await initAndResolve();
    mockCurrency.getCachedRates.mockReturnValue(null as unknown as { usd: number });
    mockCurrency.getExchangeRates.mockResolvedValue(null as unknown as { usd: number });

    await expect(
      svc.prepareSwap({ direction: 'BTC_TO_USDB', amount: 3000n, slippageBps: 50 })
    ).rejects.toThrow(/rate unavailable/i);
  });
});
