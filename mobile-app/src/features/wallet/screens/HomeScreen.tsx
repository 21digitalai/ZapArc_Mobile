// Home/Balance Screen
// Main wallet dashboard with balance, recent transactions, and quick actions

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  BackHandler,
  Linking,
  Platform,
  ToastAndroid,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text, IconButton, ActivityIndicator, Button, Divider } from 'react-native-paper';
import { ToastBanner, type ToastTone } from '../components/ToastBanner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../../contexts/ThemeContext';
import { getGradientColors, getPrimaryTextColor, getSecondaryTextColor, getIconColor, BRAND_COLOR } from '../../../utils/theme-helpers';
import { useWallet } from '../../../hooks/useWallet';
import { useWalletAuth } from '../../../hooks/useWalletAuth';
import { useLanguage } from '../../../hooks/useLanguage';
import { useCurrency } from '../../../hooks/useCurrency';
import { useLightningAddress } from '../../../hooks/useLightningAddress';
import { getPayment, onPaymentReceived } from '../../../services/breezSparkService';
import { settingsService } from '../../../services/settingsService';
import { SWAP_FEATURE_ENABLED, MULTI_ASSET_UI_ENABLED } from '../../../config/features';
import { formatFiat, usdbToFiat } from '../../../utils/currency';
import { SaveContactPrompt } from '../../addressBook';
import { AssetSelectorPill } from '../components/AssetSelectorPill';
import { AssetPickerSheet } from '../components/AssetPickerSheet';
import { getAssetMeta } from '../registry/assetRegistry';
import type { Transaction } from '../types';
import { buildTransactionRows, type TransactionRow } from '../utils/transactionRows';
import {
  enableNotificationsIfNeeded,
  getActiveSecurityReminder,
  dismissBiometricBanner,
  dismissNotificationsBanner,
  snoozeCloudBackupBanner,
  dismissLightningAddressBanner,
  type SecurityReminderKind,
} from '../utils/walletSecurityOnboarding';

// =============================================================================
// Types
// =============================================================================

interface QuickActionProps {
  icon: string;
  label: string;
  onPress: () => void;
  color?: string;
}

type WalletAsset = 'BTC' | 'USDB';

type PendingOutgoing = Pick<Transaction, 'id' | 'amount'>;

const INLINE_PENDING_ROW_HEIGHT = 58;
const INLINE_PENDING_MOTION_MS = 220;

function getPendingLabel(payments: PendingOutgoing[]): string {
  const amounts = payments.map((payment) => payment.amount);
  const hasCompleteAmounts = amounts.length > 0 && amounts.every(
    (amount) => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0,
  );
  if (hasCompleteAmounts) {
    const total = amounts.reduce((sum, amount) => sum + (amount as number), 0);
    return `⏳ Pending • ${total.toLocaleString()} sats`;
  }
  return payments.length > 1 ? `⏳ ${payments.length} payments pending` : '⏳ Pending';
}

