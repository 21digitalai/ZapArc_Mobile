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
const mockParse = jest.fn();
const mockPrepareSendPayment = jest.fn();
const mockPrepareLnurlPay = jest.fn();
const mockLnurlPay = jest.fn();
const mockAddEventListener = jest.fn().mockResolvedValue('listener-id');
const mockRemoveEventListener = jest.fn().mockResolvedValue(undefined);
const mockGetPayment = jest.fn();
const mockListUnclaimedDeposits = jest.fn();
const mockClaimDeposit = jest.fn();
const mockListPayments = jest.fn().mockResolvedValue({ payments: [] });

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  exists: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
  PaymentRequest: {
    Input: {
      new: ({ input }: { input: string }) => ({
        tag: 'Input',
        inner: { input },
      }),
    },
  },
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
  defaultConfig: jest.fn(() => ({})),
  connect: jest.fn().mockResolvedValue({
    sendPayment: (...args: unknown[]) => mockSendPayment(...args),
    parse: (...args: unknown[]) => mockParse(...args),
    prepareSendPayment: (...args: unknown[]) => mockPrepareSendPayment(...args),
    prepareLnurlPay: (...args: unknown[]) => mockPrepareLnurlPay(...args),
    lnurlPay: (...args: unknown[]) => mockLnurlPay(...args),
    addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
    removeEventListener: (...args: unknown[]) => mockRemoveEventListener(...args),
    getPayment: (...args: unknown[]) => mockGetPayment(...args),
    listUnclaimedDeposits: (...args: unknown[]) => mockListUnclaimedDeposits(...args),
    claimDeposit: (...args: unknown[]) => mockClaimDeposit(...args),
    listPayments: (...args: unknown[]) => mockListPayments(...args),
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

      mockSendPayment.mockResolvedValueOnce({
        payment: { id: `payment-${speed}`, status: 'succeeded' },
      });

      const prepareResponse = { paymentMethod: { tag: 'BitcoinAddress' } };
      const result = await svc.sendOnchainPayment(prepareResponse, speed, 'idem-key');

      expect(result).toEqual({ success: true, paymentId: `payment-${speed}`, status: 'completed' });
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

  it.each([
    ['pending', { success: true, status: 'pending' }],
    ['failed', { success: false, status: 'failed', error: 'Payment failed — balance restored' }],
  ])('maps an immediate %s on-chain SDK response', async (sdkStatus, expected) => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockSendPayment.mockResolvedValueOnce({ payment: { id: 'payment-state', status: sdkStatus } });

    const result = await svc.sendOnchainPayment({}, 'medium');

    expect(result).toMatchObject(expected);
  });

  it('returns not initialized error when no sdk instance', async () => {
    const svc = require('../breezSparkService');
    await svc.disconnectSDK();

    const result = await svc.sendOnchainPayment({}, 'medium');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not initialized');
  });
});

describe('BreezSparkService.sendPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['succeeded', { success: true, status: 'completed' }],
    ['pending', { success: true, status: 'pending' }],
    ['failed', { success: false, status: 'failed', error: 'Payment failed — balance restored' }],
  ])('maps an immediate %s SDK response instead of assuming success', async (sdkStatus, expected) => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockSendPayment.mockResolvedValueOnce({ payment: { id: 'payment-state', status: sdkStatus } });

    const result = await svc.sendPayment({});

    expect(result).toMatchObject(expected);
  });
});

