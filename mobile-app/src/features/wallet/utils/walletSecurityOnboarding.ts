import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { settingsService } from '../../../services';

const WALLET_SECURITY_ONBOARDING_KEY = '@zap_arc/wallet_security_onboarding_v1';
const WALLET_SECURITY_BANNER_DISMISSED_KEY = '@zap_arc/wallet_security_banner_dismissed_v1';
const BIOMETRIC_BANNER_DISMISSED_KEY = '@zap_arc/wallet_biometric_banner_dismissed_v1';
const NOTIFICATIONS_BANNER_DISMISSED_KEY = '@zap_arc/wallet_notifications_banner_dismissed_v1';

export type SecurityReminderKind = 'biometric' | 'notifications' | null;

type WalletSecurityContext = 'create' | 'restore';

interface OnboardingState {
  skipped: boolean;
}

async function getOnboardingState(): Promise<OnboardingState | null> {
  try {
    const value = await AsyncStorage.getItem(WALLET_SECURITY_ONBOARDING_KEY);
    return value ? (JSON.parse(value) as OnboardingState) : null;
  } catch {
    return null;
  }
}

async function setOnboardingState(state: OnboardingState): Promise<void> {
  await AsyncStorage.setItem(WALLET_SECURITY_ONBOARDING_KEY, JSON.stringify(state));
}

function askContinue(context: WalletSecurityContext): Promise<boolean> {
  const title = context === 'restore' ? 'Secure your restored wallet' : 'Protect your wallet';
  const message =
    context === 'restore'
      ? 'Enable biometric unlock and payment alerts to secure your restored wallet and stay on top of incoming transactions.'
      : 'Enable biometric unlock and payment alerts for stronger security and instant payment updates.';

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]);
  });
}

async function enableBiometricsIfNeeded(): Promise<void> {
  const settings = await settingsService.getUserSettings();
  if (settings.biometricEnabled) return;

  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!hasHardware || !isEnrolled) return;

  const authResult = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Enable biometric unlock',
    cancelLabel: 'Skip',
  });

  if (authResult.success) {
    await settingsService.updateUserSettings({ biometricEnabled: true });
  }
}

export async function enableNotificationsIfNeeded(): Promise<void> {
  const settings = await settingsService.getUserSettings();
  const { status } = await Notifications.getPermissionsAsync();

  if (status === 'granted') {
    if (!settings.notificationsEnabled || !settings.notifyPaymentReceived) {
      await settingsService.updateUserSettings({
        notificationsEnabled: true,
        notifyPaymentReceived: true,
      });
    }
    return;
  }

  const requested = await Notifications.requestPermissionsAsync();
  await settingsService.updateUserSettings({
    notificationsEnabled: requested.status === 'granted',
    notifyPaymentReceived: requested.status === 'granted',
  });
}

export async function runWalletSecurityOnboarding(
  context: WalletSecurityContext,
  options: { force?: boolean } = {}
): Promise<void> {
  const existingState = await getOnboardingState();
  if (existingState && !options.force) return;

  const shouldContinue = await askContinue(context);
  if (!shouldContinue) {
    await setOnboardingState({ skipped: true });
    return;
  }

  await enableBiometricsIfNeeded();
  await enableNotificationsIfNeeded();
  await setOnboardingState({ skipped: false });
}

/**
 * Decide which (if any) security banner to show on the home screen.
 * Only one is ever returned — biometric has priority. Once biometric is
 * enabled or explicitly dismissed, the notifications banner takes over.
 */
export async function getActiveSecurityReminder(): Promise<SecurityReminderKind> {
  // Legacy blanket dismissal key (from older builds) still suppresses both.
  try {
    const dismissedAll = await AsyncStorage.getItem(WALLET_SECURITY_BANNER_DISMISSED_KEY);
    if (dismissedAll === '1') return null;
  } catch {
    // fall through
  }

  const settings = await settingsService.getUserSettings();

  // Biometric banner — highest priority when the device can do it.
  let biometricPossible = false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    biometricPossible = hasHardware && isEnrolled;
  } catch {
    biometricPossible = false;
  }

  if (biometricPossible && !settings.biometricEnabled) {
    try {
      const dismissed = await AsyncStorage.getItem(BIOMETRIC_BANNER_DISMISSED_KEY);
      if (dismissed !== '1') return 'biometric';
    } catch {
      return 'biometric';
    }
  }

  // Notifications banner — shown next, only once biometric is resolved.
  if (!settings.notificationsEnabled) {
    try {
      const dismissed = await AsyncStorage.getItem(NOTIFICATIONS_BANNER_DISMISSED_KEY);
      if (dismissed !== '1') return 'notifications';
    } catch {
      return 'notifications';
    }
  }

  return null;
}

export async function dismissBiometricBanner(): Promise<void> {
  try {
    await AsyncStorage.setItem(BIOMETRIC_BANNER_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}

export async function dismissNotificationsBanner(): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIFICATIONS_BANNER_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
}
