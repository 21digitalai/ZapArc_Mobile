import React from 'react';
import { View, StyleSheet, TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import { Text } from 'react-native-paper';
import { getAssetMeta, type AssetTicker } from '../registry/assetRegistry';

export type AssetSelectorPillProps = {
  ticker: AssetTicker;
  /** "compact" = ticker only (e.g. on Swap pills); default shows full name. */
  variant?: 'default' | 'compact';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  /** When true, render without the chevron (e.g. read-only display). */
  hideChevron?: boolean;
};

/**
 * Compact tap-to-pick pill that shows the currently-selected asset and
 * opens the AssetPickerSheet on tap.
 *
 *   [ ₿ ] Bitcoin ▾
 */
export function AssetSelectorPill({
  ticker,
  variant = 'default',
  onPress,
  style,
  hideChevron,
}: AssetSelectorPillProps) {
  const meta = getAssetMeta(ticker);
  const label = variant === 'compact' ? meta.ticker : meta.name;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.pill, style]}
      accessibilityRole="button"
      accessibilityLabel={`Selected asset: ${meta.name}. Tap to change.`}
    >
      <View style={[styles.coin, { backgroundColor: meta.color }]}>
        <Text style={styles.coinSymbol}>{meta.symbol}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
      {!hideChevron && <Text style={styles.chev}>▾</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 22,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 12,
    alignSelf: 'flex-start',
  },
  coin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  coinSymbol: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  chev: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    marginLeft: 6,
  },
});

export default AssetSelectorPill;
