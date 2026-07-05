import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { useKeyboardAwareScroll } from '../../../../hooks/useKeyboardAwareScroll';
import { Text, IconButton, List, TextInput, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguage } from '../../../../hooks/useLanguage';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { getGradientColors, getPrimaryTextColor, getSecondaryTextColor, BRAND_COLOR } from '../../../../utils/theme-helpers';
import { settingsService } from '../../../../services/settingsService';

export function SwapSettingsScreen(): React.JSX.Element {
  const { t } = useLanguage();
  const { themeMode } = useAppTheme();

  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  const [slippageInput, setSlippageInput] = useState('50');
  // Manual cross-platform keyboard avoidance (see useKeyboardAwareScroll).
  const kb = useKeyboardAwareScroll();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const settings = await settingsService.getSwapSettings();
      setSlippageInput(String(settings.slippageBps));
    };

    load().catch((error) => {
      console.error('❌ [SwapSettings] Failed to load swap settings:', error);
    });
  }, []);

  const handleSave = async (): Promise<void> => {
    const parsed = Number(slippageInput);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
      Alert.alert(t('common.error'), `${t('swap.slippageCustomLabel')}: 1-1000`);
      return;
    }

    try {
      setIsSaving(true);
      const updated = await settingsService.updateSwapSettings({
        slippageBps: Math.round(parsed),
      });
      setSlippageInput(String(updated.slippageBps));
      Alert.alert(t('common.success'), t('settings.saved'));
    } catch (error) {
      console.error('❌ [SwapSettings] Failed to save swap settings:', error);
      Alert.alert(t('common.error'), t('settings.failedToSaveSettings'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <LinearGradient colors={gradientColors} style={styles.gradient}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={primaryTextColor}
            size={24}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{t('swap.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={kb.scrollRef}
          style={styles.scrollView}
          contentContainerStyle={kb.contentPadding}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={kb.onScroll}
        >
          <View style={styles.section}>
            <List.Item
              title={t('swap.slippage')}
              description={t('swap.review.slippage')}
              left={(props) => <List.Icon {...props} icon="swap-horizontal" color={BRAND_COLOR} />}
              titleStyle={[styles.listTitle, { color: primaryTextColor }]}
              descriptionStyle={[styles.listDescription, { color: secondaryTextColor }]}
              style={styles.listItem}
            />

            <TextInput
              mode="outlined"
              label={t('swap.slippageCustomLabel')}
              value={slippageInput}
              onChangeText={(value) => setSlippageInput(value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="1 - 1000"
              style={styles.input}
              outlineColor="rgba(255,255,255,0.2)"
              activeOutlineColor={BRAND_COLOR}
              textColor={primaryTextColor}
            />

            <Text style={[styles.helperText, { color: secondaryTextColor }]}>1 - 1000 bps (default: 50)</Text>

            <Button
              mode="contained"
              onPress={handleSave}
              loading={isSaving}
              disabled={isSaving}
              style={styles.saveButton}
              buttonColor={BRAND_COLOR}
            >
              {t('common.save')}
            </Button>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
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
    color: '#FFFFFF',
  },
  headerSpacer: { width: 48 },
  scrollView: { flex: 1 },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    margin: 16,
  },
  listItem: { paddingHorizontal: 0 },
  listTitle: { fontSize: 16, fontWeight: '600' },
  listDescription: { fontSize: 13 },
  input: { marginTop: 8, backgroundColor: 'transparent' },
  helperText: { marginTop: 8, fontSize: 12 },
  saveButton: { marginTop: 16, borderRadius: 8 },
  bottomSpacer: { height: 24 },
});
