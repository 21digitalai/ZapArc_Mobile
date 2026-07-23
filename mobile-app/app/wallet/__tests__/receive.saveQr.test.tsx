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

import { ReceiveQrSaveButton, saveReceiveQr } from '../receive';

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
    'saves %s through Android SAF without calling expo-sharing',
    async (filenamePrefix) => {
      const capture = jest.fn().mockResolvedValue('file:///cache/qr.png');
      const saveAndroid = jest.fn().mockResolvedValue({ status: 'saved', fileName: `${filenamePrefix}-123.png` });
      const share = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
      const showSuccess = jest.fn();
      const showError = jest.fn();

      await saveReceiveQr({
        cardRef: { current: {} as never },
        filenamePrefix,
        platform: 'android',
        capture,
        saveAndroid,
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

  it('keeps Android picker cancellation quiet and reports write failures', async () => {
    const silent = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
    const showSuccess = jest.fn();
    const showError = jest.fn();
    const options = {
      cardRef: { current: {} as never }, filenamePrefix: 'zaparc-lightning-qr', platform: 'android',
      capture: jest.fn().mockResolvedValue('file:///cache/qr.png'), saveAndroid: jest.fn().mockResolvedValue({ status: 'cancelled' as const }),
      share: silent, showSuccess, showError,
    };

    await saveReceiveQr(options);
    expect(showSuccess).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(silent.shareAsync).not.toHaveBeenCalled();

    const failedSave = jest.fn().mockRejectedValue(new Error('write failed'));
    await saveReceiveQr({ ...options, saveAndroid: failedSave });
    expect(showError).toHaveBeenCalledWith('write failed');
    expect(silent.shareAsync).not.toHaveBeenCalled();
  });
});
