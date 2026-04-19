import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { IconButton, Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { useAppTheme } from '../../../contexts/ThemeContext';
import { useSwap } from '../../../hooks/useSwap';
import type { SwapDirection } from '../../../services/breezSparkService';
import { SwapAmountCard } from '../components/SwapAmountCard';
import { SwapRateLine } from '../components/SwapRateLine';
import { SwapReviewModal } from '../components/SwapReviewModal';
import { SwapResultView } from '../components/SwapResultView';
import {
  BRAND_COLOR,
  getGradientColors,
  getPrimaryTextColor,
  getSecondaryTextColor,
} from '../../../utils/theme-helpers';

type SwapScreenProps = {
  initialDirection?: SwapDirection;
};

const CONFIRMING_SECONDS = 30;

function formatAmount(value: bigint, symbol: string): string {
  return `${value.toString()} ${symbol}`;
}

export function SwapScreen({ initialDirection = 'BTC_TO_USDB' }: SwapScreenProps) {
  const navigation = useNavigation();
  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const swap = useSwap(initialDirection);

  const isConfirming = swap.state.status === 'confirming';
  const isQuoteReady = swap.state.status === 'quoteLoaded' || swap.state.status === 'quoteRefreshing';
  const activeQuote =
    swap.state.status === 'quoteLoaded' || swap.state.status === 'quoteRefreshing'
      ? swap.state.quote
      : null;
  const quoteLoading = swap.state.status === 'typing' || swap.state.status === 'quoteLoading' || swap.state.status === 'quoteRefreshing';

  const fromTicker = swap.direction === 'BTC_TO_USDB' ? 'BTC' : 'USDB';
  const toTicker = swap.direction === 'BTC_TO_USDB' ? 'USDB' : 'BTC';

  const rateText = activeQuote ? `${activeQuote.rate}` : '...';
  const feeText = activeQuote ? `${activeQuote.feeSat.toString()} sats` : '...';

  const inlineError = useMemo(() => {
    if (swap.state.status === 'error') return swap.state.message;
    if (swap.state.status === 'belowMin') return `Below minimum: ${swap.state.min.toString()}`;
    if (swap.state.status === 'aboveMax') return `Above maximum: ${swap.state.max.toString()}`;
    if (swap.state.status === 'insufficientBalance') return 'Insufficient balance';
    return undefined;
  }, [swap.state]);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !isConfirming });
  }, [isConfirming, navigation]);

  useEffect(() => {
    if (!isConfirming) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });

    return () => sub.remove();
  }, [isConfirming]);

  const renderResult = () => {
    if (swap.state.status === 'success') {
      return <SwapResultView kind="success" onDone={() => router.back()} />;
    }

    if (swap.state.status === 'dustResidual') {
      return (
        <SwapResultView
          kind="dustResidual"
          residualUsdb={swap.state.residualUsdbBaseUnits.toString()}
          onDone={() => router.back()}
        />
      );
    }

    if (swap.state.status === 'refunded') {
      return <SwapResultView kind="refunded" onRetry={swap.tryAgainFromRefund} onIncreaseSlippage={() => swap.setSlippageBps(swap.slippageBps + 50)} />;
    }

    return null;
  };

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            onPress={() => {
              if (!isConfirming) router.back();
            }}
            iconColor={secondaryTextColor}
            accessibilityLabel="Back"
          />
          <Text variant="headlineSmall" style={[styles.headerTitle, { color: primaryTextColor }]}>Swap</Text>
          <View style={styles.headerSpacer} />
        </View>

        {swap.isOffline && <Text style={styles.banner}>Offline</Text>}
        {swap.limitsUnavailable && <Text style={styles.banner}>Limits unavailable</Text>}
        {isConfirming && <Text style={styles.banner}>swap.backgrounded.toast</Text>}

        <ScrollView contentContainerStyle={styles.content}>
          {renderResult() || (
            <>
              <SwapAmountCard
                label="You pay"
                currency={fromTicker}
                amount={swap.amountInput}
                onAmountChange={swap.setAmountInput}
                onMax={() => swap.setAmountInput('0')}
                isLoading={quoteLoading}
                maxDisabled={isConfirming}
                maxDisabledTooltip={isConfirming ? 'Swap confirming' : undefined}
              />

              <TouchableOpacity
                style={styles.flipButton}
                onPress={swap.flipDirection}
                disabled={isConfirming}
                accessibilityLabel="Flip swap direction"
              >
                <Text style={styles.flipText}>⇅</Text>
              </TouchableOpacity>

              <SwapAmountCard
                label="You receive"
                currency={toTicker}
                amount={activeQuote ? activeQuote.receiveAmount.toString() : ''}
                onAmountChange={() => undefined}
                onMax={() => undefined}
                isReadOnly
                maxDisabled
              />

              <SwapRateLine
                rateText={rateText}
                feeText={feeText}
                slippageBps={swap.slippageBps}
                onSlippagePresetSelect={swap.setSlippageBps}
                inlineError={inlineError}
              />

              {isConfirming ? (
                <View style={styles.confirmingBox}>
                  <ActivityIndicator color={BRAND_COLOR} />
                  <Text style={{ color: primaryTextColor, marginTop: 8 }}>Confirming... (~{CONFIRMING_SECONDS}s)</Text>
                </View>
              ) : (
                <Button
                  mode="contained"
                  buttonColor={BRAND_COLOR}
                  textColor="#1a1a2e"
                  onPress={swap.openReview}
                  disabled={!isQuoteReady}
                >
                  Review
                </Button>
              )}
            </>
          )}
        </ScrollView>

        <SwapReviewModal
          visible={swap.state.status === 'reviewing'}
          direction={swap.direction}
          payAmount={activeQuote ? formatAmount(activeQuote.amount, fromTicker) : ''}
          receiveAmount={activeQuote ? formatAmount(activeQuote.receiveAmount, toTicker) : ''}
          rateText={rateText}
          feeText={feeText}
          slippageText={`${(swap.slippageBps / 100).toFixed(2)}%`}
          authError={swap.state.status === 'reviewing' ? swap.state.authError : undefined}
          onDismiss={swap.closeReview}
          onConfirm={async () => {
            await swap.confirmSwap();
          }}
        />
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
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    gap: 12,
  },
  banner: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    color: '#FFB74D',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  flipButton: {
    alignSelf: 'center',
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  flipText: {
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 22,
  },
  confirmingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
});