function PendingBalanceRow({
  payments,
  exitingPaymentId,
  onPress,
}: {
  payments: PendingOutgoing[];
  exitingPaymentId: string | null;
  onPress: () => void;
}): React.JSX.Element | null {
  const pendingLabel = getPendingLabel(payments);
  const signature = payments.map((payment) => payment.id).sort().join('|');
  const lastSignatureRef = useRef('');
  // Authoritative payments can be cleared before the visual exit completes.
  // Keep only their rendered label for that short exit, never the payment data.
  const lastVisibleLabelRef = useRef<string | null>(payments.length > 0 ? pendingLabel : null);
  const [mounted, setMounted] = useState(payments.length > 0);
  const [interactive, setInteractive] = useState(payments.length > 0);
  // Always mount collapsed. The signature effect expands after mount, so the
  // first authoritative pending payment has a real visible entry transition.
  const height = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const spacing = useRef(new Animated.Value(0)).current;
  const [motionPreference, setMotionPreference] = useState({ resolved: false, reduced: false });

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setMotionPreference({ resolved: true, reduced: enabled });
    });
    return () => { active = false; };
  }, []);

  const animate = useCallback((toValue: number, done?: () => void): void => {
    const config = {
      toValue,
      duration: motionPreference.reduced ? 100 : INLINE_PENDING_MOTION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    };
    Animated.parallel([
      Animated.timing(height, config),
      Animated.timing(opacity, config),
      Animated.timing(spacing, config),
    ]).start(({ finished }) => { if (finished && done) done(); });
  }, [height, motionPreference.reduced, opacity, spacing]);

  useEffect(() => {
    if (!motionPreference.resolved || !signature || signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;
    setMounted(true);
    setInteractive(true);
    animate(1);
  }, [animate, motionPreference.resolved, signature]);

  useEffect(() => {
    if (payments.length > 0) lastVisibleLabelRef.current = pendingLabel;
  }, [payments.length, pendingLabel]);

  useEffect(() => {
    if (!exitingPaymentId || !mounted) return;
    // The inline row represents the aggregate pending set. A terminal toast
    // for one payment must not collapse it while another payment is still
    // authoritatively pending.
    if (payments.some((payment) => payment.id !== exitingPaymentId)) return;
    setInteractive(false);
    animate(0, () => {
      lastSignatureRef.current = '';
      lastVisibleLabelRef.current = null;
      setMounted(false);
    });
  }, [animate, exitingPaymentId, mounted, payments]);

  if (!mounted) return null;
  const visibleLabel = payments.length > 0 ? pendingLabel : lastVisibleLabelRef.current ?? '⏳ Pending';
  return (
    <Animated.View style={{
      height: height.interpolate({ inputRange: [0, 1], outputRange: [0, INLINE_PENDING_ROW_HEIGHT] }),
      opacity,
      marginTop: spacing.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }),
      overflow: 'hidden',
    }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Pending payment"
        accessibilityState={{ disabled: !interactive }}
        disabled={!interactive}
        style={styles.pendingBalanceRow}
        onPress={onPress}
      >
        <Text style={styles.pendingBalanceTitle}>{visibleLabel}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// =============================================================================
// Component
// =============================================================================

export function HomeScreen(): React.JSX.Element {
  const {
    balance,
    transactions,
    usdbBalance,
    isLoading,
    isConnected,
    refreshBalance,
    refreshTransactions,
    getBalanceForAsset,
    getTransactionsForAsset,
    activeWalletInfo,
    loadWalletData,
  } = useWallet();
  const { lock, enableBiometric } = useWalletAuth();
  const { t } = useLanguage();
  const { format, formatTx, refreshSettings, rates, secondaryFiatCurrency } = useCurrency();
  const { addressInfo: lightningAddressInfo, isRegistered: isLightningAddressRegistered } = useLightningAddress();

  // Get navigation params (for payment success toast)
  const params = useLocalSearchParams<{
    paymentSuccess?: string;
    paymentAmount?: string;
    paymentId?: string;
    paymentPending?: string;
    asset?: string;
    swapSuccess?: string;
    swapAsset?: string;
    swapReceived?: string;
    /** Set by SwapScreen when a conversion is refunded (slippage too tight). */
    swapRefunded?: string;
    /** Set by PaymentConfirmationScreen / Send flow when a payment fails. */
    paymentError?: string;
    /** Set by wallet switch flow when user changes active wallet. */
    walletSwitched?: string;
    walletSwitchedName?: string;
    /** Set by the Send flow after paying a Lightning Address / LNURL that
     *  isn't saved yet — triggers the "save as contact?" prompt here. */
    saveContact?: string;
    /** Set by the Receive flow when a payment lands while the invoice page is
     *  open — shows the standard top "Payment received" toast here. */
    paymentReceived?: string;
    paymentReceivedSat?: string;
    paymentReceivedAsset?: string;
  }>();

  const { themeMode } = useAppTheme();
  const gradientColors = getGradientColors(themeMode);
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);
  const iconColor = getIconColor(themeMode);

  // State
  const [refreshing, setRefreshing] = useState(false);
  const [showBalance, setShowBalance] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  // When the tapped row is a swap pair, keep both sides so the detail modal
  // can show "paid X sats, received Y USDB" rather than just one leg.
  const [selectedSwapRow, setSelectedSwapRow] = useState<import('../utils/transactionRows').TransactionRow | null>(null);
  // Structured toast state — richer than a single string so the heads-up
  // banner can render an icon chip + subtitle + trailing amount pill.
  const [toast, setToast] = useState<{
    revision: number;
    title: string;
    subtitle?: string;
    trailing?: string;
    isPending?: boolean;
    icon?: string;
    tone?: ToastTone;
    position?: 'top' | 'bottom';
  } | null>(null);
  const toastRevisionRef = useRef(0);
  const pendingToastRef = useRef<{ paymentId: string; revision: number; shownAt: number } | null>(null);
  const pendingTerminalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep this in sync with ToastBanner's short exit timing. Terminal toast
  // lifetime begins only after the outgoing Pending shell has left the screen.
  const PENDING_EXIT_DURATION_MS = 220;
  const clearPendingTerminalTimer = useCallback((): void => {
    if (pendingTerminalTimerRef.current) {
      clearTimeout(pendingTerminalTimerRef.current);
      pendingTerminalTimerRef.current = null;
    }
  }, []);
  const showToast = useCallback(
    (next: { title: string; subtitle?: string; trailing?: string; icon?: string; tone?: ToastTone; position?: 'top' | 'bottom'; isPending?: boolean }) => {
      clearPendingTerminalTimer();
      pendingToastRef.current = null;
      toastRevisionRef.current += 1;
      setToast({ ...next, revision: toastRevisionRef.current });
    },
    [clearPendingTerminalTimer],
  );
  // Stable dismiss ref so ToastBanner's effect isn't reinvoked on every
  // HomeScreen re-render (which would restart the enter animation).
  const dismissToast = useCallback(() => setToast(null), []);
  const [activeReminder, setActiveReminder] = useState<SecurityReminderKind>(null);
  const [activeAsset, setActiveAsset] = useState<WalletAsset>('BTC');
  const [assetPickerVisible, setAssetPickerVisible] = useState(false);
  const notifiedPaymentStatesRef = useRef<Set<string>>(new Set());
  const [trackedPendingPayment, setTrackedPendingPayment] = useState<{
    id: string;
    amountSat: number;
  } | null>(null);
  const [pendingRowExitingPaymentId, setPendingRowExitingPaymentId] = useState<string | null>(null);

  useEffect(() => () => clearPendingTerminalTimer(), [clearPendingTerminalTimer]);

  const displayBalance = getBalanceForAsset(activeAsset);
  const displayTransactions = getTransactionsForAsset(activeAsset);
  const transactionRows = buildTransactionRows(displayTransactions, activeAsset);
  const pendingOutgoing = transactions.filter(
    (transaction) => transaction.type === 'send' && transaction.status === 'pending'
  );

  // A terminal handoff can arrive after a newer pending payment has already
  // replaced the aggregate row's contents. Never retain that older handoff:
  // once another payment remains, the next collapse must belong to that
  // remaining payment's own terminal toast.
  useEffect(() => {
    if (!pendingRowExitingPaymentId) return;
    if (pendingOutgoing.some((payment) => payment.id !== pendingRowExitingPaymentId)) {
      setPendingRowExitingPaymentId(null);
    }
  }, [pendingOutgoing, pendingRowExitingPaymentId]);
  const showUsdbEmptyState = activeAsset === 'USDB' && usdbBalance <= 0 && transactionRows.length === 0;

  // Decide which security banner (if any) to show above the balance.
  // Biometric has priority; notifications only takes over once biometric
  // is resolved (enabled, dismissed, or unavailable on this device).
  const refreshSecurityBanner = useCallback(async (): Promise<void> => {
    try {
      const next = await getActiveSecurityReminder({
        masterKeyId: activeWalletInfo?.masterKeyId,
      });
      setActiveReminder(next);
    } catch {
      setActiveReminder(null);
    }
  }, [activeWalletInfo?.masterKeyId]);

  useEffect(() => {
    void refreshSecurityBanner();
  }, [refreshSecurityBanner]);

  useEffect(() => {
    let mounted = true;
    void settingsService.getActiveAsset().then((stored) => {
      if (!mounted) return;
      // When multi-asset UI is off, coerce any persisted USDB selection back
      // to BTC so existing users aren't stuck on a now-hidden tab.
      const next: WalletAsset =
        !MULTI_ASSET_UI_ENABLED && stored === 'USDB' ? 'BTC' : stored;
      setActiveAsset(next);
      if (next !== stored) {
        void settingsService.setActiveAsset(next);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleEnableBiometric = useCallback(async (): Promise<void> => {
    // The banner tap IS the user's opt-in, so we skip any confirm alert.
    // If enableBiometric fails (cancelled OS prompt, missing session PIN,
    // hardware unavailable, keystore write failed, ...), surface the
    // actual reason via toast so the user knows what to fix instead of
    // tapping into a silent no-op. The banner re-derives state after.
    const result = await enableBiometric();
    if (!result.ok && result.reason) {
      showToast({
        title: t('settings.failed'),
        subtitle: result.reason,
        tone: 'danger',
      });
    }
    await refreshSecurityBanner();
  }, [enableBiometric, refreshSecurityBanner, showToast, t]);

  const handleDismissBiometric = useCallback((): void => {
    setActiveReminder(null);
    void dismissBiometricBanner().finally(() => {
      void refreshSecurityBanner();
    });
  }, [refreshSecurityBanner]);

  const handleEnableNotifications = useCallback(async (): Promise<void> => {
    await enableNotificationsIfNeeded();
    await refreshSecurityBanner();
  }, [refreshSecurityBanner]);

  const handleDismissNotifications = useCallback((): void => {
    setActiveReminder(null);
    void dismissNotificationsBanner().finally(() => {
      void refreshSecurityBanner();
    });
  }, [refreshSecurityBanner]);

  // Cloud-backup banner: tapping "Set up" routes to the Google Drive
  // backup settings. We hide the banner immediately for a snappy feel;
  // the next refresh re-derives state (it'll stay hidden if a backup now
  // exists, or re-surface after the snooze if the user backed out).
  const handleEnableCloudBackup = useCallback((): void => {
    setActiveReminder(null);
    router.push('/wallet/settings/google-drive-backup');
  }, []);

  const handleDismissCloudBackup = useCallback((): void => {
    setActiveReminder(null);
    void snoozeCloudBackupBanner().finally(() => {
      void refreshSecurityBanner();
    });
  }, [refreshSecurityBanner]);

  // Lightning-address banner: tapping "Claim" routes to the LN address
  // settings where the user generates username@breez.tips.
  const handleClaimLightningAddress = useCallback((): void => {
    setActiveReminder(null);
    router.push('/wallet/settings/lightning-address');
  }, []);

  const handleDismissLightningAddress = useCallback((): void => {
    setActiveReminder(null);
    void dismissLightningAddressBanner().finally(() => {
      void refreshSecurityBanner();
    });
  }, [refreshSecurityBanner]);

  // Currency formatting using the useCurrency hook
  const getFormattedBalance = (sats: number) => {
    return format(sats, { hideBalance: !showBalance });
  };

  // Debug: Log when balance changes
  useEffect(() => {
    console.log('💰 [HomeScreen] Balance prop changed to:', balance);
  }, [balance]);

  // Prevent Android back button from navigating back to welcome/create screens
  // Only active when HomeScreen is focused - allows normal back nav from other screens
  useFocusEffect(
    useCallback((): (() => void) => {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        // Return true to prevent default back behavior (going back to welcome/create)
        // The app will minimize instead
        return true;
      });

      return (): void => backHandler.remove();
    }, [])
  );

  // Refresh handler (for manual pull-to-refresh)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshBalance(), refreshTransactions()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshBalance, refreshTransactions]);

  const showOutgoingPaymentState = useCallback((payment: {
    id?: string;
    status: 'pending' | 'completed' | 'failed';
    amountSat?: number;
    asset?: 'BTC' | 'USDB';
    description?: string;
  }): void => {
    const key = `${payment.id || 'unknown'}:${payment.status}`;
    if (notifiedPaymentStatesRef.current.has(key)) return;
    notifiedPaymentStatesRef.current.add(key);

    const hasAmount = typeof payment.amountSat === 'number' && Number.isFinite(payment.amountSat);
    const amount = typeof payment.amountSat === 'number' && Number.isFinite(payment.amountSat)
      ? payment.amountSat
      : 0;
    const asset = payment.asset === 'USDB' ? 'USDB' : 'BTC';
    const formatted = asset === 'USDB'
      ? `${(amount / 1e6).toFixed(2)} USDB`
      : `${amount.toLocaleString()} sat`;

    const showTerminalToast = (): void => {
      if (payment.status === 'completed') {
        showToast({ icon: '↑', title: 'Payment sent', subtitle: payment.description || (asset === 'USDB' ? 'USDB' : 'Lightning'), trailing: `-${formatted}`, tone: 'accent' });
        return;
      }
      showToast({ icon: '✕', title: 'Payment failed — balance restored', subtitle: payment.description || 'Try again or contact support', tone: 'danger' });
    };

    if (payment.status === 'pending') {
      const pendingAmount = hasAmount ? `${amount.toLocaleString()} sats` : undefined;
      showToast({
        icon: '⏳',
        title: 'Payment pending',
        subtitle: pendingAmount ? `Payment pending with ${pendingAmount}` : (payment.description || 'Funds are temporarily reserved'),
        tone: 'warn',
        isPending: true,
      });
      if (payment.id) {
        pendingToastRef.current = {
          paymentId: payment.id,
          revision: toastRevisionRef.current,
          shownAt: Date.now(),
        };
      }
      return;
    }

    const pendingToast = payment.id && pendingToastRef.current?.paymentId === payment.id
      ? pendingToastRef.current
      : null;
    const remainingDwell = pendingToast ? Math.max(0, 2000 - (Date.now() - pendingToast.shownAt)) : 0;
    if (!pendingToast) {
      // The row can be rendered from an authoritative refresh even when Home
      // did not receive the original Pending event. Give that payment the
      // same scoped terminal handoff rather than leaving stale row copy.
      if (payment.id) setPendingRowExitingPaymentId(payment.id);
      showTerminalToast();
      return;
    }

    clearPendingTerminalTimer();
    pendingTerminalTimerRef.current = setTimeout(() => {
      // A newer toast, payment, or unmount invalidates this replacement.
      if (
        pendingToastRef.current?.paymentId !== pendingToast.paymentId ||
        toastRevisionRef.current !== pendingToast.revision
      ) return;
      // First dismiss the Pending banner. ToastBanner keeps it mounted for a
      // visible fade/slide exit; only then mount the terminal banner so it
      // receives an independent full-duration timer.
      // Keep the inline row until this precise terminal handoff; its own
      // collapse starts alongside the toast exit even if a refresh already
      // removed the authoritative pending transaction from the list.
      setPendingRowExitingPaymentId(pendingToast.paymentId);
      setToast(null);
      pendingToastRef.current = null;
      pendingTerminalTimerRef.current = setTimeout(() => {
        if (toastRevisionRef.current !== pendingToast.revision) return;
        pendingTerminalTimerRef.current = null;
        showTerminalToast();
      }, PENDING_EXIT_DURATION_MS);
    }, remainingDwell);
  }, [clearPendingTerminalTimer, showToast]);

  const reconcileTrackedPayment = useCallback(async (): Promise<void> => {
    if (!trackedPendingPayment) return;

    const payment = await getPayment(trackedPendingPayment.id);
    if (!payment || payment.type !== 'send') return;

    const status = payment.status;
    if (status !== 'completed' && status !== 'failed') return;

    showOutgoingPaymentState({
      id: payment.id,
      status,
      amountSat: payment.amountSat || trackedPendingPayment.amountSat,
      description: payment.description,
    });
    setTrackedPendingPayment(null);
    await Promise.all([refreshBalance(), refreshTransactions()]);
  }, [refreshBalance, refreshTransactions, showOutgoingPaymentState, trackedPendingPayment]);

  // Initial load and wallet switch - refresh when connected or when wallet changes
  // Don't show pull-to-refresh spinner here since cached data loads instantly
  useEffect(() => {
    if (isConnected && activeWalletInfo) {
      console.log('🔄 [HomeScreen] Wallet changed or connected, refreshing...', {
        masterKey: activeWalletInfo.masterKeyNickname,
        subWallet: activeWalletInfo.subWalletNickname,
      });
      // Call refresh directly without setting refreshing state
      // This allows cached data to show immediately without spinner
      Promise.all([refreshBalance(), refreshTransactions()]);
    }
  }, [isConnected, activeWalletInfo?.masterKeyId, activeWalletInfo?.subWalletIndex]);

  // Subscribe to payment events for real-time balance updates
  useEffect(() => {
    const unsubscribe = onPaymentReceived((payment) => {
      // Check if this is a sync event or a real payment
      const isSyncEvent = payment.description === '__SYNC_EVENT__';

      if (!isSyncEvent) {
        const amount = payment.amountSat || 0;
        const asset: 'BTC' | 'USDB' = payment.asset === 'USDB' ? 'USDB' : 'BTC';
        const formatted = asset === 'USDB'
          ? `${(amount / 1e6).toFixed(2)} USDB`
          : `${amount.toLocaleString()} sat`;

        if (payment.type === 'send' && (amount > 0 || payment.status === 'pending')) {
          showOutgoingPaymentState(payment);
          if (
            trackedPendingPayment &&
            payment.id === trackedPendingPayment.id &&
            (payment.status === 'completed' || payment.status === 'failed')
          ) {
            setTrackedPendingPayment(null);
          }
        } else if (payment.type === 'receive' && amount > 0) {
          // Foreground receive — success tone (mint green, celebratory).
          // Background receives are handled by the FCM push push; this
          // toast only fires while the app is open.
          showToast({
            icon: '↓',
            title: 'Payment received',
            subtitle: payment.description || (asset === 'USDB' ? 'USDB' : 'Lightning'),
            trailing: `+${formatted}`,
            tone: 'success',
          });
        }

        // Failed incoming payments still need their own notice. Outgoing
        // payments were already status-gated above.
        if (payment.status === 'failed' && payment.type !== 'send') {
          showToast({
            icon: '✕',
            title: 'Incoming payment failed',
            subtitle: payment.description || 'Try again or contact support',
            tone: 'danger',
          });
        }
      }

      // Refresh balance and transactions - use Promise.all to ensure both complete
      Promise.all([refreshBalance(), refreshTransactions()])
        .catch((err) => console.error('❌ [HomeScreen] Refresh after payment event failed:', err));
    });

    return () => {
      unsubscribe();
    };
  }, [refreshBalance, refreshTransactions, showOutgoingPaymentState, trackedPendingPayment]);

  // Refresh balance, transactions and settings when screen comes into focus
  // This ensures data updates when returning from other screens, wallet switches, or opening from notification
  useFocusEffect(
    useCallback(() => {
      // Always refresh settings when screen comes into focus
      refreshSettings();

      // CRITICAL: Reload wallet data from storage on every focus.
      // This catches wallet switches that happened via Manage Wallets → PIN → replace.
      // loadWalletData reads the active wallet from storage, loads its cached balance/transactions,
      // and resets state if the wallet changed.
      loadWalletData(true);

      if (isConnected) {
        // Refresh both balance and transactions to catch any updates
        refreshBalance();
        refreshTransactions();
      }
      void reconcileTrackedPayment();
    }, [isConnected, refreshBalance, refreshTransactions, refreshSettings, loadWalletData, reconcileTrackedPayment])
  );

  // Show payment success toast when returning from successful payment (via PaymentConfirmationScreen)
  useEffect(() => {
    if (params.paymentSuccess === 'true' && params.paymentAmount) {
      const amount = parseInt(params.paymentAmount, 10);
      showOutgoingPaymentState({ id: params.paymentId, status: 'completed', amountSat: amount });
      router.setParams({ paymentSuccess: undefined, paymentAmount: undefined, paymentId: undefined });
    }
  }, [params.paymentSuccess, params.paymentAmount, params.paymentId, showOutgoingPaymentState]);

  useEffect(() => {
    if (params.paymentPending !== 'true') return;
    const parsedAmount = params.paymentAmount ? parseInt(params.paymentAmount, 10) : Number.NaN;
    const amount = Number.isFinite(parsedAmount) ? parsedAmount : undefined;
    if (params.paymentId) {
      setTrackedPendingPayment({ id: params.paymentId, amountSat: amount ?? 0 });
    }
    showOutgoingPaymentState({ id: params.paymentId, status: 'pending', amountSat: amount });
    router.setParams({ paymentPending: undefined, paymentAmount: undefined, paymentId: undefined });
  }, [params.paymentPending, params.paymentAmount, params.paymentId, showOutgoingPaymentState]);

  useEffect(() => {
    void reconcileTrackedPayment();
  }, [reconcileTrackedPayment]);

  // Show the standard "Payment received" toast when the Receive screen handed
  // off after a payment landed on the invoice page (matches the toast shown for
  // receives while already on Home — same component, position, and tone).
  useEffect(() => {
    if (params.paymentReceived === 'true' && params.paymentReceivedSat) {
      const amount = parseInt(params.paymentReceivedSat, 10) || 0;
      const asset = params.paymentReceivedAsset === 'USDB' ? 'USDB' : 'BTC';
      const formatted = asset === 'USDB'
        ? `${(amount / 1e6).toFixed(2)} USDB`
        : `${amount.toLocaleString()} sat`;
      showToast({
        icon: '↓',
        title: 'Payment received',
        subtitle: asset === 'USDB' ? 'USDB' : 'Lightning',
        trailing: `+${formatted}`,
        tone: 'success',
      });
      router.setParams({
        paymentReceived: undefined,
        paymentReceivedSat: undefined,
        paymentReceivedAsset: undefined,
      });
    }
  }, [params.paymentReceived, params.paymentReceivedSat, params.paymentReceivedAsset]);

  useEffect(() => {
    const targetAsset = params.asset === 'USDB' ? 'USDB' : null;
    if (!targetAsset || targetAsset === activeAsset) return;

    setActiveAsset(targetAsset);
    void settingsService.setActiveAsset(targetAsset);
    router.setParams({ asset: undefined });
  }, [params.asset, activeAsset]);

  // Swap-success toast + auto-switch to the destination asset tab.
  useEffect(() => {
    if (params.swapSuccess !== 'true') return;

    const targetAsset: WalletAsset = params.swapAsset === 'BTC' ? 'BTC' : 'USDB';
    if (activeAsset !== targetAsset) {
      setActiveAsset(targetAsset);
      void settingsService.setActiveAsset(targetAsset);
    }

    const received = params.swapReceived || '';
    const unit = targetAsset === 'USDB' ? 'USDB' : 'sat';
    showToast({
      icon: '⇄',
      title: 'Swap complete',
      subtitle: targetAsset === 'USDB' ? 'BTC → USDB' : 'USDB → BTC',
      trailing: received ? `+${received} ${unit}` : undefined,
      tone: 'accent',
    });

    router.setParams({ swapSuccess: undefined, swapAsset: undefined, swapReceived: undefined });
  }, [params.swapSuccess, params.swapAsset, params.swapReceived, activeAsset]);

  // Swap-refunded toast — warn tone (amber). A refund means the AMM's
  // rate drifted outside our slippage tolerance and Spark auto-returned
  // the funds. Nothing was lost; user just needs to retry, often with
  // wider slippage.
  useEffect(() => {
    if (params.swapRefunded !== 'true') return;
    showToast({
      icon: '↻',
      title: 'Swap refunded',
      subtitle: 'Slippage too tight — funds returned',
      tone: 'warn',
    });
    router.setParams({ swapRefunded: undefined });
  }, [params.swapRefunded]);

  // Payment-error toast — danger tone (red). Fired from the Send flow
  // when an outgoing payment fails (route failure, expired invoice,
  // insufficient liquidity, etc.).
  useEffect(() => {
    if (!params.paymentError) return;
    showToast({
      icon: '✕',
      title: 'Payment failed',
      subtitle: params.paymentError,
      tone: 'danger',
    });
    router.setParams({ paymentError: undefined });
  }, [params.paymentError]);

  // Wallet-switched toast — info tone (blue). Confirms the active wallet
  // changed after coming back from the Manage Wallets flow.
  useEffect(() => {
    if (params.walletSwitched !== 'true') return;
    showToast({
      icon: '↪',
      title: 'Wallet switched',
      subtitle: params.walletSwitchedName || 'Active wallet updated',
      tone: 'info',
    });
    router.setParams({ walletSwitched: undefined, walletSwitchedName: undefined });
  }, [params.walletSwitched, params.walletSwitchedName]);

  // "Save as contact?" bottom sheet — shown here (over the main page) after
  // the Send flow pays an unsaved Lightning Address and redirects home.
  const [saveContactAddress, setSaveContactAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!params.saveContact) return;
    setSaveContactAddress(params.saveContact);
    router.setParams({ saveContact: undefined });
  }, [params.saveContact]);

  const handleSavedContact = useCallback(() => {
    setSaveContactAddress(null);
    showToast({
      icon: '✓',
      title: 'Contact saved',
      tone: 'success',
    });
  }, [showToast]);

  const handleDismissSaveContact = useCallback(() => {
    setSaveContactAddress(null);
  }, []);

  // Navigation handlers
  const handleAssetChange = (asset: WalletAsset): void => {
    setActiveAsset(asset);
    void settingsService.setActiveAsset(asset);
  };

  const handleSend = (): void => {
    router.push({ pathname: '/wallet/send', params: { asset: activeAsset } });
  };

  const handleReceive = (): void => {
    router.push({ pathname: '/wallet/receive', params: { asset: activeAsset } });
  };

  const handleScan = (): void => {
    router.push({ pathname: '/wallet/scan', params: { asset: activeAsset } });
  };

  const handleSwap = (): void => {
    // Pass the active asset through navigation so the swap route can derive
    // the initial direction from the page context the user came from.
    router.push({ pathname: '/wallet/swap', params: { asset: activeAsset } });
  };

  const handleViewHistory = (): void => {
    router.push({ pathname: '/wallet/history', params: { asset: activeAsset } });
  };

  const handleManageWallets = (): void => {
    router.push('/wallet/manage');
  };

  const handleLock = async (): Promise<void> => {
    await lock();
    router.replace('/wallet/unlock');
  };

  const handleSettings = (): void => {
    router.push('/wallet/settings');
  };


  // Render transaction item
  const renderTransaction = (row: TransactionRow, index: number): React.JSX.Element => {
    const tx = row.transaction;
    const isReceived = row.displayType === 'receive';
    const method = row.isSwap ? 'swap' : (tx.method || (tx.txid ? 'onchain' : 'lightning'));
    const isDirectUsdbTransfer = !row.isSwap && tx.asset === 'USDB';
    // For swap rows, the display asset equals the current tab - the row's
    // `displayAmount` is already the amount in that tab's units. For regular
    // rows, trust tx.asset.
    const rowAsset: 'BTC' | 'USDB' = row.isSwap ? activeAsset : (tx.asset === 'USDB' ? 'USDB' : 'BTC');
    const txIcon = isDirectUsdbTransfer ? (isReceived ? '$↓' : '$↑') : (method === 'swap' ? '⇄' : method === 'onchain' ? '⛓️' : '⚡');
    const txIconColor = isDirectUsdbTransfer ? '#4CAF50' : primaryTextColor;
    const amount = row.displayAmount;
    const timestamp = typeof tx.timestamp === 'number' && tx.timestamp > 0 ? tx.timestamp : Date.now();
    const dateObj = new Date(timestamp);
    const date = dateObj.toLocaleDateString();
    const time = dateObj.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const formattedTx = formatTx(amount, isReceived, { asset: rowAsset });

    return (
      <TouchableOpacity
        key={row.id || tx.id || index}
        style={styles.transactionItem}
        onPress={() => {
          setSelectedTransaction(tx);
          setSelectedSwapRow(row.isSwap ? row : null);
        }}
      >
        <View style={styles.transactionIcon}>
          <Text style={[styles.transactionIconText, { color: primaryTextColor }]}>
            {method === 'swap' ? '⇄' : method === 'onchain' ? '⛓️' : '⚡'}
          </Text>
        </View>
        <View style={styles.transactionInfo}>
          <Text style={[styles.transactionDescription, { color: primaryTextColor }]} numberOfLines={1}>
            {row.displayDescription || tx.description || (isReceived ? t('wallet.received') : t('wallet.sent'))}
          </Text>
          <Text style={[styles.transactionDate, { color: secondaryTextColor }]}>{`${date} · ${time}`}</Text>
          {tx.status !== 'completed' && (
            <Text style={[styles.transactionDate, { color: tx.status === 'failed' ? '#FF6B6B' : '#FBBF24' }]}>
              {tx.status === 'failed' ? `✕ ${t('wallet.statusFailed')}` : `⏳ ${t('wallet.statusPending')}`}
            </Text>
          )}
        </View>
        <View style={styles.transactionAmountContainer}>
          <Text
            style={[
              styles.transactionAmount,
              isReceived ? styles.amountReceived : styles.amountSent,
            ]}
          >
            {formattedTx.primary}
          </Text>
          {formattedTx.secondaryCompact && (
            <Text style={[styles.transactionAmountSecondary, { color: secondaryTextColor }]}>
              {formattedTx.secondaryCompact}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.walletSelector}
            onPress={handleManageWallets}
          >
            <View style={styles.walletIcon}>
              <Text style={styles.walletIconText}>💰</Text>
            </View>
            <View>
              <Text style={[styles.walletName, { color: primaryTextColor }]} numberOfLines={1}>
                {activeWalletInfo?.masterKeyNickname || t('wallet.walletFallback')}
              </Text>
              <Text style={[styles.subWalletName, { color: secondaryTextColor }]} numberOfLines={1}>
                {activeWalletInfo?.subWalletNickname || t('wallet.mainWalletFallback')}
              </Text>
            </View>
            <IconButton
              icon="chevron-down"
              iconColor={iconColor}
              size={20}
            />
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <IconButton
              icon="eye"
              iconColor={iconColor}
              size={22}
              onPress={() => setShowBalance(!showBalance)}
            />
            <IconButton
              icon="lock"
              iconColor={iconColor}
              size={22}
              onPress={handleLock}
            />
            <IconButton
              icon="cog"
              iconColor={iconColor}
              size={22}
              onPress={handleSettings}
            />
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={BRAND_COLOR}
            />
          }
        >
          {/* Lightning Address pill — only rendered when the user has
              claimed one. Mirrors the "shiro123@breez.tips" chip from the
              ZapArc web extension. Tap to copy. */}
          {isLightningAddressRegistered && lightningAddressInfo?.lightningAddress && (
            <TouchableOpacity
              style={styles.lnAddressRow}
              activeOpacity={0.75}
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(lightningAddressInfo.lightningAddress);
                  // Android has its own native toast; on iOS (and as a
                  // belt-and-braces UX everywhere) we show our in-app
                  // ToastBanner so the user gets visible feedback.
                  if (Platform.OS === 'android' && ToastAndroid?.show) {
                    ToastAndroid.show('Copied', ToastAndroid.SHORT);
                  } else {
                  showToast({
                      tone: 'info',
                      icon: '⚡',
                      title: 'Address copied',
                      subtitle: lightningAddressInfo.lightningAddress,
                    });
                  }
                } catch {}
              }}
              accessibilityRole="button"
              accessibilityLabel={`Lightning address ${lightningAddressInfo.lightningAddress}. Tap to copy.`}
            >
              <Text style={styles.lnAddressBolt}>⚡</Text>
              <Text
                style={[styles.lnAddressText, { color: BRAND_COLOR }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {lightningAddressInfo.lightningAddress}
              </Text>
              <Text style={[styles.lnAddressCopyIcon, { color: BRAND_COLOR }]}>⧉</Text>
            </TouchableOpacity>
          )}

          {MULTI_ASSET_UI_ENABLED && (
            <View style={styles.assetPillRow}>
              <AssetSelectorPill
                ticker={activeAsset}
                onPress={() => setAssetPickerVisible(true)}
              />
            </View>
          )}

          {/* Security reminder banner - only one at a time.
              Biometric has priority; notifications takes over once
              biometric is enabled, dismissed, or unavailable. */}
          {activeReminder === 'biometric' && (
            <View style={styles.securityBanner}>
              <View style={styles.securityBannerTextWrap}>
                <Text style={[styles.securityBannerTitle, { color: primaryTextColor }]}> 
                  {t('home.securityBanner.biometricTitle')}
                </Text>
                <Text style={[styles.securityBannerSubtitle, { color: secondaryTextColor }]}> 
                  {t('home.securityBanner.biometricSubtitle')}
                </Text>
              </View>
              <View style={styles.securityBannerActions}>
                <TouchableOpacity
                  onPress={handleEnableBiometric}
                  style={[styles.securityBannerPrimary, { backgroundColor: BRAND_COLOR }]}
                >
                  <Text style={styles.securityBannerPrimaryText}>{t('home.securityBanner.enable')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDismissBiometric}
                  style={styles.securityBannerDismiss}
                >
                  <Text style={[styles.securityBannerDismissText, { color: secondaryTextColor }]}> 
                    {t('home.securityBanner.notNow')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activeReminder === 'notifications' && (
            <View style={styles.securityBanner}>
              <View style={styles.securityBannerTextWrap}>
                <Text style={[styles.securityBannerTitle, { color: primaryTextColor }]}> 
                  {t('home.securityBanner.notificationsTitle')}
                </Text>
                <Text style={[styles.securityBannerSubtitle, { color: secondaryTextColor }]}> 
                  {t('home.securityBanner.notificationsSubtitle')}
                </Text>
              </View>
              <View style={styles.securityBannerActions}>
                <TouchableOpacity
                  onPress={handleEnableNotifications}
                  style={[styles.securityBannerPrimary, { backgroundColor: BRAND_COLOR }]}
                >
                  <Text style={styles.securityBannerPrimaryText}>{t('home.securityBanner.enable')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDismissNotifications}
                  style={styles.securityBannerDismiss}
                >
                  <Text style={[styles.securityBannerDismissText, { color: secondaryTextColor }]}> 
                    {t('home.securityBanner.notNow')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activeReminder === 'cloud-backup' && (
            <View style={styles.securityBanner}>
              <View style={styles.securityBannerTextWrap}>
                <Text style={[styles.securityBannerTitle, { color: primaryTextColor }]}>
                  {t('home.securityBanner.cloudBackupTitle')}
                </Text>
                <Text style={[styles.securityBannerSubtitle, { color: secondaryTextColor }]}>
                  {t('home.securityBanner.cloudBackupSubtitle')}
                </Text>
              </View>
              <View style={styles.securityBannerActions}>
                <TouchableOpacity
                  onPress={handleEnableCloudBackup}
                  style={[styles.securityBannerPrimary, { backgroundColor: BRAND_COLOR }]}
                >
                  <Text style={styles.securityBannerPrimaryText}>{t('home.securityBanner.backUp')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDismissCloudBackup}
                  style={styles.securityBannerDismiss}
                >
                  <Text style={[styles.securityBannerDismissText, { color: secondaryTextColor }]}>
                    {t('home.securityBanner.notNow')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {activeReminder === 'lightning-address' && (
            <View style={styles.securityBanner}>
              <View style={styles.securityBannerTextWrap}>
                <Text style={[styles.securityBannerTitle, { color: primaryTextColor }]}>
                  {t('home.securityBanner.lightningAddressTitle')}
                </Text>
                <Text style={[styles.securityBannerSubtitle, { color: secondaryTextColor }]}>
                  {t('home.securityBanner.lightningAddressSubtitle')}
                </Text>
              </View>
              <View style={styles.securityBannerActions}>
                <TouchableOpacity
                  onPress={handleClaimLightningAddress}
                  style={[styles.securityBannerPrimary, { backgroundColor: BRAND_COLOR }]}
                >
                  <Text style={styles.securityBannerPrimaryText}>{t('home.securityBanner.claim')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDismissLightningAddress}
                  style={styles.securityBannerDismiss}
                >
                  <Text style={[styles.securityBannerDismissText, { color: secondaryTextColor }]}>
                    {t('home.securityBanner.notNow')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Balance Card */}
          <View style={styles.balanceCard}>
            <Text style={[styles.balanceLabel, { color: secondaryTextColor }]}>
              {activeAsset === 'USDB' ? 'USDB Balance' : t('wallet.balance')}
            </Text>
            {isLoading && !displayBalance ? (
              <ActivityIndicator color={BRAND_COLOR} size="large" />
            ) : (
              <>
                <Text style={[styles.balanceAmount, { color: primaryTextColor }]}>
                  {activeAsset === 'USDB' ? `${displayBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDB` : getFormattedBalance(displayBalance).primary}
                </Text>
                {showBalance && activeAsset === 'USDB' && rates && (
                  <Text style={[styles.balanceSecondary, { color: secondaryTextColor }]}>
                    {formatFiat(usdbToFiat(displayBalance, secondaryFiatCurrency, rates), secondaryFiatCurrency)}
                  </Text>
                )}
                {showBalance && activeAsset === 'BTC' && getFormattedBalance(displayBalance).secondary && (
                  <Text style={[styles.balanceSecondary, { color: secondaryTextColor }]}>
                    {getFormattedBalance(displayBalance).secondary}
                  </Text>
                )}
              </>
            )}
            {!showBalance && (
              <TouchableOpacity onPress={() => setShowBalance(true)}>
                <Text style={styles.tapToReveal}>{t('common.tapToReveal')}</Text>
              </TouchableOpacity>
            )}
            {activeAsset === 'BTC' && (
              <PendingBalanceRow
                payments={pendingOutgoing}
                exitingPaymentId={pendingRowExitingPaymentId}
                onPress={() => router.push('/wallet/history')}
              />
            )}
          </View>

          {/* Quick Actions - all four always available; asset context is
              propagated via route params so each screen gates what applies.
              For USDB tab the Receive screen accepts Spark invoices only
              (on-chain tab is visibly disabled inside that screen). */}
          <View style={styles.quickActionsContainer}>
            <QuickAction
              icon="↑"
              label={t('wallet.send')}
              onPress={handleSend}
              color="#FF6B6B"
            />
            <QuickAction
              icon="↓"
              label={t('wallet.receive')}
              onPress={handleReceive}
              color="#4CAF50"
            />
            <QuickAction
              icon="⬡"
              label={t('payments.scanQR')}
              onPress={handleScan}
              color="#2196F3"
            />
            {SWAP_FEATURE_ENABLED && (
              <QuickAction
                icon="⇄"
                label={t('swap.title')}
                onPress={handleSwap}
                color="#FFB300"
              />
            )}
          </View>

          {showUsdbEmptyState && SWAP_FEATURE_ENABLED && (
            <View style={styles.usdbEmptyStateCard}>
              <Text style={[styles.usdbEmptyStateTitle, { color: primaryTextColor }]}>{t('home.usdbEmptyState.title')}</Text>
              <Text style={[styles.usdbEmptyStateSubtitle, { color: secondaryTextColor }]}>{t('home.usdbEmptyState.subtitle')}</Text>
              <TouchableOpacity
                onPress={handleSwap}
                style={[styles.usdbEmptyStateButton, { backgroundColor: BRAND_COLOR }]}
              >
                <Text style={styles.usdbEmptyStateButtonText}>{t('home.usdbEmptyState.cta')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Recent Transactions */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>{t('wallet.transactions')}</Text>
            <TouchableOpacity onPress={handleViewHistory}>
              <Text style={styles.seeAllButton}>{t('common.seeAll')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.transactionsContainer}>
            {isLoading && transactions.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator color={BRAND_COLOR} />
                <Text style={[styles.loadingText, { color: secondaryTextColor }]}>{t('common.loading')}</Text>
              </View>
            ) : transactionRows.length === 0 ? (
              <View style={styles.emptyTransactions}>
                <Text style={styles.emptyIcon}>📭</Text>
                <Text style={[styles.emptyText, { color: secondaryTextColor }]}>{t('wallet.noTransactions')}</Text>
                <Text style={[styles.emptySubtext, { color: secondaryTextColor }]}>
                  {t('wallet.getStarted')}
                </Text>
              </View>
            ) : (
              transactionRows.slice(0, 5).map(renderTransaction)
            )}
          </View>
        </ScrollView>

        {/* Transaction Details Modal */}
        {selectedTransaction && renderDetailsModal()}

        {/* Asset picker (replaces the BTC/USDB tab bar). Tapping the
            asset pill above the balance opens this sheet. v1 keeps this
            inert — pill is hidden and visible stays false — but we
            still gate it here so any future reintroduction of a trigger
            doesn't accidentally re-expose USDB. */}
        {MULTI_ASSET_UI_ENABLED && (
          <AssetPickerSheet
            visible={assetPickerVisible}
            selected={activeAsset}
            getBalanceLine={(ticker) => {
              if (ticker === 'USDB') {
                return `${usdbBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDB`;
              }
              const sats = getBalanceForAsset(ticker as WalletAsset);
              return `${sats.toLocaleString()} sats`;
            }}
            onSelect={(ticker) => handleAssetChange(ticker as WalletAsset)}
            onClose={() => setAssetPickerVisible(false)}
          />
        )}
      </SafeAreaView>

      {/* Heads-up toast banner — renders at the top, tinted by tone.
          See components/ToastBanner.tsx. */}
      <ToastBanner
        visible={!!toast}
        onDismiss={dismissToast}
        revision={toast?.revision}
        icon={toast?.icon}
        title={toast?.title || ''}
        subtitle={toast?.subtitle}
        trailing={toast?.trailing}
        tone={toast?.tone}
        position={toast?.position}
        isPending={toast?.isPending}
      />

      {/* "Save as contact?" prompt after paying an unsaved Lightning Address. */}
      <SaveContactPrompt
        visible={!!saveContactAddress}
        address={saveContactAddress}
        onSaved={handleSavedContact}
        onDismiss={handleDismissSaveContact}
      />
    </LinearGradient>
  );

  // Helper function to format time
  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Render transaction details modal
  function renderDetailsModal(): React.JSX.Element | null {
    if (!selectedTransaction) return null;

    const tx = selectedTransaction;
    const isReceived = tx.type === 'receive';
    const method = tx.method || (tx.txid ? 'onchain' : 'lightning');
    const date = new Date(tx.timestamp);

    return (
      <Modal
        visible={!!selectedTransaction}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedTransaction(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: primaryTextColor }]}>{t('wallet.transactionDetails')}</Text>
              <IconButton
                icon="close"
                iconColor={iconColor}
                size={24}
                onPress={() => { setSelectedTransaction(null); setSelectedSwapRow(null); }}
              />
            </View>

            {/* Amount */}
            <View style={styles.modalAmountContainer}>
              <View style={styles.modalIcon}>
                <Text style={[styles.modalIconText, { color: primaryTextColor }]}>
                  {method === 'onchain' ? '⛓️' : '⚡'}
                </Text>
              </View>
              <Text
                style={[
                  styles.modalAmount,
                  isReceived ? styles.amountReceived : styles.amountSent,
                ]}
              >
                {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).primary}
              </Text>
              {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).secondary && (
                <Text style={[styles.modalAmountSecondary, { color: secondaryTextColor }]}>
                  {formatTx(tx.amount ?? 0, isReceived, { asset: tx.asset === 'USDB' ? 'USDB' : 'BTC' }).secondary}
                </Text>
              )}
              <Text style={[
                styles.modalStatus,
                { color: secondaryTextColor },
                (tx.status === 'completed' || (tx.status === 'pending' && method === 'onchain' && tx.txid)) && styles.statusCompleted,
                (tx.status === 'pending' && !(method === 'onchain' && tx.txid)) && styles.statusPending,
                tx.status === 'failed' && styles.statusFailed,
              ]}>
                {tx.status === 'failed' ? `\u2715 ${t('wallet.statusFailed')}` :
                 (tx.status === 'pending' && !(method === 'onchain' && tx.txid)) ? `\u23F3 ${t('wallet.statusPending')}` :
                 `\u2713 ${t('wallet.statusCompleted')}`}
              </Text>
            </View>

            <Divider style={styles.divider} />

            {/* Details */}
            <View style={styles.detailsContainer}>
              <DetailRow label={t('wallet.type')} value={isReceived ? t('wallet.received') : t('wallet.sent')} />
              <DetailRow label={t('wallet.method')} value={method === 'onchain' ? t('wallet.methodOnchain') : t('wallet.methodLightning')} />
              <DetailRow
                label={t('wallet.date')}
                value={date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              />
              <DetailRow label={t('wallet.time')} value={formatTime(tx.timestamp)} />
              {tx.description && (
                <DetailRow label={t('payments.description')} value={tx.description} />
              )}
              {tx.feeSats !== undefined && tx.feeSats > 0 && (
                <DetailRow
                  label={t('wallet.fee')}
                  value={
                    tx.asset === 'USDB'
                      ? `${(tx.feeSats / 1e6).toFixed(6)} USDB`
                      : `${tx.feeSats.toLocaleString()} ${t('wallet.sats')}`
                  }
                />
              )}
              {/* Type: swap / lightning / on-chain */}
              {(tx.paymentType === 'conversion' || selectedSwapRow?.isSwap) && (
                <DetailRow
                  label={t('wallet.type')}
                  value={
                    selectedSwapRow?.swapDirection === 'USDB_TO_BTC'
                      ? `${t('swap.history.label')} (${t('swap.history.usdbToBtc')})`
                      : `${t('swap.history.label')} (${t('swap.history.btcToUsdb')})`
                  }
                />
              )}
              {/* Swap-pair amounts: always show BOTH legs so the user can
                  see how many sats were paid AND how many USDB were received
                  (or vice versa). */}
              {selectedSwapRow?.isSwap && selectedSwapRow.btcSide && selectedSwapRow.usdbSide && (
                selectedSwapRow.swapDirection === 'BTC_TO_USDB' ? (
                  <>
                    <DetailRow
                      label={t('swap.youPay')}
                      value={`${Number(selectedSwapRow.btcSide.amount || 0).toLocaleString()} sats`}
                    />
                    <DetailRow
                      label={t('swap.youReceive')}
                      value={`${(Number(selectedSwapRow.usdbSide.amount || 0) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })} USDB`}
                    />
                  </>
                ) : (
                  <>
                    <DetailRow
                      label={t('swap.youPay')}
                      value={`${(Number(selectedSwapRow.usdbSide.amount || 0) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })} USDB`}
                    />
                    <DetailRow
                      label={t('swap.youReceive')}
                      value={`${Number(selectedSwapRow.btcSide.amount || 0).toLocaleString()} sats`}
                    />
                  </>
                )
              )}
              {/* Non-swap single-leg amount (regular send/receive) */}
              {!selectedSwapRow?.isSwap && tx.asset === 'USDB' && (
                <DetailRow
                  label={t('payments.amount')}
                  value={`${(Number(tx.amount || 0) / 1e6).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 6,
                  })} USDB`}
                />
              )}
              {!selectedSwapRow?.isSwap && tx.asset !== 'USDB' && tx.amount !== undefined && (
                <DetailRow
                  label={t('payments.amount')}
                  value={`${Number(tx.amount).toLocaleString()} sats`}
                />
              )}
              {/* Payment ID (useful for swap + lightning debugging) */}
              {tx.id && (
                <DetailRow
                  label={t('wallet.paymentId')}
                  value={String(tx.id)}
                  copyable
                  fullValue={String(tx.id)}
                />
              )}
              {tx.tokenIdentifier && (
                <DetailRow
                  label={t('wallet.token')}
                  value={String(tx.tokenIdentifier)}
                  copyable
                  fullValue={String(tx.tokenIdentifier)}
                />
              )}
              {method === 'onchain' && tx.txid && (
                <>
                  <DetailRow label="TXID" value={`${tx.txid.slice(0, 16)}...`} />
                  <TouchableOpacity onPress={() => Linking.openURL(`https://mempool.space/tx/${tx.txid}`)}>
                    <Text style={styles.mempoolLink}>{t('wallet.viewOnMempool')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Close Button */}
            <Button
              mode="outlined"
              onPress={() => setSelectedTransaction(null)}
              style={styles.closeModalButton}
              labelStyle={[styles.closeModalButtonLabel, { color: primaryTextColor }]}
            >
              {t('common.close')}
            </Button>
          </View>
        </View>
      </Modal>
    );
  }

  // Detail row component. When `copyable` is set, tapping the row copies
  // `fullValue ?? value` to the clipboard. Value text uses middle ellipsis
  // so bech32-style identifiers remain identifiable at a glance.
  function DetailRow({
    label,
    value,
    copyable,
    fullValue,
  }: {
    label: string;
    value: string;
    copyable?: boolean;
    fullValue?: string;
  }): React.JSX.Element {
    const handleCopy = async (): Promise<void> => {
      try {
        await Clipboard.setStringAsync(fullValue || value);
        if (Platform.OS === 'android' && ToastAndroid?.show) {
          ToastAndroid.show(t('common.copied'), ToastAndroid.SHORT);
        }
      } catch {}
    };
    return (
      <TouchableOpacity
        style={styles.detailRow}
        onPress={copyable ? handleCopy : undefined}
        disabled={!copyable}
        activeOpacity={copyable ? 0.6 : 1}
      >
        <Text style={[styles.detailLabel, { color: secondaryTextColor }]}>{label}</Text>
        <Text
          style={[styles.detailValue, { color: primaryTextColor }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {value}
        </Text>
      </TouchableOpacity>
    );
  }
}

// =============================================================================
// Quick Action Button
// =============================================================================

function QuickAction({
  icon,
  label,
  onPress,
  color = BRAND_COLOR,
}: QuickActionProps): React.JSX.Element {
  const { themeMode } = useAppTheme();
  const secondaryTextColor = getSecondaryTextColor(themeMode);

  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <View style={[styles.quickActionIcon, { backgroundColor: `${color}20` }]}>
        <Text style={[styles.quickActionIconText, { color }]}>{icon}</Text>
      </View>
      <Text style={[styles.quickActionLabel, { color: secondaryTextColor }]}>{label}</Text>
    </TouchableOpacity>
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
  assetPillRow: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  walletSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  walletIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 193, 7, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  walletIconText: {
    fontSize: 16,
  },
  walletName: {
    fontSize: 15,
    fontWeight: '600',
    maxWidth: 150,
  },
  subWalletName: {
    fontSize: 11,
    maxWidth: 150,
  },
  lnAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginHorizontal: 16,
    marginBottom: 6,
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 193, 7, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.35)',
    maxWidth: '92%',
  },
  lnAddressBolt: {
    color: BRAND_COLOR,
    fontSize: 13,
    marginRight: 6,
  },
  lnAddressText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  lnAddressCopyIcon: {
    fontSize: 14,
    marginLeft: 8,
    opacity: 0.8,
  },
  headerActions: {
    flexDirection: 'row',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  securityBanner: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  securityBannerTextWrap: {
    marginBottom: 10,
  },
  securityBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  securityBannerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  securityBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  securityBannerPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  securityBannerPrimaryText: {
    color: '#1a1a2e',
    fontSize: 13,
    fontWeight: '600',
  },
  securityBannerDismiss: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  securityBannerDismissText: {
    fontSize: 13,
    fontWeight: '500',
  },
  balanceCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  balanceLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  balanceSecondary: {
    fontSize: 14,
    marginTop: 4,
  },
  tapToReveal: {
    fontSize: 12,
    color: BRAND_COLOR,
    marginTop: 8,
  },
  pendingBalanceRow: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.6)',
    alignSelf: 'stretch',
  },
  pendingBalanceTitle: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '700',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  usdbEmptyStateCard: {
    marginBottom: 18,
    borderRadius: 14,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  usdbEmptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  usdbEmptyStateSubtitle: {
    marginTop: 6,
    fontSize: 13,
  },
  usdbEmptyStateButton: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  usdbEmptyStateButtonText: {
    color: '#1a1a2e',
    fontWeight: '700',
  },
  quickAction: {
    alignItems: 'center',
    flex: 1,
  },
  quickActionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionIconText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  quickActionLabel: {
    fontSize: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  seeAllButton: {
    fontSize: 14,
    color: BRAND_COLOR,
  },
  transactionsContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  loadingContainer: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyTransactions: {
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionIconText: {
    fontSize: 18,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionDescription: {
    fontSize: 14,
    marginBottom: 2,
  },
  transactionDate: {
    fontSize: 12,
  },
  transactionAmountContainer: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
  transactionAmountSecondary: {
    fontSize: 11,
    marginTop: 2,
  },
  amountReceived: {
    color: '#4CAF50',
  },
  amountSent: {
    color: '#FF6B6B',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalAmountContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalIconText: {
    fontSize: 24,
  },
  modalAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  modalAmountSecondary: {
    fontSize: 14,
    marginBottom: 8,
  },
  modalStatus: {
    fontSize: 14,
  },
  statusCompleted: {
    color: '#4CAF50',
  },
  statusPending: {
    color: BRAND_COLOR,
  },
  statusFailed: {
    color: '#FF5252',
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
  },
  detailsContainer: {
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  detailLabel: {
    fontSize: 14,
  },
  detailValue: {
    fontSize: 14,
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  mempoolLink: {
    color: BRAND_COLOR,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 8,
  },
  closeModalButton: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
  },
  closeModalButtonLabel: {
  },
});
