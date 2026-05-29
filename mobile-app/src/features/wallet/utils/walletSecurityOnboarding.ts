import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { settingsService } from '../../../services';
import { googleDriveBackupService } from '../../../services/googleDriveBackupService';
import { getCachedAddress } from '../../../services/lightningAddressService';

const WALLET_SECURITY_ONBOARDING_KEY = '@zap_arc/wallet_security_onboarding_v1';
const WALLET_SECURITY_BANNER_DISMISSED_KEY = '@zap_arc/wallet_security_banner_dismissed_v1';
const BIOMETRIC_BANNER_DISMISSED_KEY = '@zap_arc/wallet_biometric_banner_dismissed_v1';
const NOTIFICATIONS_BANNER_DISMISSED_KEY = '@zap_arc/wallet_notifications_banner_dismissed_v1';

// --- Engagement-paced banners (cloud backup + lightning address) ---------
//
// These two are NOT shown on first launch. We pace them so a brand-new
// user works through the security-critical banners (biometric +
// notifications) first and gets to actually USE the wallet before we
// surface the "nice to have" / "protect your funds" nudges. All gating
// uses local-only signals (AsyncStorage timestamps + locally-cached
// backup fingerprint + locally-cached lightning address) so this check
// never makes a network call and never blocks the home screen.
const FIRST_SEEN_AT_KEY = '@zap_arc/wallet_banners_first_seen_at_v1';
const CLOUD_BACKUP_SNOOZED_UNTIL_KEY = '@zap_arc/wallet_cloud_backup_snoozed_until_v1';
const LIGHTNING_ADDRESS_BANNER_DISMISSED_KEY = '@zap_arc/wallet_lightning_address_banner_dismissed_v1';
const LAST_PROMPT_RESOLVED_AT_KEY = '@zap_arc/wallet_last_noncritical_prompt_resolved_at_v1';

const DAY_MS = 24 * 60 * 60 * 1000;
// Grace from first launch before each non-critical banner is eligible.
const CLOUD_BACKUP_GRACE_MS = 1 * DAY_MS;      // high-stakes — nudge after day 1
const LIGHTNING_ADDRESS_GRACE_MS = 3 * DAY_MS; // convenience — no rush
// After any non-critical banner is dismissed/snoozed, the next one waits
// this long so they don't cascade in the same session.
const INTER_PROMPT_COOLDOWN_MS = 2 * DAY_MS;
// "Not now" on the high-stakes backup banner snoozes rather than kills.
const CLOUD_BACKUP_SNOOZE_MS = 7 * DAY_MS;

export type SecurityReminderKind =
  | 'biometric'
  | 'notifications'
  | 'cloud-backup'
  | 'lightning-address'
  | null;

/** Context the home screen passes so the check stays self-contained. */
export interface SecurityReminderContext {
  /** Active master key id — used to look up this wallet's local backup fingerprint. */
  masterKeyId?: string | null;
}

async function readTimestamp(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Record (once) when the banner system first ran for this install, and
 * return that timestamp. Used as the anchor for the grace periods.
 */
async function getOrSetFirstSeenAt(now: number): Promise<number> {
  const existing = await readTimestamp(FIRST_SEEN_AT_KEY);
  if (existing !== null) return existing;
  try {
    await AsyncStorage.setItem(FIRST_SEEN_AT_KEY, String(now));
  } catch {
    // If the write fails we just treat `now` as the anchor for this run;
    // worst case the grace clock effectively restarts next launch.
  }
  return now;
}

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

// NOTE: A previous version of this file had `enableBiometricsIfNeeded`
// flip `biometricEnabled = true` directly in settings without storing
// the PIN to the OS keystore. That left the wallet in a poisoned state
// where the setting said "biometric on" but no PIN was bound to the
// keystore entry, which then caused every subsequent unlockWithBiometric
// to silently fail (returns null mnemonic ⇒ now counted as a failed PIN
// attempt by the security commit, eventually triggering PIN lockout).
//
// We've removed the broken path entirely. Biometric setup now happens
// exclusively through the home-screen banner ⇒ `useWalletAuth.enableBiometric`,
// which keeps the setting and the keystore PIN in lockstep. The
// onboarding alert still runs and asks the user to opt-in; the banner
// then surfaces on the next render after wallet creation if they did.

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

  // Biometric setup intentionally NOT triggered here — see the comment
  // block above `enableBiometricsIfNeeded` for the rationale. The home
  // banner picks it up immediately after wallet creation.
  await enableNotificationsIfNeeded();
  await setOnboardingState({ skipped: false });
}

/**
 * Decide which (if any) security banner to show on the home screen.
 * Only one is ever returned, in strict priority order:
 *   biometric → notifications → cloud-backup → lightning-address
 * The first eligible + non-suppressed kind wins; everything below waits.
 *
 * The two security-critical banners (biometric, notifications) appear
 * immediately. The two engagement-paced banners (cloud-backup,
 * lightning-address) only surface after a grace period from first launch
 * and are spaced apart by a cooldown, so a first-time user isn't piled on.
 */
