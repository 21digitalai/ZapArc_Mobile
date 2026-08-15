import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

const mockOnSave = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: jest.fn(() => true) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('../../../src/contexts/ThemeContext', () => ({ useAppTheme: jest.fn(() => ({ themeMode: 'light' })) }));
jest.mock('../../../src/services/breezSparkService', () => ({ BreezSparkService: {}, onPaymentReceived: jest.fn(), extractSdkErrorMessage: jest.fn() }));
jest.mock('../../../src/config/features', () => ({ SWAP_FEATURE_ENABLED: false, MULTI_ASSET_UI_ENABLED: false }));
jest.mock('../../../src/hooks/useWallet', () => ({ useWallet: jest.fn(() => ({})) }));
jest.mock('../../../src/hooks/useCurrency', () => ({ useCurrency: jest.fn(() => ({})) }));
jest.mock('../../../src/hooks/useKeyboardAwareScroll', () => ({ useKeyboardAwareScroll: jest.fn(() => ({})) }));
jest.mock('../../../src/features/wallet/utils/safeBack', () => ({ createSafeBackHandler: jest.fn() }));
jest.mock('../../../src/features/wallet/utils/saveQrToDevice', () => ({ saveQrToAndroidDirectory: jest.fn() }));
jest.mock('../../../src/features/wallet/components/FeedbackComponents', () => ({ useFeedback: jest.fn(() => ({})) }));
jest.mock('../../../src/hooks/useLightningAddress', () => ({ useLightningAddress: jest.fn(() => ({})) }));
jest.mock('../../../src/components', () => ({ StyledTextInput: 'TextInput', KeyboardDoneAccessory: 'View', keyboardDoneAccessoryId: 'done' }));
jest.mock('../../../src/services/i18nService', () => ({ t: jest.fn(() => 'Save') }));

import {
  getReceiveSpotPrice,
  ReceiveQrActions,
  ReceiveQrSaveButton,
  nextReceiveExpiryTime,
  saveReceiveQr,
  shareReceiveQr,
} from '../receive';

describe('Receive QR Save buttons', () => {
  beforeEach(() => mockOnSave.mockClear());

  it.each([
    ['Lightning', 'zaparc-lightning-qr'],
    ['on-chain', 'zaparc-onchain-qr'],
  ])('routes the %s QR Save button through the shared Android-safe handler', (_label, filenamePrefix) => {
    const cardRef = { current: null };
    render(<ReceiveQrSaveButton cardRef={cardRef} filenamePrefix={filenamePrefix} onSave={mockOnSave} />);

    fireEvent.press(screen.getByTestId(`save-qr-${filenamePrefix}`));

    expect(mockOnSave).toHaveBeenCalledWith(cardRef, filenamePrefix);
  });

  it.each(['zaparc-lightning-qr', 'zaparc-onchain-qr'])(
    'saves %s through the Android gallery adapter without calling expo-sharing',
    async (filenamePrefix) => {
      const capture = jest.fn().mockResolvedValue('file:///cache/qr.png');
      const saveAndroid = jest.fn().mockResolvedValue({ status: 'saved', fileName: `${filenamePrefix}-123.png` });
      const saveIos = { requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() };
      const share = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
      const showSuccess = jest.fn();
      const showError = jest.fn();

      await saveReceiveQr({
        cardRef: { current: {} as never },
        filenamePrefix,
        platform: 'android',
        capture,
        saveAndroid,
        saveIos,
        share,
        showSuccess,
        showError,
      });

      expect(capture).toHaveBeenCalledWith(expect.anything(), {
        format: 'png', quality: 1, result: 'tmpfile',
      });
      expect(saveAndroid).toHaveBeenCalledWith('file:///cache/qr.png', expect.stringMatching(new RegExp(`^${filenamePrefix}-\\d+\\.png$`)));
      expect(showSuccess).toHaveBeenCalledWith(expect.stringContaining(filenamePrefix));
      expect(showError).not.toHaveBeenCalled();
      expect(share.isAvailableAsync).not.toHaveBeenCalled();
      expect(share.shareAsync).not.toHaveBeenCalled();
    },
  );

  it('reports gallery write failures without falling back to sharing', async () => {
    const silent = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
    const showSuccess = jest.fn();
    const showError = jest.fn();
    const options = {
      cardRef: { current: {} as never }, filenamePrefix: 'zaparc-lightning-qr', platform: 'android',
      capture: jest.fn().mockResolvedValue('file:///cache/qr.png'), saveAndroid: jest.fn().mockRejectedValue(new Error('write failed')),
      saveIos: { requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() },
      share: silent, showSuccess, showError,
    };

    await saveReceiveQr(options);
    expect(showError).toHaveBeenCalledWith('write failed');
    expect(silent.shareAsync).not.toHaveBeenCalled();
  });

  it.each(['zaparc-lightning-qr', 'zaparc-onchain-qr'])('keeps Android Save and Share as independent actions for %s', (filenamePrefix) => {
    const onSave = jest.fn();
    const onShare = jest.fn();
    const cardRef = { current: null };
    render(<ReceiveQrActions cardRef={cardRef} filenamePrefix={filenamePrefix} onSave={onSave} onShare={onShare} platform="android" />);

    fireEvent.press(screen.getByTestId(`save-qr-${filenamePrefix}`));
    expect(onSave).toHaveBeenCalledWith(cardRef, filenamePrefix);
    expect(onShare).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`share-qr-${filenamePrefix}`));
    expect(onShare).toHaveBeenCalledWith(cardRef, filenamePrefix);
  });

  it.each(['zaparc-lightning-qr', 'zaparc-onchain-qr'])('shows separate iOS Save and Share actions for %s', (filenamePrefix) => {
    const onSave = jest.fn();
    const onShare = jest.fn();
    const cardRef = { current: null };
    render(<ReceiveQrActions cardRef={cardRef} filenamePrefix={filenamePrefix} onSave={onSave} onShare={onShare} platform="ios" />);

    fireEvent.press(screen.getByTestId(`save-qr-${filenamePrefix}`));
    expect(onSave).toHaveBeenCalledWith(cardRef, filenamePrefix);
    expect(onShare).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`share-qr-${filenamePrefix}`));
    expect(onShare).toHaveBeenCalledWith(cardRef, filenamePrefix);
  });

  it('saves directly to iOS Photos without opening the Share sheet', async () => {
    const saveIos = {
      requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
      saveToLibraryAsync: jest.fn().mockResolvedValue(undefined),
    };
    const share = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
    const showSuccess = jest.fn();
    const showError = jest.fn();

    await saveReceiveQr({
      cardRef: { current: {} as never },
      filenamePrefix: 'zaparc-lightning-qr',
      platform: 'ios',
      capture: jest.fn().mockResolvedValue('file:///cache/qr.png'),
      saveAndroid: jest.fn(),
      saveIos,
      share,
      showSuccess,
      showError,
    });

    expect(saveIos.requestPermissionsAsync).toHaveBeenCalledWith(true);
    expect(saveIos.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/qr.png');
    expect(showSuccess).toHaveBeenCalledWith('QR code saved to Photos');
    expect(showError).not.toHaveBeenCalled();
    expect(share.shareAsync).not.toHaveBeenCalled();
  });

  it('explains when iOS Photos add permission is denied', async () => {
    const saveIos = {
      requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
      saveToLibraryAsync: jest.fn(),
    };
    const showError = jest.fn();

    await saveReceiveQr({
      cardRef: { current: {} as never },
      filenamePrefix: 'zaparc-lightning-qr',
      platform: 'ios',
      capture: jest.fn().mockResolvedValue('file:///cache/qr.png'),
      saveAndroid: jest.fn(),
      saveIos,
      share: { isAvailableAsync: jest.fn(), shareAsync: jest.fn() },
      showSuccess: jest.fn(),
      showError,
    });

    expect(saveIos.saveToLibraryAsync).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('Allow photo access to save QR images.');
  });

  it('shares a PNG without writing a gallery copy and treats cancellation quietly', async () => {
    const share = { isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockRejectedValue(new Error('User cancelled')) };
    const showError = jest.fn();
    await shareReceiveQr({ cardRef: { current: {} as never }, filenamePrefix: 'zaparc-lightning-qr', capture: jest.fn().mockResolvedValue('file:///cache/qr.png'), share, showError });
    expect(share.shareAsync).toHaveBeenCalledWith('file:///cache/qr.png', expect.objectContaining({ mimeType: 'image/png' }));
    expect(showError).not.toHaveBeenCalled();
  });
});

