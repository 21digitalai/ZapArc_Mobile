import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, RadioButton, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSettings } from '../../../../hooks/useSettings';
import { useLanguage } from '../../../../hooks/useLanguage';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { BRAND_COLOR, getGradientColors, getPrimaryTextColor, getSecondaryTextColor } from '../../../../utils/theme-helpers';
import { createSafeBackHandler } from '../../utils/safeBack';
import {
  customMinutesToExpirySecs,
  INVOICE_EXPIRY_PRESETS,
  isInvoiceExpiryPreset,
} from './invoiceExpiry';

function formatExpiry(seconds: number, t: (key: string) => string): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} ${t(seconds === 86400 ? 'settings.day' : 'settings.days')}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} ${t(seconds === 3600 ? 'settings.hour' : 'settings.hours')}`;
  return `${seconds / 60} ${t(seconds === 60 ? 'settings.minute' : 'settings.minutes')}`;
}

export function InvoiceExpirySettingsScreen(): React.JSX.Element {
  const safeBack = useMemo(() => createSafeBackHandler({ canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route) }, '/wallet/settings'), []);
  useFocusEffect(React.useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', safeBack);
    return () => subscription.remove();
  }, [safeBack]));
  const { settings, updateSettings } = useSettings();
  const { t } = useLanguage();
  const { themeMode } = useAppTheme();
  const [selected, setSelected] = useState('3600');
  const [customMinutes, setCustomMinutes] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const seconds = settings?.invoiceExpirySecs || 3600;
    setSelected(isInvoiceExpiryPreset(seconds) ? String(seconds) : 'custom');
    if (!isInvoiceExpiryPreset(seconds)) setCustomMinutes(String(Math.round(seconds / 60)));
  }, [settings]);
  const save = async (value: string) => {
    let seconds = Number(value);
    if (value === 'custom') seconds = customMinutesToExpirySecs(customMinutes) || NaN;
    if (!Number.isFinite(seconds)) {
      setError(t('settings.invoiceExpiryInvalid'));
      return;
    }
    setError('');
    setSelected(value);
    await updateSettings({ invoiceExpirySecs: seconds });
  };
  const primary = getPrimaryTextColor(themeMode);
  const secondary = getSecondaryTextColor(themeMode);
  return <LinearGradient colors={getGradientColors(themeMode)} style={styles.gradient}><SafeAreaView style={styles.container}>
    <View style={styles.header}><IconButton icon="arrow-left" iconColor={primary} onPress={safeBack} /><Text style={[styles.title, { color: primary }]}>{t('settings.invoiceExpiry')}</Text><View style={styles.spacer} /></View>
    <ScrollView contentContainerStyle={styles.content}><Text style={[styles.description, { color: secondary }]}>{t('settings.invoiceExpiryDescription')}</Text>
      <RadioButton.Group value={selected} onValueChange={save}>{INVOICE_EXPIRY_PRESETS.map((seconds) => <View key={seconds} style={styles.option}><RadioButton.Android value={String(seconds)} color={BRAND_COLOR} uncheckedColor={secondary} /><Text style={[styles.optionText, { color: primary }]}>{formatExpiry(seconds, t)}</Text></View>)}
        <View style={styles.option}><RadioButton.Android value="custom" color={BRAND_COLOR} uncheckedColor={secondary} onPress={() => setSelected('custom')} /><Text style={[styles.optionText, { color: primary }]}>{t('settings.custom')}</Text></View>
      </RadioButton.Group>
      {selected === 'custom' && <TextInput mode="outlined" label={t('settings.customMinutes')} value={customMinutes} onChangeText={setCustomMinutes} onBlur={() => save('custom')} keyboardType="number-pad" error={!!error} />}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  </SafeAreaView></LinearGradient>;
}

const styles = StyleSheet.create({ gradient: { flex: 1 }, container: { flex: 1 }, header: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 8 }, title: { fontSize: 20, fontWeight: '700' }, spacer: { width: 48 }, content: { padding: 20 }, description: { fontSize: 15, marginBottom: 20 }, option: { alignItems: 'center', flexDirection: 'row', minHeight: 52 }, optionText: { fontSize: 16 }, error: { color: '#ef4444', marginTop: 8 } });
