// useTheme Hook
// Manages app-wide theme switching with persistence

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MD3LightTheme, MD3DarkTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { settingsService } from '../services';
import type { ThemeMode } from '../features/settings/types';
import {
  BRAND_COLOR,
  getAppBackgroundColor,
  getBorderColor,
  getCardBackgroundColor,
  getPrimaryTextColor,
  getSecondaryTextColor,
} from '../utils/theme-helpers';

// =============================================================================
// Theme Definitions
// =============================================================================

// Factory functions to create fresh theme objects
const createLightTheme = (): MD3Theme => ({
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: BRAND_COLOR, // Gold accent
    background: getAppBackgroundColor('light'),
    surface: '#ffffff',
    onSurface: getPrimaryTextColor('light'),
    surfaceVariant: '#f5f5f5',
    onSurfaceVariant: getSecondaryTextColor('light'),
    outline: getBorderColor('light'),
  },
  roundness: 8,
});

const createDarkTheme = (): MD3Theme => ({
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: BRAND_COLOR, // Gold accent
    background: getAppBackgroundColor('dark'),
    surface: '#16213e',
    onSurface: getPrimaryTextColor('dark'),
    surfaceVariant: getCardBackgroundColor('dark'),
    onSurfaceVariant: getSecondaryTextColor('dark'),
    outline: getBorderColor('dark'),
  },
  roundness: 8,
});

// =============================================================================
// Types
// =============================================================================

export interface ThemeState {
  theme: MD3Theme;
  themeMode: ThemeMode;
  isLoading: boolean;
}

export interface ThemeActions {
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

export type UseThemeReturn = ThemeState & ThemeActions;

// =============================================================================
// Hook Implementation
// =============================================================================

export function useTheme(): UseThemeReturn {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [isLoading, setIsLoading] = useState(true);

  // Load theme from settings on mount
  useEffect(() => {
    const loadTheme = async (): Promise<void> => {
      try {
        const settings = await settingsService.getUserSettings();
        console.log('Loaded theme from settings:', settings.theme);
        setThemeModeState(settings.theme);
      } catch (error) {
        console.error('Failed to load theme:', error);
        setThemeModeState('dark'); // Fallback to dark
      } finally {
        setIsLoading(false);
      }
    };

    loadTheme();
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode): Promise<void> => {
    try {
      setThemeModeState(mode);
      await settingsService.updateUserSettings({ theme: mode });
    } catch (error) {
      console.error('Failed to save theme:', error);
      throw error;
    }
  }, []);

  const toggleTheme = useCallback(async (): Promise<void> => {
    // Use functional update to get the latest themeMode
    setThemeModeState((currentMode) => {
      const newMode: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';

      // Save the new theme asynchronously
      (async () => {
        try {
          await settingsService.updateUserSettings({ theme: newMode });
        } catch (error) {
          console.error('Failed to save toggled theme:', error);
        }
      })();

      return newMode;
    });
  }, []);

  // Memoize theme object to ensure it changes when themeMode changes
  const currentTheme = useMemo(
    () => themeMode === 'dark' ? createDarkTheme() : createLightTheme(),
    [themeMode]
  );

  return {
    theme: currentTheme,
    themeMode,
    isLoading,
    setThemeMode,
    toggleTheme,
  };
}
