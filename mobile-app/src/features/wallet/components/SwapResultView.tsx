import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { useLanguage } from '../../../hooks/useLanguage';
import { BRAND_COLOR } from '../../../utils/theme-helpers';

type SwapResultKind = 'success' | 'dustResidual' | 'refunded' | 'error';

type SwapResultViewProps = {
  kind: SwapResultKind;
  paidAmount?: string;
  receivedAmount?: string;
  residualUsdb?: string;
  errorMessage?: string;
  onDone?: () => void;
  onRetry?: () => void;
  onIncreaseSlippage?: () => void;
};

export function SwapResultView({
  kind,
  paidAmount,
  receivedAmount,
  residualUsdb,
  errorMessage,
  onDone,
  onRetry,
  onIncreaseSlippage,
}: SwapResultViewProps): React.JSX.Element {
  const { t } = useLanguage();

  if (kind === 'success' || kind === 'dustResidual') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('swap.success.title')}</Text>
        {!!paidAmount && <Text style={styles.row}>{`${t('swap.success.paid')}: ${paidAmount}`}</Text>}
        {!!receivedAmount && <Text style={styles.row}>{`${t('swap.success.received')}: ${receivedAmount}`}</Text>}
        {kind === 'dustResidual' && !!residualUsdb && (
          <Text style={styles.note}>{`USDB residual: ${residualUsdb}`}</Text>
        )}
        <Button mode="contained" onPress={onDone} buttonColor={BRAND_COLOR} textColor="#1a1a2e">
          {t('swap.success.done')}
        </Button>
      </View>
    );
  }

  if (kind === 'refunded') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('swap.refunded.title')}</Text>
        <Text style={styles.body}>{t('swap.refunded.body', { slippage: 'your tolerance' })}</Text>
        <View style={styles.actionsRow}>
          <Button mode="contained" onPress={onRetry} buttonColor={BRAND_COLOR} textColor="#1a1a2e">
            {t('swap.refunded.tryAgain')}
          </Button>
          <Button mode="outlined" onPress={onIncreaseSlippage} textColor={BRAND_COLOR}>
            {t('swap.refunded.increaseSlippage')}
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('swap.error.title')}</Text>
      <Text style={styles.body}>{errorMessage || t('swap.error.networkBody')}</Text>
      <Button mode="contained" onPress={onRetry} buttonColor={BRAND_COLOR} textColor="#1a1a2e">
        {t('swap.error.retry')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    gap: 10,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  row: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  note: {
    color: '#FFCC80',
    fontSize: 13,
  },
  body: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