describe('Receive conversion spot price', () => {
  const now = 1_000_000;
  const freshRates = { usd: 65_432.4, eur: 54_648.2, timestamp: now - 1 };

  it.each([
    ['eur', 'usd', '1 BTC ≈ €54,648'],
    ['usd', 'eur', '1 BTC ≈ $65,432'],
    ['sats', 'eur', '1 BTC ≈ €54,648'],
  ] as const)('uses the selected %s currency, with secondary fiat for sats', (inputCurrency, secondaryFiatCurrency, expected) => {
    expect(getReceiveSpotPrice(inputCurrency, secondaryFiatCurrency, freshRates, false, now)).toBe(expected);
  });

  it.each([
    [null, false],
    [{ ...freshRates, eur: 0 }, false],
    [{ ...freshRates, eur: Number.NaN }, false],
    [{ ...freshRates, timestamp: now - 5 * 60 * 1000 }, false],
    [freshRates, true],
  ] as const)('omits unavailable, stale, or loading rates', (rates, isLoadingRates) => {
    expect(getReceiveSpotPrice('eur', 'usd', rates, isLoadingRates, now)).toBeNull();
  });
});

describe('Receive invoice expiry state', () => {
  const now = 1_700_000_000_000;
  const priorExpiry = now + 15 * 60 * 1000;

  it('replaces an already-generated invoice expiry only after a new invoice result arrives', () => {
    const nextExpiry = nextReceiveExpiryTime(priorExpiry, {
      type: 'generated',
      isExpiringRequest: true,
      result: { expiresAt: now + 24 * 60 * 60 * 1000 },
      requestedExpirySecs: 900,
      now,
    });

    expect(nextExpiry).toBe(now + 24 * 60 * 60 * 1000);
  });

  it('uses the SDK-returned absolute expiry instead of the requested duration', () => {
    expect(nextReceiveExpiryTime(null, {
      type: 'generated',
      isExpiringRequest: true,
      result: { expiresAt: now + 60 * 60 * 1000 },
      requestedExpirySecs: 24 * 60 * 60,
      now,
    })).toBe(now + 60 * 60 * 1000);
  });

  it('falls back to the requested duration only for expiring requests', () => {
    expect(nextReceiveExpiryTime(null, {
      type: 'generated',
      isExpiringRequest: true,
      result: {},
      requestedExpirySecs: 24 * 60 * 60,
      now,
    })).toBe(now + 24 * 60 * 60 * 1000);
  });

  it('clears expiry for reusable static addresses and when starting a new invoice', () => {
    expect(nextReceiveExpiryTime(priorExpiry, {
      type: 'generated',
      isExpiringRequest: false,
      result: {},
      requestedExpirySecs: 24 * 60 * 60,
      now,
    })).toBeNull();
    expect(nextReceiveExpiryTime(priorExpiry, { type: 'clear' })).toBeNull();
  });
});
