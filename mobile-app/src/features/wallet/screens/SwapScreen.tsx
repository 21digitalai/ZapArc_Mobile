import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { syncWallet as syncWalletSdk, resolveSwapTokens } from '../../../services/breezSparkService';
import { IconButton, Text, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

import { useAppTheme } from '../../../contexts/ThemeContext';
import { useSwap } from '../../../hooks/useSwap';
import { useWallet } from '../../../hooks/useWallet';
import { useCurrency } from '../../../hooks/useCurrency';
import { useLanguage } from '../../../hooks/useLanguage';
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

/**
 * Format a base-unit amount for human display.
 *   • sats → "1,234 sats" (thousands-separated, integer)
 *   • USDB → "6.20 USDB" (scaled by 10^decimals, 2dp)
 */
function formatAmount(value: bigint, symbol: string, decimals = 0): string {
  if (symbol.toUpperCase() === 'USDB' && decimals > 0) {
    const n = Number(value) / 10 ** decimals;
    return `${n.toFixed(2)} USDB`;
  }
  // sats path: integer with thousands separator
  return `${Number(value).toLocaleString('en-US')} ${symbol}`;
}

export function SwapScreen({ initialDirection = 'BTC_TO_USDB' }: SwapScreenProps) {
  const navigation = useNavigation();
  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const swap = useSwap(initialDirection);
  const {
    balance: btcBalanceSats,
    usdbBalance,
    refreshBalance,
    refreshTransactions,
    applySwapResult,
  } = useWallet();
  const { rates } = useCurrency();
  const { t } = useLanguage();

  // Keep a snapshot of the last confirmed quote so we can show the received
  // amount in the Home snackbar after the success redirect — the swap state
  // drops `quote` once status transitions to 'success'.
  const lastConfirmedQuoteRef = useRef<{
    direction: typeof swap.direction;
    receiveAmount: string;
    usdbDecimals: number;
  } | null>(null);

  useEffect(() => {
    if (swap.state.status === 'confirming' && swap.state.quote) {
      lastConfirmedQuoteRef.current = {
        direction: swap.state.quote.direction,
        receiveAmount: String(swap.state.quote.receiveAmount),
        usdbDecimals: swap.state.quote.usdbDecimals,
      };
    }
  }, [swap.state]);

  // After a successful swap, trigger a wallet-state refresh then redirect
  // to Home with the destination-asset tab active and a success toast.
  // Breez's internal sync also fires, but we push a client-side refresh so
  // the new balance is ready by the time Home mounts.
  useEffect(() => {
    if (swap.state.status !== 'success') return;

    // Synchronously apply the swap result to wallet state (balance + tx list
    // + tokenBalances) using the authoritative amounts returned by
    // sendPayment. Then redirect immediately — no polling needed, UI is
    // correct from the first Home render. A single background reconciliation
    // refresh runs after a short delay to pick up the canonical SDK tx row
    // (replacing our optimistic one) and any tiny amount differences due to
    // slippage between estimate and actual settlement.
    const snap = lastConfirmedQuoteRef.current;
    const result = (swap.state as { result: import('../../../services/breezSparkService').SwapResult }).result;
    const destAsset = snap?.direction === 'USDB_TO_BTC' ? 'BTC' : 'USDB';

    void (async () => {
      try {
        const [usdbToken] = await resolveSwapTokens();
        if (result.direction && result.spent != null && result.received != null && usdbToken) {
          applySwapResult({
            direction: result.direction,
            spent: result.spent,
            received: result.received,
            tokenIdentifier: usdbToken.tokenIdentifier,
            tokenDecimals: usdbToken.internalDecimals ?? snap?.usdbDecimals ?? 6,
            paymentId: result.paymentId,
          });
        }
      } catch (err) {
        console.warn('⚠️ [SwapScreen] applySwapResult failed, falling back to refresh', err);
      }

      const receivedDisplay = snap
        ? destAsset === 'USDB'
          ? (Number(snap.receiveAmount) / 10 ** snap.usdbDecimals).toFixed(2)
          : Number(snap.receiveAmount).toLocaleString()
        : '';

      router.replace({
        pathname: '/wallet/home',
        params: {
          swapSuccess: 'true',
          swapAsset: destAsset,
          swapReceived: receivedDisplay,
        },
      });

      // Background reconciliation — nudge Breez to sync, then one refresh.
      // Don't await; UI already has correct optimistic state.
      void (async () => {
        try { await syncWalletSdk(); } catch {}
        try { await Promise.all([refreshBalance(), refreshTransactions()]); } catch {}
      })();
    })();
  }, [swap.state, applySwapResult, refreshBalance, refreshTransactions]);

  // Refunded/dustResidual don't redirect — keep the result screen so the
  // user can see what happened and retry.
  useEffect(() => {
    if (swap.state.status === 'dustResidual' || swap.state.status === 'refunded') {
      void refreshBalance();
      void refreshTransactions();
    }
  }, [swap.state.status, refreshBalance, refreshTransactions]);

  // Push the active-source balance into the useSwap hook so its
  // insufficientBalance check works and Max gets a real value.
  // Values come from the wallet in DIFFERENT units per asset — convert to
  // source base units per direction.
  useEffect(() => {
    if (swap.direction === 'BTC_TO_USDB') {
      swap.setAvailableBalance(btcBalanceSats ? BigInt(btcBalanceSats) : 0n);
    } else {
      // usdbBalance is a number in display USDB (e.g. 6.48). Scale to base units.
      const base = Math.floor((usdbBalance || 0) * 10 ** swap.usdbDecimals);
      swap.setAvailableBalance(BigInt(base));
    }
  }, [swap.direction, swap.usdbDecimals, btcBalanceSats, usdbBalance]);

  const isConfirming = swap.state.status === 'confirming';
  const isQuoteReady = swap.state.status === 'quoteLoaded' || swap.state.status === 'quoteRefreshing';
  // activeQuote exposes state.quote for ANY state that carries one — including
  // 'reviewing' (modal open) and 'confirming' (swap in flight) so the Review
  // modal and confirming overlay see the amounts, not blanks.
  const activeQuote = (() => {
    const s = swap.state;
    switch (s.status) {
      case 'quoteLoaded':
      case 'quoteRefreshing':
      case 'reviewing':
      case 'confirming':
        return s.quote;
      case 'insufficientBalance':
        return s.quote;
      default:
        return null;
    }
  })();
  const quoteLoading = swap.state.status === 'typing' || swap.state.status === 'quoteLoading' || swap.state.status === 'quoteRefreshing';

  // Use 'sats' on the BTC side (not 'BTC') — balances are denominated in sats
  // throughout the app and typing BTC fractional values is awkward on mobile.
  const fromTicker = swap.direction === 'BTC_TO_USDB' ? 'sats' : 'USDB';
  const toTicker = swap.direction === 'BTC_TO_USDB' ? 'USDB' : 'sats';

  // Human-readable rate: SDK returns amountOut/amountIn (tiny number for
  // base-unit division). Convert to "1 BTC = X USDB" form so the user can
  // sanity-check vs a market rate they recognise.
  const rateText = (() => {
    if (!activeQuote || !activeQuote.rate) return '...';
    const decimals = activeQuote.usdbDecimals ?? 6;
    if (activeQuote.direction === 'BTC_TO_USDB') {
      // rate = USDB_base_units_per_sat → USDB_per_BTC = rate * 1e8 / 10^decimals
      const usdbPerBtc = (activeQuote.rate * 1e8) / 10 ** decimals;
      return `1 BTC = $${usdbPerBtc.toFixed(2)} USDB`;
    } else {
      // rate = sats_per_usdb_base_unit → sats_per_USDB = rate * 10^decimals
      const satsPerUsdb = activeQuote.rate * 10 ** decimals;
      return `1 USDB = ${Math.round(satsPerUsdb)} sats`;
    }
  })();

  // Always show fee in sats (BTC-native unit) first, with USDB equivalent
  // in parentheses as a secondary hint. The SDK reports fee in destination
  // units; convert BTC→USDB fees back to sats via the pool rate.
  const feeText = (() => {
    if (!activeQuote) return '...';
    const decimals = activeQuote.usdbDecimals ?? 6;
    if (activeQuote.direction === 'BTC_TO_USDB') {
      // feeSat here is USDB base units (naming is legacy). Convert to sats
      // using the pool rate (USDB_base per sat).
      const feeUsdbBase = Number(activeQuote.feeSat);
      const feeSats = activeQuote.rate > 0 ? Math.round(feeUsdbBase / activeQuote.rate) : 0;
      const feeUsdbDisplay = feeUsdbBase / 10 ** decimals;
      return `${feeSats.toLocaleString('en-US')} sats (≈ ${feeUsdbDisplay.toFixed(2)} USDB)`;
    }
    // USDB→BTC: feeSat is already in sats.
    const feeSats = Number(activeQuote.feeSat);
    // rate = sats per USDB base unit → usdb_base = sats / rate
    const feeUsdbBase = activeQuote.rate > 0 ? feeSats / activeQuote.rate : 0;
    const feeUsdbDisplay = feeUsdbBase / 10 ** decimals;
    return feeUsdbDisplay > 0
      ? `${feeSats.toLocaleString('en-US')} sats (≈ ${feeUsdbDisplay.toFixed(2)} USDB)`
      : `${feeSats.toLocaleString('en-US')} sats`;
  })();

  // Format the destination amount for display. The SDK returns base units
  // (sats for BTC side, token base units for USDB side). We scale the USDB
  // amount by 10^decimals before display so 6_200_000 → "6.20".
  const formatBaseUnits = (baseUnits: bigint, isUsdb: boolean, decimals: number): string => {
    if (!isUsdb) return baseUnits.toString();
    if (!Number.isFinite(decimals) || decimals <= 0) return baseUnits.toString();
    const n = Number(baseUnits) / 10 ** decimals;
    return n.toFixed(2);
  };

  const receiveIsUsdb = swap.direction === 'BTC_TO_USDB';
  const usdbDecimals = activeQuote?.usdbDecimals ?? swap.usdbDecimals;

  // Instant rate-based estimate for the destination field during typing/loading
  // states. Without this, the destination card sits empty for ~400ms + SDK
  // round-trip, making the UI feel broken. When the real SDK quote arrives
  // via activeQuote it supersedes this estimate. Returns just the number
  // string — the SwapAmountCard adds the currency label itself.
  const instantEstimate = useMemo(() => {
    if (activeQuote) return null; // real quote takes priority
    if (!swap.amountInput || swap.amountInput === '.') return null;
    if (!rates || !rates.usd || rates.usd <= 0) return null;
    const parsed = parseFloat(swap.amountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    if (swap.direction === 'BTC_TO_USDB') {
      const usd = (parsed * rates.usd) / 100_000_000;
      return `~${usd.toFixed(2)}`;
    } else {
      const sats = Math.round((parsed * 100_000_000) / rates.usd);
      return `~${sats.toLocaleString('en-US')}`;
    }
  }, [swap.amountInput, swap.direction, rates, activeQuote]);

  // Keep the last formatted receive string around so the destination card
  // doesn't blank between quote refreshes / direction flips.
  const [cachedReceive, setCachedReceive] = useState('');
  useEffect(() => {
    if (activeQuote) {
      setCachedReceive(formatBaseUnits(activeQuote.receiveAmount, receiveIsUsdb, usdbDecimals));
    } else if (!swap.amountInput) {
      setCachedReceive('');
    }
  }, [activeQuote, swap.amountInput, receiveIsUsdb, usdbDecimals]);

  // Track which field the user is actively editing so we preserve their raw
  // typing in the destination card (otherwise the controlled `value` prop
  // that's driven by the quote overrides every keystroke and the field feels
  // like it clears itself). `destinationDraft` is the raw string the user
  // typed into the receive card — shown verbatim while they're editing.
  const [lastTypedField, setLastTypedField] = useState<'source' | 'destination' | null>(null);
  const [destinationDraft, setDestinationDraft] = useState('');

  // When a fresh quote arrives, clear BOTH the destination draft AND the
  // lastTypedField flag so the card re-hydrates from the real quote value.
  // Otherwise `lastTypedField==='destination'` combined with an empty draft
  // would leave the card looking empty after a quote lands.
  useEffect(() => {
    if (activeQuote) {
      setDestinationDraft('');
      setLastTypedField(null);
    }
    if (!swap.amountInput) {
      setDestinationDraft('');
      setLastTypedField(null);
    }
  }, [activeQuote, swap.amountInput]);

  // While the user is actively editing the destination card, show their
  // raw draft — even when empty. Previously we fell through to the cached
  // value when draft was '' (falsy), which re-hydrated "0.0" and trapped
  // the cursor after the decimal when the user tried to clear and retype.
  const receiveDisplay =
    lastTypedField === 'destination'
      ? destinationDraft
      : (instantEstimate ?? cachedReceive);

  // Format the source-side max balance as a caption displayed next to Max.
  const maxHint = useMemo(() => {
    if (swap.availableBalance === null || swap.availableBalance <= 0n) return undefined;
    if (swap.direction === 'BTC_TO_USDB') {
      // Reserve 500 sats for fees (matches Max button behavior).
      const usable = swap.availableBalance > 500n ? swap.availableBalance - 500n : 0n;
      return `Max: ${Number(usable).toLocaleString('en-US')} sats`;
    }
    const whole = Number(swap.availableBalance) / 10 ** swap.usdbDecimals;
    return `Max: ${whole.toFixed(2)} USDB`;
  }, [swap.availableBalance, swap.direction, swap.usdbDecimals]);

  // When the user types in the destination card, we store their raw draft
  // (so the card doesn't appear to clear itself) AND try to reverse-compute
  // the source field using the last known rate. Accepts decimal input for USDB.
  const handleReceiveChange = (nextReceive: string): void => {
    let cleaned = nextReceive.replace(/[^0-9.]/g, '');
    if (!receiveIsUsdb) {
      cleaned = cleaned.replace(/\./g, '');
    } else {
      const parts = cleaned.split('.');
      if (parts.length > 1) cleaned = parts[0] + '.' + parts.slice(1).join('').slice(0, usdbDecimals);
    }

    // Remember the user's raw destination text so the card shows it verbatim
    // until a quote arrives (activeQuote-driven display takes over then).
    setLastTypedField('destination');
    setDestinationDraft(cleaned);

    // Guard against phantom empty onChangeText events (Android IME).
    if (!cleaned || cleaned === '.') return;

    // Parse destination display → base units, then reverse-compute source.
    let destBase: number;
    if (receiveIsUsdb) {
      destBase = Math.floor(parseFloat(cleaned) * 10 ** usdbDecimals);
    } else {
      destBase = parseInt(cleaned, 10);
    }
    if (!Number.isFinite(destBase) || destBase <= 0) return;

    // Prefer real quote ratio; fall back to rates.usd for first-type UX.
    let ratio: number | null = null;
    if (activeQuote && activeQuote.payAmount > 0n && activeQuote.receiveAmount > 0n) {
      ratio = Number(activeQuote.payAmount) / Number(activeQuote.receiveAmount);
    } else if (rates && rates.usd > 0) {
      if (swap.direction === 'BTC_TO_USDB') {
        // dest is USDB base units, source is sats.
        // USDB_base → USD = dest / 10^decimals; USD → sats = USD * 1e8 / usdRate
        // ratio (sats per USDB base) = 1e8 / (usdRate * 10^decimals)
        ratio = 1e8 / (rates.usd * 10 ** usdbDecimals);
      } else {
        // dest is sats, source is USDB base units.
        ratio = (rates.usd * 10 ** usdbDecimals) / 1e8;
      }
    }
    if (ratio === null) return;

    const sourceBase = Math.round(destBase * ratio);
    const sourceDisplay = swap.direction === 'USDB_TO_BTC'
      ? (sourceBase / 10 ** usdbDecimals).toString() // USDB source (display units)
      : sourceBase.toString();                        // sats source
    swap.setAmountInput(sourceDisplay);
  };
  const inlineError = useMemo(() => {
    if (swap.state.status === 'error') return swap.state.message;
    if (swap.state.status === 'belowMin') {
      // Limits are in source base units. For BTC direction that's sats (OK).
      // For USDB direction, scale down by 10^decimals to show "0.5 USDB".
      const formatted = swap.direction === 'BTC_TO_USDB'
        ? `${Number(swap.state.min).toLocaleString('en-US')} sats`
        : `${(Number(swap.state.min) / 10 ** swap.usdbDecimals).toFixed(2)} USDB`;
      return `Minimum: ${formatted}`;
    }
    if (swap.state.status === 'aboveMax') {
      const formatted = swap.direction === 'BTC_TO_USDB'
        ? `${Number(swap.state.max).toLocaleString('en-US')} sats`
        : `${(Number(swap.state.max) / 10 ** swap.usdbDecimals).toFixed(2)} USDB`;
      return `Maximum: ${formatted}`;
    }
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
    // Success: no dedicated screen — a useEffect redirects to Home with a
    // snackbar as soon as the balance refresh completes. While that promise
    // is in flight we show a lightweight spinner instead of the old "Done"
    // card so the user never sees the blank success state.
    if (swap.state.status === 'success') {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      );
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
            accessibilityLabel={t('common.back')}
          />
          <Text variant="headlineSmall" style={[styles.headerTitle, { color: primaryTextColor }]}>{t('swap.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {swap.isOffline && (
          <Text style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t('swap.error.offline')}
          </Text>
        )}
        {swap.limitsUnavailable && (
          <Text style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {t('swap.error.limitsUnavailable')}
          </Text>
        )}

        <ScrollView contentContainerStyle={styles.content}>
          {renderResult() || (
            <>
              <SwapAmountCard
                label={t('swap.youPay')}
                currency={fromTicker}
                amount={swap.amountInput}
                onAmountChange={(next) => {
                  // Allow digits and a single decimal point (USDB side only).
                  // For BTC/sats side, strip decimal points entirely.
                  let cleaned = next.replace(/[^0-9.]/g, '');
                  if (swap.direction === 'BTC_TO_USDB') {
                    cleaned = cleaned.replace(/\./g, '');
                  } else {
                    const parts = cleaned.split('.');
                    if (parts.length > 1) {
                      cleaned = parts[0] + '.' + parts.slice(1).join('').slice(0, swap.usdbDecimals);
                    }
                  }
                  setLastTypedField('source');
                  setDestinationDraft(''); // source edit invalidates destination draft
                  swap.setAmountInput(cleaned);
                }}
                onMax={() => {
                  if (swap.availableBalance === null) return;
                  if (swap.direction === 'BTC_TO_USDB') {
                    // Keep a small fee buffer so the user doesn't over-commit.
                    const reserve = 500n;
                    const max = swap.availableBalance > reserve ? swap.availableBalance - reserve : 0n;
                    swap.setAmountInput(max > 0n ? max.toString() : '');
                  } else {
                    // USDB side: show display units. balance is in base units.
                    const decimals = swap.usdbDecimals;
                    const whole = swap.availableBalance / BigInt(10 ** decimals);
                    const frac = swap.availableBalance % BigInt(10 ** decimals);
                    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
                    swap.setAmountInput(fracStr ? `${whole}.${fracStr}` : `${whole}`);
                  }
                }}
                // Never show skeleton on the card the user is actively typing in —
                // it replaces the TextInput and kills focus. Loading state is
                // signalled on the rate/fee line instead.
                isLoading={false}
                maxDisabled={isConfirming || !swap.availableBalance || swap.availableBalance <= 0n}
                maxDisabledTooltip={isConfirming ? t('swap.confirming.title') : undefined}
                maxHint={maxHint}
              />

              <TouchableOpacity
                style={styles.flipButton}
                onPress={swap.flipDirection}
                disabled={isConfirming}
                accessibilityRole="button"
                accessibilityLabel={t('swap.flipDirection')}
              >
                <Text style={styles.flipText}>⇅</Text>
              </TouchableOpacity>

              <SwapAmountCard
                label={t('swap.youReceive')}
                currency={toTicker}
                amount={receiveDisplay}
                onAmountChange={handleReceiveChange}
                onMax={() => undefined}
                // Same reasoning as source card — skeleton unmounts the input
                // and disrupts typing. Loading state signalled on rate line.
                isLoading={false}
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
                <View
                  style={styles.confirmingBox}
                  accessibilityRole="progressbar"
                  accessibilityLabel={t('swap.confirming.accessibilityLabel', { seconds: CONFIRMING_SECONDS })}
                  accessibilityLiveRegion="polite"
                >
                  <ActivityIndicator color={BRAND_COLOR} accessibilityLabel={t('swap.confirming.title')} />
                  <Text style={{ color: primaryTextColor, marginTop: 8 }}>{t('swap.confirming.progressLabel', { seconds: CONFIRMING_SECONDS })}</Text>
                </View>
              ) : (
                <Button
                  mode="contained"
                  buttonColor={BRAND_COLOR}
                  textColor="#1a1a2e"
                  onPress={swap.openReview}
                  // `loading` shows the Paper inline spinner without blocking
                  // layout; `disabled` still prevents premature taps.
                  loading={quoteLoading}
                  disabled={!isQuoteReady}
                  accessibilityRole="button"
                  accessibilityLabel={quoteLoading ? t('swap.loadingQuote') : t('swap.reviewButton')}
                >
                  {quoteLoading ? t('swap.loadingQuote') : t('swap.reviewButton')}
                </Button>
              )}
            </>
          )}
        </ScrollView>

        <SwapReviewModal
          visible={swap.state.status === 'reviewing'}
          direction={swap.direction}
          payAmount={activeQuote ? formatAmount(
            // For BTC→USDB we show the SDK's actual amountIn (sats it charges),
            // not the approximate user input. For USDB→BTC we show user input
            // already in USDB base units (useSwap scaled it for us).
            activeQuote.direction === 'BTC_TO_USDB' ? activeQuote.payAmount : activeQuote.amount,
            fromTicker,
            fromTicker === 'USDB' ? activeQuote.usdbDecimals : 0,
          ) : ''}
          receiveAmount={activeQuote ? formatAmount(
            activeQuote.receiveAmount,
            toTicker,
            toTicker === 'USDB' ? activeQuote.usdbDecimals : 0,
          ) : ''}
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