export async function getActiveSecurityReminder(
  context: SecurityReminderContext = {}
): Promise<SecurityReminderKind> {
  // Legacy blanket dismissal key (from older builds) still suppresses all.
  try {
    const dismissedAll = await AsyncStorage.getItem(WALLET_SECURITY_BANNER_DISMISSED_KEY);
    if (dismissedAll === '1') return null;
  } catch {
    // fall through
  }

  const settings = await settingsService.getUserSettings();
  // Anchor for the engagement-paced grace periods. Cheap stamp-once.
  const now = Date.now();
  const firstSeenAt = await getOrSetFirstSeenAt(now);

  // 1) Biometric banner — highest priority when the device can do it.
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

  // 2) Notifications banner — shown next, only once biometric is resolved.
  // Check the OS-level permission rather than just the internal setting:
  // the internal `notificationsEnabled` defaults to true (user wants them on),
  // but on a fresh install the OS permission is still 'undetermined'. Showing
  // the banner based on the internal flag alone means it would never appear.
  let osGranted = false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    osGranted = status === 'granted';
  } catch {
    osGranted = false;
  }

  if (!osGranted || !settings.notificationsEnabled) {
    try {
      const dismissed = await AsyncStorage.getItem(NOTIFICATIONS_BANNER_DISMISSED_KEY);
      if (dismissed !== '1') return 'notifications';
    } catch {
      return 'notifications';
    }
  }

  // --- Engagement-paced banners below this line ---------------------------
  // Shared cooldown: after any non-critical banner was dismissed/snoozed,
  // hold the next one back so they don't appear in the same session.
  const lastResolvedAt = await readTimestamp(LAST_PROMPT_RESOLVED_AT_KEY);
  const cooldownActive =
    lastResolvedAt !== null && now - lastResolvedAt < INTER_PROMPT_COOLDOWN_MS;

  // 3) Cloud-backup banner — high-stakes (losing the seed = losing funds),
  // so it leads the non-critical group with a short grace and re-shows
  // after a snooze until a backup actually exists for this wallet.
  const backupGraceElapsed = now - firstSeenAt >= CLOUD_BACKUP_GRACE_MS;
  if (backupGraceElapsed && !cooldownActive) {
    const alreadyBackedUp = await hasLocalCloudBackup(context.masterKeyId);
    if (!alreadyBackedUp) {
      const snoozedUntil = await readTimestamp(CLOUD_BACKUP_SNOOZED_UNTIL_KEY);
      const snoozeActive = snoozedUntil !== null && now < snoozedUntil;
      if (!snoozeActive) return 'cloud-backup';
    }
  }

  // 4) Lightning-address banner — pure convenience, longest grace, and a
  // permanent dismiss (the user can always set one up in Settings).
  const lnGraceElapsed = now - firstSeenAt >= LIGHTNING_ADDRESS_GRACE_MS;
  if (lnGraceElapsed && !cooldownActive) {
    let hasAddress = false;
    try {
      const cached = await getCachedAddress();
      hasAddress = !!cached?.lightningAddress;
    } catch {
      hasAddress = false;
    }
    if (!hasAddress) {
      try {
        const dismissed = await AsyncStorage.getItem(LIGHTNING_ADDRESS_BANNER_DISMISSED_KEY);
        if (dismissed !== '1') return 'lightning-address';
      } catch {
        return 'lightning-address';
      }
    }
  }

  return null;
}

/**
 * Local, no-network check for whether this wallet has ever been backed up
 * to cloud. `createBackup` writes a per-wallet fingerprint to SecureStore
 * on success, so its presence is a reliable offline proxy. Falls back to
 * the Google connection state if we have no master key id to key on.
 */
async function hasLocalCloudBackup(masterKeyId?: string | null): Promise<boolean> {
  try {
    if (masterKeyId) {
      const fingerprint = await googleDriveBackupService.getLocalFingerprint(masterKeyId);
      if (fingerprint) return true;
    }
    // Even without a per-wallet fingerprint, a connected Google account
    // means the user has engaged with backup — don't nag in that case.
    return await googleDriveBackupService.isConnected();
  } catch {
    // On any read error, fail toward NOT nagging — a stuck banner that
    // can't verify state is worse UX than a missed prompt.
    return true;
  }
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

/** Stamp the shared inter-prompt cooldown so the next non-critical banner waits. */
async function stampNonCriticalResolved(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PROMPT_RESOLVED_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * "Not now" on the cloud-backup banner. High-stakes, so this SNOOZES for
 * a week rather than dismissing forever — it'll re-surface until a backup
 * actually exists. Also stamps the shared cooldown so the lightning-address
 * banner doesn't immediately take its place.
 */
export async function snoozeCloudBackupBanner(): Promise<void> {
  try {
    const until = Date.now() + CLOUD_BACKUP_SNOOZE_MS;
    await AsyncStorage.setItem(CLOUD_BACKUP_SNOOZED_UNTIL_KEY, String(until));
  } catch {
    // ignore
  }
  await stampNonCriticalResolved();
}

/**
 * "Not now" on the lightning-address banner. Convenience-only, so this is
 * a permanent dismiss (matching biometric/notifications). Also stamps the
 * shared cooldown.
 */
export async function dismissLightningAddressBanner(): Promise<void> {
  try {
    await AsyncStorage.setItem(LIGHTNING_ADDRESS_BANNER_DISMISSED_KEY, '1');
  } catch {
    // ignore
  }
  await stampNonCriticalResolved();
}