describe('BreezSparkService LNURL comments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes a valid recipient comment to native prepareLnurlPay', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    const payRequest = { commentAllowed: 40 };
    mockParse.mockResolvedValueOnce({ tag: 'LightningAddress', inner: { payRequest } });
    mockPrepareLnurlPay.mockResolvedValueOnce({ feeSats: 2n, amountSats: 1000n });

    await expect(svc.prepareSendPayment('alice@example.com', 1000, { comment: 'Thanks!' }))
      .resolves.toMatchObject({ __lnurlPay: true });

    expect(mockPrepareLnurlPay).toHaveBeenCalledWith(expect.objectContaining({
      amount: 1000n,
      payRequest,
      comment: 'Thanks!',
    }));
  });

  it.each([
    [0, 'Hello', 'does not accept comments'],
    [3, 'Toolong', 'up to 3 characters'],
  ])('rejects an unsupported or over-limit native comment before payment', async (commentAllowed, comment, message) => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockResolvedValueOnce({ tag: 'LnurlPay', inner: { commentAllowed } });

    await expect(svc.prepareSendPayment('lnurl1example', 1000, { comment }))
      .rejects.toThrow(message);
    expect(mockPrepareLnurlPay).not.toHaveBeenCalled();
  });

  it('adds a valid comment to the manual Lightning Address callback only when supported', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockRejectedValueOnce(new Error('temporary resolution failure'));
    const originalFetch = global.fetch;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        tag: 'payRequest', minSendable: 1000, maxSendable: 2_000_000,
        commentAllowed: 20, callback: 'https://pay.example/callback',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pr: 'lnbc1fallback' }) });
    global.fetch = fetchMock as typeof fetch;
    mockPrepareSendPayment.mockResolvedValueOnce({ paymentMethod: { tag: 'Bolt11Invoice' } });

    await svc.prepareSendPayment('alice@example.com', 1000, { comment: 'For coffee' });

    expect(fetchMock.mock.calls[1][0]).toContain('amount=1000000');
    expect(fetchMock.mock.calls[1][0]).toContain('comment=For+coffee');
    expect(mockPrepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequest: expect.objectContaining({ inner: { input: 'lnbc1fallback' } }),
    }));
    global.fetch = originalFetch;
  });

  it.each([
    [0, 'Hello', 'does not accept comments'],
    [3, 'Toolong', 'up to 3 characters'],
  ])('rejects unsupported and over-limit manual fallback comments before the callback', async (commentAllowed, comment, message) => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockRejectedValueOnce(new Error('temporary resolution failure'));
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({
      tag: 'payRequest', minSendable: 1000, maxSendable: 2_000_000,
      commentAllowed, callback: 'https://pay.example/callback',
    }) });
    global.fetch = fetchMock as typeof fetch;

    await expect(svc.prepareSendPayment('alice@example.com', 1000, { comment })).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockPrepareSendPayment).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  it('omits blank comments from the manual Lightning Address callback', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockRejectedValueOnce(new Error('temporary resolution failure'));
    const originalFetch = global.fetch;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        tag: 'payRequest', minSendable: 1000, maxSendable: 2_000_000,
        commentAllowed: 20, callback: 'https://pay.example/callback',
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pr: 'lnbc1fallback' }) });
    global.fetch = fetchMock as typeof fetch;
    mockPrepareSendPayment.mockResolvedValueOnce({ paymentMethod: { tag: 'Bolt11Invoice' } });

    await svc.prepareSendPayment('alice@example.com', 1000, { comment: '   ' });
    expect(fetchMock.mock.calls[1][0]).not.toContain('comment=');
    global.fetch = originalFetch;
  });

  it('routes the public Lightning Address helper through the comment-aware send path', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    const payRequest = { commentAllowed: 40 };
    mockParse.mockResolvedValueOnce({ tag: 'LightningAddress', inner: { payRequest } });
    mockPrepareLnurlPay.mockResolvedValueOnce({ feeSats: 2n, amountSats: 1000n });
    mockLnurlPay.mockResolvedValueOnce({ payment: { id: 'commented-payment', status: 'succeeded' } });

    await expect(svc.payLightningAddress('alice@example.com', 1000, 'Thanks!')).resolves.toMatchObject({ success: true });
    expect(mockPrepareLnurlPay).toHaveBeenCalledWith(expect.objectContaining({ comment: 'Thanks!' }));
    expect(mockLnurlPay).toHaveBeenCalled();
  });

  it('omits empty comments and refuses comments for non-LNURL destinations', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockPrepareSendPayment.mockResolvedValueOnce({ paymentMethod: { tag: 'Bolt11Invoice' } });

    await svc.prepareSendPayment('lnbc1invoice', 1000, { comment: '   ' });
    expect(mockPrepareSendPayment).toHaveBeenCalled();

    await expect(svc.prepareSendPayment('lnbc1invoice', 1000, { comment: 'Private?' }))
      .rejects.toThrow('Comments can only be sent');
  });
});

