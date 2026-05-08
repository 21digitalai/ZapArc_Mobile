import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { getAllAssets, type AssetTicker, type AssetMeta } from '../registry/assetRegistry';

export type AssetPickerSheetProps = {
  visible: boolean;
  /** Currently-selected ticker (highlighted in the list). */
  selected: AssetTicker;
  /**
   * Optional ticker to disable (not selectable). Used in the swap screen
   * so the same asset can't appear on both sides.
   */
  disabled?: AssetTicker;
  /** Optional restricted list — defaults to every registered asset. */
  tickers?: AssetTicker[];
  /** Optional balance lookup — shown as a subline next to each asset. */
  getBalanceLine?: (ticker: AssetTicker) => string | null;
  /** Sheet title. */
  title?: string;
  onSelect: (ticker: AssetTicker) => void;
  onClose: () => void;
};

export function AssetPickerSheet({
  visible,
  selected,
  disabled,
  tickers,
  getBalanceLine,
  title = 'Select asset',
  onSelect,
  onClose,
}: AssetPickerSheetProps) {
  const insets = useSafeAreaInsets();

  const items = useMemo<AssetMeta[]>(() => {
    const all = getAllAssets();
    if (!tickers || tickers.length === 0) return all;
    const set = new Set(tickers);
    return all.filter((m) => set.has(m.ticker));
  }, [tickers]);

  // We drive both the backdrop opacity and the sheet's translateY off the
  // same Animated.Value so they stay in lockstep but are visually distinct
  // (fade vs slide). RN's built-in `animationType="slide"` slides the whole
  // modal contents — backdrop included — which produced an ugly "growing
  // shadow" artifact.
  const SCREEN_H = Dimensions.get('window').height;
  const progress = useRef(new Animated.Value(0)).current;
  // `mounted` is set true on entrance and only flipped back to false at the
  // end of the exit animation, so the modal stays mounted during slide-out.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress]);

  const sheetTranslate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H * 0.6, 0],
  });
  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 12, transform: [{ translateY: sheetTranslate }] },
        ]}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>

        <ScrollView style={styles.list} contentContainerStyle={{ paddingVertical: 4 }}>
          {items.map((meta) => {
            const isSelected = meta.ticker === selected;
            const isDisabled = meta.ticker === disabled;
            const balanceLine = getBalanceLine ? getBalanceLine(meta.ticker) : null;
            return (
              <TouchableOpacity
                key={meta.ticker}
                style={[
                  styles.row,
                  isSelected && styles.rowSelected,
                  isDisabled && styles.rowDisabled,
                ]}
                disabled={isDisabled}
                onPress={() => {
                  onSelect(meta.ticker);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                accessibilityLabel={`${meta.name}${isSelected ? ', selected' : ''}`}
              >
                <View style={[styles.coin, { backgroundColor: meta.color }]}>
                  <Text style={styles.coinSymbol}>{meta.symbol}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{meta.name}</Text>
                  {balanceLine ? <Text style={styles.rowSub}>{balanceLine}</Text> : null}
                </View>
                <Text style={styles.rowTicker}>{meta.ticker}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#20203a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    maxHeight: '70%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginBottom: 4,
  },
  rowSelected: {
    backgroundColor: 'rgba(247,147,26,0.10)',
    borderWidth: 1,
    borderColor: BRAND_COLOR,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  coin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  coinSymbol: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 2,
  },
  rowTicker: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '500',
  },
});

export default AssetPickerSheet;
