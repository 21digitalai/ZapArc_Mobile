// Security Settings Screen
// Configure biometric authentication (fingerprint/Face ID)

import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Text, Switch, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSettings } from '../../../../hooks/useSettings';
import { useWalletAuth } from '../../../../hooks/useWalletAuth';
import { useLanguage } from '../../../../hooks/useLanguage';
import { useAppTheme } from '../../../../contexts/ThemeContext';
import { getGradientColors, getPrimaryTextColor, getSecondaryTextColor, BRAND_COLOR } from '../../../../utils/theme-helpers';
import { PinLockoutBanner } from '../../components/PinLockoutBanner';
import { createSafeBackHandler } from '../../utils/safeBack';

// =============================================================================
// Component
// =============================================================================

export function SecuritySettingsScreen(): React.JSX.Element {
  const safeBack = useMemo(() => createSafeBackHandler({ canGoBack: () => router.canGoBack(), back: () => router.back(), replace: (route) => router.replace(route) }, '/wallet/settings'), []);
  const { settings } = useSettings();
  const { enableBiometric, disableBiometric } = useWalletAuth();
  const { t } = useLanguage();
  const { themeMode } = useAppTheme();

  // Get theme colors
  const gradientColors = getGradientColors(themeMode);
  const primaryText = getPrimaryTextColor(themeMode);
  const secondaryText = getSecondaryTextColor(themeMode);

  // State
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string>('Biometric');

  // Check biometric availability
  useEffect(() => {
    const checkBiometric = async (): Promise<void> => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(compatible && enrolled);

        if (compatible) {
          const types =
            await LocalAuthentication.supportedAuthenticationTypesAsync();
          const hasFace = types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
          );
          const hasFingerprint = types.includes(
            LocalAuthentication.AuthenticationType.FINGERPRINT
          );

          if (Platform.OS === 'ios') {
            // iOS: Face ID or Touch ID — one or the other
            setBiometricType(hasFace ? 'Face ID' : 'Fingerprint');
          } else {
            // Android: supportedAuthenticationTypesAsync reports HARDWARE
            // capability, not what's enrolled, and many phones report both
            // even when only a fingerprint is enrolled. Android face unlock
            // is also typically not usable for app-level prompts, so prefer
            // fingerprint when the hardware lists it.
            if (hasFingerprint) {
              setBiometricType('Fingerprint');
            } else if (hasFace) {
              setBiometricType('Face ID');
            }
          }
        }
      } catch (err) {
        console.error('Failed to check biometric:', err);
      }
    };

    checkBiometric();
  }, []);

  // Load settings on mount
  useEffect(() => {
    if (settings) {
      setBiometricEnabled(settings.biometricEnabled || false);
    }
  }, [settings]);

  // Get biometric icon
  const getBiometricIcon = (): string => {
    if (biometricType === 'Face ID') {
      return 'face-recognition';
    }
    return 'fingerprint';
  };

  // Handle biometric toggle.
  //
  // IMPORTANT: we do NOT just flip the `biometricEnabled` setting here — that
  // leaves the keystore without a bound PIN and causes unlockWithBiometric to
  // fail on the next session (which then auto-disables the setting, making it
  // look like the toggle "doesn't persist"). Instead we go through the
  // useWalletAuth hook actions which store/clear the PIN in SecureStore AND
  // flip the setting in lockstep.
  const handleBiometricToggle = async (enabled: boolean): Promise<void> => {
    // Optimistic flip for snappy UI — reverted on failure.
    setBiometricEnabled(enabled);

    try {
      if (enabled) {
        const result = await enableBiometric();
        if (!result.ok) {
          setBiometricEnabled(false);
          // Surface the specific reason returned by useWalletAuth so the
          // user knows whether to set up biometrics in system settings,
          // re-unlock their wallet, retry the OS prompt, etc. — not just
          // a generic "verification failed".
          Alert.alert(
            t('settings.failed'),
            result.reason ?? t('settings.biometricVerificationFailed'),
          );
          return;
        }
      } else {
        const result = await disableBiometric();
        if (!result.ok) {
          setBiometricEnabled(true);
          Alert.alert(
            t('common.error'),
            result.reason ?? t('settings.failedToSaveSettings'),
          );
          return;
        }
      }
      console.log(`🔐 [SecuritySettings] Biometric ${enabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      console.error('❌ [SecuritySettings] Failed to toggle biometric:', err);
      const detail = err instanceof Error ? err.message : String(err);
      Alert.alert(t('common.error'), detail || t('settings.failedToSaveSettings'));
      setBiometricEnabled(!enabled);
    }
  };

  // handleSave removed (saving immediately now)

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
            iconColor={primaryText}
            size={24}
            onPress={safeBack}
          />
          <Text style={[styles.headerTitle, { color: primaryText }]}>
            {t('settings.biometricAuth')}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.scrollView}>
          <View style={styles.content}>
            {/* If the user has hit the PIN lockout threshold elsewhere
                (e.g. failed unlock attempts), surface that here so they
                don't think the biometric toggle is just "broken". */}
            <PinLockoutBanner />

            {/* Biometric Authentication */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <IconButton
                  icon={getBiometricIcon()}
                  iconColor={BRAND_COLOR}
                  size={28}
                  style={styles.sectionIcon}
                />
                <Text style={[styles.sectionTitle, { color: primaryText }]}>
                  {biometricType === 'Fingerprint' ? t('settings.fingerprintUnlock') : biometricType === 'Biometric' ? t('settings.biometricUnlock') : t('settings.faceIdUnlock')}
                </Text>
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchContent}>
                  <Text style={[styles.switchDescription, { color: secondaryText }]}>
                    {biometricAvailable
                      ? t('settings.useBiometricToUnlock', { type: biometricType })
                      : t('settings.notAvailableOnDevice')}
                  </Text>
                </View>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  disabled={!biometricAvailable}
                  color={BRAND_COLOR}
                />
              </View>

              {!biometricAvailable && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    ⚠️ {t('settings.biometricNotEnrolled')}
                  </Text>
                </View>
              )}
            </View>

            {/* Info Box */}
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>{t('settings.securityTips')}</Text>
              <Text style={[styles.infoText, { color: secondaryText }]}>
                • {t('settings.securityTip1')}{'\n'}
                • {t('settings.securityTip2')}{'\n'}
                • {t('settings.securityTip4')}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Footer spacer */}
        <View style={styles.bottomSpacer} />
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
    color: '#FFFFFF',
  },
  headerSpacer: {
    width: 48,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionIcon: {
    margin: 0,
    marginRight: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 16,
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  radioLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 8,
  },
  warningBox: {
    backgroundColor: 'rgba(255, 152, 0, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  warningText: {
    fontSize: 13,
    color: BRAND_COLOR,
    lineHeight: 18,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchContent: {
    flex: 1,
    marginRight: 16,
  },
  switchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  switchDescription: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  infoBox: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_COLOR,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND_COLOR,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 20,
  },
  footer: {
    padding: 16,
  },
  saveButton: {
    backgroundColor: BRAND_COLOR,
    borderRadius: 12,
  },
  saveButtonLabel: {
    color: '#1a1a2e',
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 32,
  },
});
