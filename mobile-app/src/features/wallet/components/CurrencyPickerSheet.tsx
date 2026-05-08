import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_COLOR } from '../../../utils/theme-helpers';
import { DISPLAY_CURRENCY_ORDER, type DisplayCurrency } from '../../../services/displayCurrencyService';

/**
 * Currencies shown by the picker. Includes the standard BTC display set plus
 * 'usdb' for screens (e.g. USDB receive) where USDB itself is a valid input.
 * Callers narrow as needed.
 */
export type PickerCurrency = DisplayCurrency | 'usdb';

export type CurrencyPickerSheetProps = {
  visible: boolean;
  selected: PickerCurrency;
  /** Optional restricted list — defaults to all supported display currencies. */
  currencies?: PickerCurrency[];
  /** Sheet title. Defaults to "Display currency". */
  title?: string;
  onSelect: (currency: PickerCurrency) => void;
  onClose: () => void;
};

const META: Record<PickerCurrency, { label: string; subtitle: string; symbol: string }> = {
  sats: { label: 'Satoshis', subtitle: 'Bitcoin native unit', symbol: '⚡' },
  usd:  { label: 'US Dollar', subtitle: 'USD',  symbol: '$' },
  eur:  { label: 'Euro',      subtitle: 'EUR',  symbol: '€' },
  usdb: { label: 'USDB',     subtitle: 'USD on Spark', symbol: '$' },
};

/**
 * Bottom-sheet picker for the input/display currency. Mirrors
 * `AssetPickerSheet` so the UX vocabulary is consistent across the app.
 */
export function CurrencyPickerSheet({
  visible,
  selected,
  currencies,
  title = 'Display currency',
  onSelect,
  onClose,
}: CurrencyPickerSheetProps) {
  const insets = useSafeAreaInsets();

  const items = useMemo<PickerCurrency[]>(() => {
    if (currencies && currencies.length > 0) return currencies;
    return DISPLAY_CURRENCY_ORDER;
  }, [currencies]);

  const SCREEN_H = Dimensions.get('window').height;
  const progress = useRef(new Animated.Value(0)).current;
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
          {items.map((cur) => {
            const meta = META[cur];
            const isSelected = cur === selected;
            return (
              <TouchableOpacity
                key={cur}
                style={[styles.row, isSelected && styles.rowSelected]}
                onPress={() => {
                  onSelect(cur);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${meta.label}${isSelected ? ', selected' : ''}`}
              >
                <View style={styles.coin}>
                  <Text style={styles.coinSymbol}>{meta.symbol}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{meta.label}</Text>
                  <Text style={styles.rowSub}>{meta.subtitle}</Text>
                </View>
                <Text style={styles.rowTicker}>{cur.toUpperCase()}</Text>
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
  list: { flexGrow: 0 },
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
  coin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  coinSymbol: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rowText: { flex: 1 },
  rowName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  rowTicker: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '500' },
});

export default CurrencyPickerSheet;
