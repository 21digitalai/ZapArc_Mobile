// useCurrency Hook
// Provides currency formatting with automatic exchange rate updates

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSettings } from './useSettings';
import { getDisplayCurrency as getStoredDisplayCurrency, setDisplayCurrency as setStoredDisplayCurrency, type DisplayCurrency } from '../services/displayCurrencyService';
import {
  getExchangeRates,
  getCachedRates,
  fiatToSats,
  btcToSats,
  formatSats,
  formatFiat,
  formatFiatCompact,
  satsToFiat,
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

  const [rates, setRates] = useState<ExchangeRates | null>(getCachedRates());
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>('sats');

  useEffect(() => {
    let mounted = true;

    const loadDisplayCurrency = async (): Promise<void> => {
      const value = await getStoredDisplayCurrency(secondaryFiatCurrency);
      if (mounted) {
        setDisplayCurrencyState(value);
      }
    };

    void loadDisplayCurrency();

    return (): void => {
      mounted = false;
    };
  }, [secondaryFiatCurrency]);

  // Fetch rates on mount and periodically
  useEffect(() => {
    let mounted = true;

    const fetchRates = async (): Promise<void> => {
      setIsLoadingRates(true);
      try {
        const newRates = await getExchangeRates();
        if (mounted) {
          setRates(newRates);
        }
      } finally {
        if (mounted) {
          setIsLoadingRates(false);
        }
      }
    };

    fetchRates();

    const interval = global.setInterval(fetchRates, 5 * 60 * 1000);

    return (): void => {
      mounted = false;
      global.clearInterval(interval);
    };
  }, []);

  // Manual refresh rates
  const refreshRates = useCallback(async (): Promise<void> => {
    setIsLoadingRates(true);
    try {
      const newRates = await getExchangeRates();
      setRates(newRates);
    } finally {
      setIsLoadingRates(false);
    }
  }, []);

  // Refresh settings from storage (call when returning to screen)
  const refreshSettings = useCallback(async (): Promise<void> => {
    await loadSettings();
  }, [loadSettings]);

  // Format amount with current display currency
  const format = useCallback(
    (sats: number, options?: { hideBalance?: boolean }): FormattedAmount => {
      const { hideBalance = false } = options || {};
      if (hideBalance) {
        return {
          primary: '••••••',
          secondary: null,
          secondaryCompact: null,
        };
      }

      const safeSats = typeof sats === 'number' && !isNaN(sats) ? sats : 0;

      if (displayCurrency === 'sats') {
        // When the user has sats as their primary display, show their
        // configured secondary fiat equivalent below — e.g. sats as primary,
        // "≈ €122.45" as secondary. Previously returned null for secondary
        // which hid the fiat conversion entirely.
        const fiatCode = secondaryFiatCurrency || 'usd';
        const hasRate = !!rates && rates[fiatCode] > 0;
        const fiatAmount = hasRate ? satsToFiat(safeSats, rates, fiatCode) : null;
        return {
          primary: `${formatSats(safeSats)} sats`,
          secondary: fiatAmount !== null ? `≈ ${formatFiat(fiatAmount, fiatCode)}` : null,
          secondaryCompact: fiatAmount !== null ? formatFiatCompact(fiatAmount, fiatCode) : null,
        };
      }

      if (!rates || rates[displayCurrency] <= 0) {
        return {
          primary: `${formatSats(safeSats)} sats`,
          secondary: null,
          secondaryCompact: null,
        };
      }

      const fiatAmount = satsToFiat(safeSats, rates, displayCurrency);
      return {
        primary: formatFiat(fiatAmount, displayCurrency),
        secondary: `${formatSats(safeSats)} sats`,
        secondaryCompact: `${formatSats(safeSats)} sats`,
      };
    },
    [displayCurrency, rates, secondaryFiatCurrency]
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

      const formatted = format(amount);
      return {
        primary: `${prefix}${formatted.primary}`,
        secondary: formatted.secondary,
        secondaryCompact: formatted.secondaryCompact,
      };
    },
    [format]
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
    setDisplayCurrencyState(currency);
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
