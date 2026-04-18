import AsyncStorage from '@react-native-async-storage/async-storage';

export type DisplayCurrency = 'sats' | 'usd' | 'eur';

export const DISPLAY_CURRENCY_KEY = 'display_currency';
export const DISPLAY_CURRENCY_ORDER: DisplayCurrency[] = ['sats', 'usd', 'eur'];
const LEGACY_USER_SETTINGS_KEY = '@zap_arc/user_settings';

export function cycleDisplayCurrency(current: DisplayCurrency): DisplayCurrency {
  const index = DISPLAY_CURRENCY_ORDER.indexOf(current);
  if (index < 0) return 'sats';
  return DISPLAY_CURRENCY_ORDER[(index + 1) % DISPLAY_CURRENCY_ORDER.length];
}

function getLegacyFiatCurrency(raw: string | null): 'usd' | 'eur' | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { secondaryFiatCurrency?: unknown; currency?: unknown };

    if (parsed.secondaryFiatCurrency === 'usd' || parsed.secondaryFiatCurrency === 'eur') {
      return parsed.secondaryFiatCurrency;
    }

    if (parsed.currency === 'usd' || parsed.currency === 'eur') {
      return parsed.currency;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getDisplayCurrency(fallbackFiat: 'usd' | 'eur' = 'usd'): Promise<DisplayCurrency> {
  try {
    const raw = await AsyncStorage.getItem(DISPLAY_CURRENCY_KEY);
    if (raw === 'sats' || raw === 'usd' || raw === 'eur') {
      return raw;
    }

    const legacySettingsRaw = await AsyncStorage.getItem(LEGACY_USER_SETTINGS_KEY);
    const legacyFiat = getLegacyFiatCurrency(legacySettingsRaw);

    const initialCurrency: DisplayCurrency = legacyFiat ?? 'sats';
    await AsyncStorage.setItem(DISPLAY_CURRENCY_KEY, initialCurrency);

    return initialCurrency;
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
