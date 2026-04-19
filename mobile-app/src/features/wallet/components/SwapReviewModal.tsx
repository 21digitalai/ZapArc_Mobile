import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

import { useLanguage } from '../../../hooks/useLanguage';
import { useWalletAuth } from '../../../hooks/useWalletAuth';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import type { SwapDirection } from '../../../services/breezSparkService';

type SwapReviewModalProps = {
  visible: boolean;
  direction: SwapDirection;
  payAmount: string;
  receiveAmount: string;
  rateText: string;
  feeText: string;
  slippageText: string;
  authError?: string;
  onDismiss: () => void;
  onConfirm: () => Promise<void> | void;
};

export function SwapReviewModal({
  visible,
  direction,
  payAmount,
  receiveAmount,
  rateText,
  feeText,
  slippageText,
  authError,
  onDismiss,
  onConfirm,
}: SwapReviewModalProps): React.JSX.Element {
  const { t } = useLanguage();
  const { unlockWithBiometric, getSessionPin } = useWalletAuth();
  const [confirmDisabled, setConfirmDisabled] = useState(false);

  useEffect(() => {
    if (authError) {
      setConfirmDisabled(false);
    }
  }, [authError]);

  useEffect(() => {
    if (!visible) {
      setConfirmDisabled(false);
    }
  }, [visible]);

  const directionText = useMemo(() => {
    return direction === 'BTC_TO_USDB' ? 'BTC → USDB' : 'USDB → BTC';
  }, [direction]);

  const handleConfirm = useCallback(async () => {
    if (confirmDisabled) {
      return;
    }

    setConfirmDisabled(true);

    const biometricOk = await unlockWithBiometric();
    const pinFallbackAvailable = Boolean(getSessionPin());

    if (!biometricOk && !pinFallbackAvailable) {
      setConfirmDisabled(false);
      return;
    }

    await onConfirm();
  }, [confirmDisabled, getSessionPin, onConfirm, unlockWithBiometric]);

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
        <Dialog.Title style={styles.title}>{t('swap.review.title')}</Dialog.Title>
        <Dialog.Content>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.direction')}</Text>
            <Text style={styles.value}>{directionText}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.youPay')}</Text>
            <Text style={styles.value}>{payAmount}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.youReceive')}</Text>
            <Text style={styles.value}>{receiveAmount}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.rate')}</Text>
            <Text style={styles.value}>{rateText}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.fee')}</Text>
            <Text style={styles.value}>{feeText}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t('swap.review.slippage')}</Text>
            <Text style={styles.value}>{slippageText}</Text>
          </View>
          {!!authError && (
            <Text
              style={styles.error}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              accessibilityLabel={`Authentication error: ${authError}`}
            >
              {authError}
            </Text>
          )}
        </Dialog.Content>

        <Dialog.Actions>
          <Button onPress={onDismiss} textColor="rgba(255,255,255,0.78)">
            {t('swap.review.cancel')}
          </Button>
          <Button
            mode="contained"
            onPress={handleConfirm}
            disabled={confirmDisabled}
            buttonColor={BRAND_COLOR}
            textColor="#1a1a2e"
            accessibilityLabel="Confirm swap"
          >
            {t('swap.review.confirm')}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    backgroundColor: '#1C1C29',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  title: {
    color: '#FFFFFF',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 16,
  },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
  },
  value: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  error: {
    color: '#FF7A7A',
    marginTop: 10,
    fontSize: 12,
  },
});
