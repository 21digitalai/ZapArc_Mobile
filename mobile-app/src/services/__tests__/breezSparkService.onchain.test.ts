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
  defaultConfig: jest.fn(() => ({})),
  connect: jest.fn().mockResolvedValue({
    sendPayment: (...args: unknown[]) => mockSendPayment(...args),
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
