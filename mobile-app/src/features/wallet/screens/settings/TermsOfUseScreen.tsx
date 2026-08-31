import React, { useCallback, useMemo } from 'react';
import { BackHandler, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { getTermsCopy } from '../../../../legal/termsOfUse';
import { BRAND_COLOR, getGradientColors, getPrimaryTextColor, getSecondaryTextColor } from '../../../../utils/theme-helpers';
import { createSafeBackHandler } from '../../utils/safeBack';

const SUPPORT_EMAIL = '21digitalai+support@gmail.com';

export function TermsOfUseScreen(): React.JSX.Element {
  const safeBack = useMemo(() => createSafeBackHandler({ canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route) }, '/wallet/settings'), []);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', safeBack);
    return () => subscription.remove();
  }, [safeBack]));

  const { themeMode } = useAppTheme();
  const copy = getTermsCopy();
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  return (
    <LinearGradient colors={getGradientColors(themeMode)} style={styles.gradient}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <IconButton icon="arrow-left" iconColor={primaryTextColor} size={24} onPress={safeBack} />
          <Text style={[styles.headerTitle, { color: primaryTextColor }]}>{copy.title}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.effectiveDate, { color: secondaryTextColor }]}>{copy.effectiveDate}</Text>
          <Text style={[styles.paragraph, { color: primaryTextColor }]}>{copy.introduction}</Text>
          {copy.sections.map((section) => (
            <View key={section.title} style={[styles.section, section.important && styles.importantSection]}>
              <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>{section.title}</Text>
              {section.paragraphs.map((paragraph) => (
                <Text key={paragraph} style={[styles.paragraph, { color: secondaryTextColor }]}>{paragraph}</Text>
              ))}
            </View>
          ))}
          <Text
            accessibilityRole="link"
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            style={styles.contact}
          >
            {copy.contact}
          </Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  headerSpacer: { width: 48 },
  content: { padding: 16, paddingBottom: 48 },
  effectiveDate: { fontSize: 13, marginBottom: 16 },
  section: { marginTop: 14, padding: 16, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  importantSection: { borderWidth: 1, borderColor: 'rgba(245,166,35,0.45)' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  paragraph: { fontSize: 14, lineHeight: 21, marginBottom: 10 },
  contact: { color: BRAND_COLOR, fontSize: 14, fontWeight: '600', marginTop: 22 },
});
