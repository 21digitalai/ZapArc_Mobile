import AsyncStorage from '@react-native-async-storage/async-storage';

export type DisplayCurrency = 'sats' | 'usd' | 'eur';

export const DISPLAY_CURRENCY_KEY = 'display_currency';
export const DISPLAY_CURRENCY_ORDER: DisplayCurrency[] = ['sats', 'usd', 'eur'];

export function cycleDisplayCurrency(current: DisplayCurrency): DisplayCurrency {
  const index = DISPLAY_CURRENCY_ORDER.indexOf(current);
  if (index < 0) return 'sats';
  return DISPLAY_CURRENCY_ORDER[(index + 1) % DISPLAY_CURRENCY_ORDER.length];
}

export async function getDisplayCurrency(fallbackFiat: 'usd' | 'eur' = 'usd'): Promise<DisplayCurrency> {
  try {
    const raw = await AsyncStorage.getItem(DISPLAY_CURRENCY_KEY);
    if (raw === 'sats' || raw === 'usd' || raw === 'eur') {
      return raw;
    }

    // Migration for existing users: seed from current fiat preference once.
    await AsyncStorage.setItem(DISPLAY_CURRENCY_KEY, fallbackFiat);
    return fallbackFiat;
  } catch (error) {
    console.warn('[DisplayCurrency] Failed to read display currency:', error);
    return fallbackFiat;
  }
}

export async function setDisplayCurrency(currency: DisplayCurrency): Promise<void> {
  try {
    await AsyncStorage.setItem(DISPLAY_CURRENCY_KEY, currency);
  } catch (error) {
    console.warn('[DisplayCurrency] Failed to persist display currency:', error);
  }
}
