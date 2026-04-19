jest.mock('../services/settingsService', () => ({
  settingsService: {
    getUserSettings: jest.fn(),
    updateUserSettings: jest.fn().mockResolvedValue(undefined),
  },
}));

import { I18nService } from '../services/i18nService';

describe('I18nService', () => {
  let i18nService: I18nService;

  beforeEach(() => {
    i18nService = new I18nService();
    jest.clearAllMocks();
  });

  it('defaults to English', () => {
    expect(i18nService.getLanguage()).toBe('en');
  });

  it('contains required on-chain translation keys for EN and BG', async () => {
    const requiredKeys = [
      'send.onchainTitle',
      'send.onchainDetected',
      'send.confirmationSpeed',
      'send.speedFast',
      'send.speedMedium',
      'send.speedSlow',
      'send.estimatedTime',
      'send.networkFee',
    ];

    for (const key of requiredKeys) {
      const en = i18nService.t(key);
      expect(en).toBeTruthy();
      expect(en).not.toBe(key);
    }

    await i18nService.setLanguage('bg');

    for (const key of requiredKeys) {
      const bg = i18nService.t(key);
      expect(bg).toBeTruthy();
      expect(bg).not.toBe(key);
    }
  });

  it('contains required swap/asset translation keys for EN and BG', async () => {
    const requiredKeys = [
      'swap.title',
      'swap.youPay',
      'swap.youReceive',
      'swap.flipDirection',
      'swap.max',
      'swap.maxBtcLabel',
      'swap.maxUsdbDustNote',
      'swap.reviewButton',
      'swap.loadingQuote',
      'swap.rate',
      'swap.fee',
      'swap.slippage',
      'swap.advanced',
      'swap.slippagePreset01',
      'swap.slippagePreset05',
      'swap.slippagePreset10',
      'swap.slippageCustomLabel',
      'swap.error.insufficientBalance',
      'swap.error.belowMin',
      'swap.error.aboveMax',
      'swap.error.limitsUnavailable',
      'swap.error.limitsRetry',
      'swap.error.offline',
      'swap.error.connectionLost',
      'swap.error.timeoutBody',
      'swap.maxDisabledTooltip',
      'swap.backgrounded.toast',
      'swap.review.title',
      'swap.review.direction',
      'swap.review.youPay',
      'swap.review.youReceive',
      'swap.review.rate',
      'swap.review.fee',
      'swap.review.slippage',
      'swap.review.cancel',
      'swap.review.confirm',
      'swap.confirming.title',
      'swap.confirming.subtitle',
      'swap.success.title',
      'swap.success.paid',
      'swap.success.received',
      'swap.success.done',
      'swap.dustResidual.note',
      'swap.refunded.title',
      'swap.refunded.body',
      'swap.refunded.tryAgain',
      'swap.refunded.increaseSlippage',
      'swap.error.title',
      'swap.error.retry',
      'swap.error.networkBody',
      'swap.history.label',
      'swap.history.btcToUsdb',
      'swap.history.usdbToBtc',
      'home.assetTab.btc',
      'home.assetTab.usdb',
      'send.asset.onchainDisabled',
      'send.asset.swapToBtcLink',
      'send.asset.bolt11NotForUsdb',
      'send.asset.switchToBtc',
    ];

    for (const key of requiredKeys) {
      const en = i18nService.t(key);
      expect(en).toBeTruthy();
      expect(en).not.toBe(key);
    }

    await i18nService.setLanguage('bg');

    for (const key of requiredKeys) {
      const bg = i18nService.t(key);
      expect(bg).toBeTruthy();
      expect(bg).not.toBe(key);
    }
  });
});
