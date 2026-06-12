// useCurrency Hook
// Provides currency formatting with automatic exchange rate updates.
//
// Exchange rates and the selected display currency live in module-level shared
// stores (see utils/createStore): rates are fetched by a SINGLE poller instead
// of one 5-minute interval per mounted consumer, and changing the display
// currency on one screen updates every other consumer immediately. Settings
// come from useSettings, which is itself a shared store.

import { useEffect, useCallback, useMemo } from 'react';
import { useSettings } from './useSettings';
import { getDisplayCurrency as getStoredDisplayCurrency, setDisplayCurrency as setStoredDisplayCurrency, type DisplayCurrency } from '../services/displayCurrencyService';
import { createStore } from '../utils/createStore';
import {
  getExchangeRates,
  getCachedRates,
  fiatToSats,
  btcToSats,
  formatSats,
  formatFiat,
  satsToFiat,
  formatAmountWithSettings,
  formatTransactionAmountWithSettings,
} from '../utils/currency';
import type { PrimaryDenomination, FiatCurrency } from '../features/settings/types';
import type { ExchangeRates, FormattedAmount, CurrencySettings } from '../utils/currency';

// Input currency type for amount entry
export type InputCurrency = 'sats' | 'btc' | 'usd' | 'eur';

// =============================================================================
// Types
// =============================================================================

interface UseCurrencyReturn {
  // Current currency settings
  primaryDenomination: PrimaryDenomination;
  secondaryFiatCurrency: FiatCurrency;
  currencySettings: CurrencySettings;
  displayCurrency: DisplayCurrency;

  // Exchange rates
  rates: ExchangeRates | null;
  isLoadingRates: boolean;

  // Formatting functions
  format: (sats: number, options?: { hideBalance?: boolean }) => FormattedAmount;
  formatTx: (
    sats: number,
    isReceived: boolean,
    opts?: { asset?: 'BTC' | 'USDB'; tokenDecimals?: number },
  ) => FormattedAmount;
  formatCompact: (sats: number) => string;

  // Conversion functions for input
  convertToSats: (amount: number, inputCurrency: InputCurrency) => number;
  formatSatsWithFiat: (sats: number) => { satsDisplay: string; fiatDisplay: string | null };

  // Refresh functions
  refreshRates: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  setDisplayCurrency: (currency: DisplayCurrency) => Promise<void>;
}

// =============================================================================
// Shared stores: exchange rates (single poller) + display currency
// =============================================================================

const ratesStore = createStore<{ rates: ExchangeRates | null; isLoadingRates: boolean }>({
  rates: getCachedRates(),
  isLoadingRates: false,
});

async function fetchRatesStore(): Promise<void> {
  ratesStore.setState({ isLoadingRates: true });
  try {
    const newRates = await getExchangeRates();
    ratesStore.setState({ rates: newRates, isLoadingRates: false });
  } catch {
    ratesStore.setState({ isLoadingRates: false });
  }
}

// One poller for the whole app, started when the first consumer mounts.
const RATES_POLL_MS = 5 * 60 * 1000;
let ratesPollStarted = false;
function ensureRatesPolling(): void {
  if (ratesPollStarted) return;
  ratesPollStarted = true;
  void fetchRatesStore();
  global.setInterval(() => void fetchRatesStore(), RATES_POLL_MS);
}

const displayCurrencyStore = createStore<{ displayCurrency: DisplayCurrency }>({
  displayCurrency: 'sats',
});

async function loadDisplayCurrencyStore(secondaryFiatCurrency: FiatCurrency): Promise<void> {
  const value = await getStoredDisplayCurrency(secondaryFiatCurrency);
  displayCurrencyStore.setState({ displayCurrency: value });
}

// =============================================================================
// Hook
// =============================================================================

