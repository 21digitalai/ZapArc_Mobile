import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useLanguage } from '../../../hooks/useLanguage';
import { BRAND_COLOR } from '../../../utils/theme-helpers';

type SwapAmountCardProps = {
  label: string;
  currency: string;
  amount: string;
  onAmountChange: (value: string) => void;
  onMax: () => void;
  maxDisabled?: boolean;
  maxDisabledTooltip?: string;
  /** Small caption shown next to Max, e.g. "Max: 163,521 sats" */
  maxHint?: string;
  isReadOnly?: boolean;
  isLoading?: boolean;
  fiatEquivalent?: string;
};

export function SwapAmountCard({
  label,
  currency,
  amount,
  onAmountChange,
  onMax,
  maxDisabled = false,
  maxDisabledTooltip,
  maxHint,
  isReadOnly = false,
  isLoading = false,
  fiatEquivalent,
}: SwapAmountCardProps): React.JSX.Element {
  const { t } = useLanguage();
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (!isLoading) {
      pulse.stopAnimation();
      pulse.setValue(0.45);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [isLoading, pulse]);

  if (isLoading) {
    return (
      <View
        style={styles.card}
        testID="swap-amount-card-skeleton"
        accessibilityRole="progressbar"
        accessibilityLabel={t('swap.loadingQuote')}
        accessibilityLiveRegion="polite"
      >
        <Animated.View style={[styles.skeletonLineShort, { opacity: pulse }]} />
        <Animated.View style={[styles.skeletonLineLarge, { opacity: pulse }]} />
        <Animated.View style={[styles.skeletonLineMedium, { opacity: pulse }]} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.maxGroup}>
          {!!maxHint && (
            <Text style={styles.maxHintText} numberOfLines={1}>
              {maxHint}
            </Text>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('swap.maxAccessibilityLabel', { hint: maxHint ? ` (${maxHint})` : '' })}
            onPress={onMax}
            disabled={maxDisabled}
            style={[styles.maxButton, maxDisabled && styles.maxButtonDisabled]}
          >
            <Text style={[styles.maxButtonText, maxDisabled && styles.maxButtonTextDisabled]}>{t('swap.max')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={onAmountChange}
          keyboardType="decimal-pad"
          editable={!isReadOnly}
          placeholder={t('swap.amountPlaceholder')}
          placeholderTextColor="rgba(255,255,255,0.4)"
          accessibilityLabel={`${label} amount`}
        />
        <Text style={styles.currencyLabel}>{currency}</Text>
      </View>

      {!!fiatEquivalent && <Text style={styles.fiatText}>{fiatEquivalent}</Text>}
      {maxDisabled && !!maxDisabledTooltip && <Text style={styles.tooltipText}>{maxDisabledTooltip}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 14,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D8D8DE',
  },
  maxGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  maxHintText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },
  maxButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BRAND_COLOR,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  maxButtonDisabled: {
    borderColor: 'rgba(255,255,255,0.2)',
  },
  maxButtonText: {
    color: BRAND_COLOR,
    fontSize: 12,
    fontWeight: '700',
  },
  maxButtonTextDisabled: {
    color: 'rgba(255,255,255,0.45)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 0,
  },
  currencyLabel: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  fiatText: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 13,
  },
  tooltipText: {
    color: '#FFB74D',
    fontSize: 12,
  },
  skeletonLineShort: {
    width: '26%',
    height: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  skeletonLineLarge: {
    width: '62%',
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  skeletonLineMedium: {
    width: '42%',
    height: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
