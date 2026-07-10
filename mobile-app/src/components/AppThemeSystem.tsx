import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '../contexts/ThemeContext';
import {
  getNavigationBarColor,
  getStatusBarStyle,
} from '../utils/theme-helpers';

export function AppThemeSystem(): React.JSX.Element {
  const { themeMode } = useAppTheme();

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    NavigationBar.setBackgroundColorAsync(getNavigationBarColor(themeMode)).catch((error) => {
      if (__DEV__) console.warn('Failed to update navigation bar theme:', error);
    });
    NavigationBar.setButtonStyleAsync(themeMode === 'dark' ? 'light' : 'dark').catch((error) => {
      if (__DEV__) console.warn('Failed to update navigation bar buttons:', error);
    });
  }, [themeMode]);

  return (
    <StatusBar
      style={getStatusBarStyle(themeMode)}
      translucent
      backgroundColor="transparent"
    />
  );
}