describe('BreezSparkService.getPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps Breez 0.19 payment amount, fees, and timestamp fields', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockGetPayment.mockResolvedValueOnce({
      payment: {
        id: 'payment-019',
        paymentType: 'Send',
        status: 'Succeeded',
        amount: 1250n,
        fees: 10n,
        timestamp: 1720000000n,
        details: undefined,
      },
    });

    await expect(svc.getPayment('payment-019')).resolves.toMatchObject({
      id: 'payment-019',
      type: 'send',
      status: 'completed',
      amountSat: 1250,
      feeSat: 10,
      timestamp: 1720000000000,
    });
  });
});

describe('BreezSparkService payment error copy', () => {
  it('unwraps UniFFI enum errors and returns an actionable expiry message', () => {
    const svc = require('../breezSparkService');

    expect(svc.getPaymentErrorMessage({ variant: 'SparkError', inner: { message: 'InvoiceExpired' } }))
      .toBe('This Lightning invoice has expired. Ask the recipient for a new invoice, then try again.');
  });

  it('unwraps tuple-shaped SparkError payloads instead of showing the SDK wrapper', () => {
    const svc = require('../breezSparkService');
    const error = Object.assign(new Error('SdkError.SparkError'), {
      tag: 'SparkError',
      inner: ['deposit is not mature'],
    });

    expect(svc.extractSdkErrorMessage(error)).toBe('deposit is not mature');
  });

  it('maps raw native invalid-input enums without exposing SDK internals', () => {
    const svc = require('../breezSparkService');

    expect(svc.getPaymentErrorMessage({ variant: 'InvalidInput', code: 'bad_request' }))
      .toContain('We couldn’t read that destination');
  });

  it.each([
    ["Getting raw enum value doesn't match any cases", 'unreadable'],
    ['Unexpected enum value 9', 'unreadable'],
    ['Unknown enum value 9', 'unreadable'],
    ['Invalid enum discriminator: 9', 'unreadable'],
    ['variant index 7 is out of range', 'unreadable'],
    ['UniFFI failed to decode InputType', 'unreadable'],
    ['Invoice has expired', 'expired'],
  ])('classifies native invoice failure %s', (message, expected) => {
    const svc = require('../breezSparkService');

    expect(svc.classifyInvoiceError(new Error(message))).toBe(expected);
  });

  it('replaces a raw enum failure with cautious actionable copy', () => {
    const svc = require('../breezSparkService');

    const message = svc.getPaymentErrorMessage(
      new Error("Getting raw enum value doesn't match any cases"),
    );
    expect(message).toContain('may be expired or created in a format');
    expect(message).not.toMatch(/enum|uniffi|variant/i);
  });
});

