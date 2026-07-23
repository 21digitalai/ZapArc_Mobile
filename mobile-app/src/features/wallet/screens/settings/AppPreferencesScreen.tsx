// Theme Settings Screen
// Configure app theme and display preferences

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, List, Switch, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { createSafeBackHandler } from '../../utils/safeBack';

const safeBack = createSafeBackHandler({ canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route) }, '/wallet/settings');
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { useLanguage } from '../../../../hooks/useLanguage';
import {
  getBorderColor,
  getCardBackgroundColor,
  getGradientColors,
  BRAND_COLOR,
} from '../../../../utils/theme-helpers';

// =============================================================================
// Component
// =============================================================================

export function ThemeSettingsScreen(): React.JSX.Element {
  const { themeMode, toggleTheme, theme } = useAppTheme();
  const { t } = useLanguage();

  // Dynamic gradient colors based on theme
  const gradientColors = getGradientColors(themeMode);
  const cardBackgroundColor = getCardBackgroundColor(themeMode);
  const borderColor = getBorderColor(themeMode);

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={theme.colors.onBackground}
            size={24}
            onPress={safeBack}
          />
          <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>
            {t('settings.theme')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.scrollView}>
          <View style={styles.settingsList}>
            {/* Dark Mode Toggle */}
            <List.Item
              title={t('settings.darkMode')}
              description={t('settings.useDarkTheme')}
              left={(props) => (
                <List.Icon {...props} icon="theme-light-dark" color={BRAND_COLOR} />
              )}
              right={() => (
                <Switch
                  value={themeMode === 'dark'}
                  onValueChange={toggleTheme}
                  color={BRAND_COLOR}
                />
              )}
              titleStyle={[styles.listTitle, { color: theme.colors.onSurface }]}
              descriptionStyle={[styles.listDescription, { color: theme.colors.onSurfaceVariant }]}
              style={[styles.listItem, { backgroundColor: cardBackgroundColor, borderColor }]}
            />
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    // Color is dynamic, set inline
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  settingsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    // Color is dynamic, set inline
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  listItem: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 1,
  },
  listTitle: {
    // Color is dynamic, set inline
    fontSize: 16,
  },
  listDescription: {
    // Color is dynamic, set inline
    fontSize: 13,
  },
  bottomSpacer: {
    height: 40,
  },
});
