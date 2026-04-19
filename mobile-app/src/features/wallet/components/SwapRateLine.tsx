import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useLanguage } from '../../../hooks/useLanguage';
import { BRAND_COLOR } from '../../../utils/theme-helpers';

type SwapRateLineProps = {
  rateText: string;
  feeText: string;
  slippageBps: number;
  onSlippagePresetSelect: (bps: number) => void;
  inlineError?: string;
};

const PRESET_BPS = [10, 50, 100] as const;

export function SwapRateLine({
  rateText,
  feeText,
  slippageBps,
  onSlippagePresetSelect,
  inlineError,
}: SwapRateLineProps): React.JSX.Element {
  const { t } = useLanguage();

  const slippageLabel = useMemo(() => {
    if (slippageBps === 10) {
      return t('swap.slippagePreset01');
    }
    if (slippageBps === 50) {
      return t('swap.slippagePreset05');
    }
    if (slippageBps === 100) {
      return t('swap.slippagePreset10');
    }
    return `${(slippageBps / 100).toFixed(2)}%`;
  }, [slippageBps, t]);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.rowText}>{`${t('swap.rate')}: ${rateText}`}</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={styles.rowText}>{`${t('swap.fee')}: ${feeText}`}</Text>
        <Text style={styles.dot}>•</Text>
        <Text style={styles.rowText}>{`${t('swap.slippage')}: ${slippageLabel}`}</Text>
      </View>

      <Text style={styles.advancedLabel}>{t('swap.advanced')}</Text>
      <View style={styles.chipsRow}>
        {PRESET_BPS.map((preset) => {
          const isActive = preset === slippageBps;
          const label =
            preset === 10
              ? t('swap.slippagePreset01')
              : preset === 50
                ? t('swap.slippagePreset05')
                : t('swap.slippagePreset10');

          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityLabel={`Select slippage ${label}`}
              accessibilityState={{ selected: isActive }}
              onPress={() => onSlippagePresetSelect(preset)}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {!!inlineError && (
        <Text
          style={styles.errorText}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessibilityLabel={`Swap error: ${inlineError}`}
        >
          {inlineError}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  rowText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
  },
  dot: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },
  advancedLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: BRAND_COLOR,
    backgroundColor: 'rgba(255,170,0,0.14)',
  },
  chipText: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: BRAND_COLOR,
  },
  errorText: {
    color: '#FF7A7A',
    fontSize: 12,
  },
});