describe('BreezSparkService deposit claim handling', () => {
  it('keeps confirmation and Spark failures retryable with safe user copy', () => {
    const svc = require('../breezSparkService');

    expect(svc.getDepositClaimErrorInfo(
      { tag: 'MissingUtxo', inner: { tx: 'tx', vout: 0 } },
      10_000,
    )).toEqual({
      terminal: false,
      status: 'retrying',
      message: 'Waiting for Bitcoin network confirmations. ZapArc will retry automatically.',
    });

    const sparkError = Object.assign(new Error('SdkError.SparkError'), {
      tag: 'SparkError',
      inner: ['service temporarily unavailable'],
    });
    expect(svc.getDepositClaimErrorInfo(sparkError, 10_000)).toMatchObject({
      terminal: false,
      status: 'retrying',
    });
  });

  it('marks only an uneconomical fee failure as too small', () => {
    const svc = require('../breezSparkService');
    const error = {
      tag: 'MaxDepositClaimFeeExceeded',
      inner: { requiredFeeSats: 800n },
    };

    expect(svc.getDepositClaimErrorInfo(error, 1_000)).toMatchObject({
      terminal: true,
      status: 'too-small',
    });
    expect(svc.getDepositClaimErrorInfo(error, 10_000)).toMatchObject({
      terminal: false,
      status: 'retrying',
    });
  });

  it('preserves SDK maturity state when listing deposits', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    const originalFetch = global.fetch;
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '900000' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ confirmed: true, block_height: 899999 }),
      });
    mockListUnclaimedDeposits.mockResolvedValueOnce({
      deposits: [{
        txid: 'deposit-tx',
        vout: 1,
        amountSats: 25_000n,
        isMature: false,
        claimError: undefined,
      }],
    });

    await expect(svc.listDeposits()).resolves.toEqual([{
      txid: 'deposit-tx',
      vout: 1,
      amountSats: 25_000,
      isMature: false,
      confirmations: 2,
      requiredConfirmations: 3,
      claimError: undefined,
      requiredFeeSats: undefined,
    }]);
    global.fetch = originalFetch;
  });

  it('preserves deposit vout on the completed Breez payment', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockListPayments.mockResolvedValueOnce({
      payments: [{
        id: 'completed-deposit',
        paymentType: 'Receive',
        method: 3,
        amount: 24_200n,
        fees: 800n,
        status: 'Succeeded',
        timestamp: 1_700_000_000n,
        details: {
          tag: 'Deposit',
          inner: { txId: 'deposit-tx', vout: 1 },
        },
      }],
    });

    await expect(svc.listPayments()).resolves.toEqual([
      expect.objectContaining({
        id: 'completed-deposit',
        type: 'receive',
        method: 'onchain',
        txid: 'deposit-tx',
        onchainVout: 1,
        status: 'completed',
      }),
    ]);
  });
});

describe('BreezSparkService invoice metadata', () => {
  it('exposes an absolute expiry time from parsed BOLT11 metadata', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockParse.mockResolvedValueOnce({
      tag: 'Bolt11Invoice',
      inner: {
        amountMsat: 21000n,
        description: 'stale test invoice',
        timestamp: 1_700_000_000n,
        expiry: 60n,
      },
    });

    await expect(svc.parsePaymentRequest('native-parse-fixture')).resolves.toMatchObject({
      type: 'bolt11',
      amountSat: 21,
      expiresAt: 1_700_000_060_000,
    });
  });
});

describe('BreezSparkService BOLT11 native compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Structurally representative only: this fixture is intentionally not a
  // payable invoice and contains no secret or live payment data.
  const representativeBolt11 = 'lnbc2500n1pzaparcfixture0qsp5fixtureonlynotapayableinvoice';

  it('does not call native parse for a BOLT11 invoice', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');

    await expect(svc.parsePaymentRequest(representativeBolt11)).resolves.toMatchObject({
      type: 'bolt11',
      isValid: true,
    });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('prepares BOLT11 with the Breez 0.19 PaymentRequest enum shape', async () => {
    const svc = require('../breezSparkService');
    await svc.initializeSDK('test mnemonic words go here twelve words');
    mockPrepareSendPayment.mockResolvedValueOnce({ paymentMethod: { tag: 'Bolt11' } });

    await svc.prepareSendPayment(representativeBolt11, 250);

    expect(mockParse).not.toHaveBeenCalled();
    expect(mockPrepareSendPayment).toHaveBeenCalledWith({
      paymentRequest: {
        tag: 'Input',
        inner: { input: representativeBolt11 },
      },
      amount: 250n,
      tokenIdentifier: undefined,
    });
  });
});
