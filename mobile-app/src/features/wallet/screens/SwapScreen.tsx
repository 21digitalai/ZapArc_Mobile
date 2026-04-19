import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { IconButton, Text } from 'react-native-paper';

import { useAppTheme } from '../../../contexts/ThemeContext';
import { useSwap } from '../../../hooks/useSwap';
import type { SwapDirection } from '../../../services/breezSparkService';
import {
  getGradientColors,
  getPrimaryTextColor,
  getSecondaryTextColor,
} from '../../../utils/theme-helpers';

type SwapScreenProps = {
  initialDirection?: SwapDirection;
};

export function SwapScreen({ initialDirection = 'BTC_TO_USDB' }: SwapScreenProps) {
  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const { direction } = useSwap(initialDirection);

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            onPress={() => router.back()}
            iconColor={secondaryTextColor}
            accessibilityLabel="Back"
          />
          <Text variant="headlineSmall" style={[styles.headerTitle, { color: primaryTextColor }]}>Swap</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.content}>
          <Text style={{ color: primaryTextColor }}>Swap screen placeholder</Text>
          <Text style={{ color: secondaryTextColor }}>Direction: {direction}</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  headerTitle: {
    textAlign: 'center',
    fontWeight: '700',
  },
  headerSpacer: {
    width: 48,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 8,
  },
});