export function useCurrency(): UseCurrencyReturn {
  const { settings, loadSettings } = useSettings();

  // Get the new split settings, with fallbacks for backwards compatibility
  const primaryDenomination: PrimaryDenomination = settings?.primaryDenomination ||
    (settings?.currency === 'btc' ? 'btc' : 'sats');
  const secondaryFiatCurrency: FiatCurrency = settings?.secondaryFiatCurrency ||
    (settings?.currency === 'eur' ? 'eur' : 'usd');

  // Memoize the currency settings object
  const currencySettings = useMemo<CurrencySettings>(() => ({
    primaryDenomination,
    secondaryFiatCurrency,
  }), [primaryDenomination, secondaryFiatCurrency]);

  const { rates, isLoadingRates } = ratesStore.useStore();
  const { displayCurrency } = displayCurrencyStore.useStore();

  // Load the display currency whenever the secondary fiat changes (its default
  // depends on it). Writes to the shared store, so all consumers stay in sync.
  useEffect(() => {
    void loadDisplayCurrencyStore(secondaryFiatCurrency);
  }, [secondaryFiatCurrency]);

  // Start the single app-wide rates poller.
  useEffect(() => {
    ensureRatesPolling();
  }, []);

  // Manual refresh rates
  const refreshRates = useCallback((): Promise<void> => fetchRatesStore(), []);

  // Refresh settings from storage (call when returning to screen)
  const refreshSettings = useCallback(async (): Promise<void> => {
    await loadSettings();
  }, [loadSettings]);

  // Format amount using the canonical split-settings formatter:
  //   primary  = Bitcoin in the user's denomination (sats or BTC)
  //   secondary = fiat conversion in the user's chosen currency (USD/EUR)
  //
  // IMPORTANT: this delegates to formatAmountWithSettings(currencySettings)
  // rather than the legacy single-value `displayCurrency`. The Currency
  // Settings screen writes primaryDenomination + secondaryFiatCurrency, but
  // `displayCurrency` lives in a SEPARATE store that the settings screen
  // never updates — so the old implementation showed a stale fiat symbol
  // (e.g. kept "$" after the user switched to EUR). Sourcing from
  // currencySettings makes the home balance track the settings UI exactly.
  const format = useCallback(
    (sats: number, options?: { hideBalance?: boolean }): FormattedAmount => {
      return formatAmountWithSettings(sats, currencySettings, rates, options);
    },
    [currencySettings, rates]
  );

  // Format transaction amount. `amount` is denominated per the tx's asset:
  //   BTC (default): amount is in satoshis → run through the normal BTC
  //     formatter which also shows a fiat equivalent.
  //   USDB: amount is in USDB base units (tokenDecimals = 6 by default).
  //     Format as "X.XX USDB" — no sat conversion, no fiat conversion, since
  //     USDB itself IS a fiat stablecoin (1 USDB ≈ $1).
  const formatTx = useCallback(
    (
      amount: number,
      isReceived: boolean,
      opts?: { asset?: 'BTC' | 'USDB'; tokenDecimals?: number },
    ): FormattedAmount => {
      const prefix = isReceived ? '+' : '-';

      if (opts?.asset === 'USDB') {
        const decimals = opts.tokenDecimals ?? 6;
        const whole = (Number(amount) || 0) / 10 ** decimals;
        const usdbStr = `${whole.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} USDB`;
        return {
          primary: `${prefix}${usdbStr}`,
          // No secondary — USDB is already a USD-equivalent.
          secondary: null,
          secondaryCompact: null,
        };
      }

      return formatTransactionAmountWithSettings(amount, isReceived, currencySettings, rates);
    },
    [currencySettings, rates]
  );

  // Format compact (for tight spaces like transaction list)
  const formatCompact = useCallback(
    (sats: number): string => {
      return format(sats).primary;
    },
    [format]
  );

  // Convert input amount to sats based on input currency
  const convertToSats = useCallback(
    (amount: number, inputCurrency: InputCurrency): number => {
      if (!amount || isNaN(amount)) return 0;

      switch (inputCurrency) {
        case 'sats':
          return Math.round(amount);
        case 'btc':
          return btcToSats(amount);
        case 'usd':
          return fiatToSats(amount, rates, 'usd');
        case 'eur':
          return fiatToSats(amount, rates, 'eur');
        default:
          return Math.round(amount);
      }
    },
    [rates]
  );

  // Format sats with display-currency-aware equivalent for screen widgets
  const formatSatsWithFiat = useCallback(
    (sats: number): { satsDisplay: string; fiatDisplay: string | null } => {
      if (displayCurrency === 'sats') {
        return { satsDisplay: `${formatSats(sats)} sats`, fiatDisplay: null };
      }

      if (rates && rates[displayCurrency] > 0) {
        const fiatAmount = satsToFiat(sats, rates, displayCurrency);
        return {
          satsDisplay: `${formatSats(sats)} sats`,
          fiatDisplay: formatFiat(fiatAmount, displayCurrency),
        };
      }

      return { satsDisplay: `${formatSats(sats)} sats`, fiatDisplay: null };
    },
    [displayCurrency, rates]
  );

  const setDisplayCurrency = useCallback(async (currency: DisplayCurrency): Promise<void> => {
    displayCurrencyStore.setState({ displayCurrency: currency });
    await setStoredDisplayCurrency(currency);
  }, []);

  return {
    primaryDenomination,
    secondaryFiatCurrency,
    currencySettings,
    displayCurrency,
    rates,
    isLoadingRates,
    format,
    formatTx,
    formatCompact,
    convertToSats,
    formatSatsWithFiat,
    refreshRates,
    refreshSettings,
    setDisplayCurrency,
  };
}
