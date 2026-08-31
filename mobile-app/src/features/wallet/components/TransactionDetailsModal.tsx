import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Button, Divider, IconButton, Text } from 'react-native-paper';

import { useAppTheme } from '../../../contexts/ThemeContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { useLanguage } from '../../../hooks/useLanguage';
import { exportDetailedSdkSupportLogs, exportPaymentDiagnostics } from '../../../services/breezSparkService';
import {
  BRAND_COLOR,
  getIconColor,
  getPrimaryTextColor,
  getSecondaryTextColor,
} from '../../../utils/theme-helpers';
import type { Transaction } from '../types';
import type { TransactionRow } from '../utils/transactionRows';
import { loadPaymentComment, shouldShowPaymentComment } from '../utils/paymentComment';

const DIAGNOSTICS_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Payment status check timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

interface TransactionDetailsModalProps {
  transaction: Transaction | null;
  swapRow?: TransactionRow | null;
  activeWalletInfo: Parameters<typeof loadPaymentComment>[0];
  refreshTransactions: () => Promise<void>;
  onClose: () => void;
}

export function TransactionDetailsModal({
  transaction,
  swapRow = null,
  activeWalletInfo,
  refreshTransactions,
  onClose,
}: TransactionDetailsModalProps): React.JSX.Element | null {
  const { t } = useLanguage();
  const { formatTx } = useCurrency();
  const { themeMode } = useAppTheme();
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);
  const iconColor = getIconColor(themeMode);
  const [comment, setComment] = useState<string | null>(null);
  const [recipient, setRecipient] = useState<string | null>(null);
  const [diagnosticsAction, setDiagnosticsAction] = useState<'copy' | 'detailedLogs' | 'status' | null>(null);

  useEffect(() => {
    if (!transaction?.id) {
      setComment(null);
      setRecipient(null);
      return;
    }
    let active = true;
    const id = transaction.id;
    const commentPromise = transaction.type === 'receive'
      ? Promise.resolve(transaction.comment || null)
      : loadPaymentComment(activeWalletInfo, id);
    void commentPromise
      .then((value) => { if (active) setComment(value); })
      .catch(() => { if (active) setComment(null); });
    void AsyncStorage.getItem(`payment_recipient_${id}`)
      .then((value) => { if (active) setRecipient(value); })
      .catch(() => { if (active) setRecipient(null); });
    return () => { active = false; };
  }, [activeWalletInfo, transaction]);

  const showToast = useCallback((message: string, long = false): void => {
    if (Platform.OS === 'android' && ToastAndroid?.show) {
      ToastAndroid.show(message, long ? ToastAndroid.LONG : ToastAndroid.SHORT);
      return;
    }
    Alert.alert('ZapArc', message);
  }, []);

  const reconcile = useCallback(async (copy: boolean): Promise<void> => {
    if (!transaction?.id || diagnosticsAction) return;
    setDiagnosticsAction(copy ? 'copy' : 'status');
    try {
      const payload = await withTimeout(
        exportPaymentDiagnostics(transaction.id),
        DIAGNOSTICS_TIMEOUT_MS,
      );
      if (copy) {
        await Clipboard.setStringAsync(payload);
        showToast('Diagnostics copied');
      } else {
        const parsed = JSON.parse(payload) as { reconciliation?: string; zaparc?: { reconciliation?: string } };
        const messages: Record<string, string> = {
          completed_settled: 'Payment is completed and settled.',
          funds_reserved_until_expiry: 'Funds remain reserved until the listed expiry.',
          overdue_stuck_reconciliation: 'Payment is overdue. Copy diagnostics for support.',
          settling_or_claimable: 'Payment is still settling. Check again shortly.',
          funds_returned: 'Wallet sync confirms the funds were returned.',
          balance_sync_inconsistency: 'Wallet balance needs another sync before it can be confirmed.',
          failed_but_funds_still_reserved: 'Payment failed, but funds are still reserved.',
          unknown: 'The current wallet state could not be confirmed.',
        };
        showToast(messages[parsed.zaparc?.reconciliation || parsed.reconciliation || 'unknown'], true);
      }
      // Refresh the surrounding list without tying the action spinner to a
      // potentially slow screen-level refresh. The diagnostics export above
      // already performed the authoritative Breez sync for this payment.
      void refreshTransactions().catch(() => undefined);
    } catch {
      showToast('Payment status check timed out. Please try again.', true);
    } finally {
      setDiagnosticsAction(null);
    }
  }, [diagnosticsAction, refreshTransactions, showToast, transaction]);

  const copyDetailedSdkLogs = useCallback((): void => {
    if (!transaction?.id || diagnosticsAction) return;
    Alert.alert(
      'Export detailed SDK logs?',
      'This report contains detailed Breez SDK context for troubleshooting, including payment and device information. It will open as a JSON file that you can save or share with trusted support.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export detailed logs',
          style: 'destructive',
          onPress: () => {
            setDiagnosticsAction('detailedLogs');
            void exportDetailedSdkSupportLogs(transaction.id, transaction.timestamp)
              .then(async (payload) => {
                if (!FileSystem.cacheDirectory) {
                  throw new Error('Temporary file storage is unavailable');
                }
                if (!await Sharing.isAvailableAsync()) {
                  throw new Error('File sharing is unavailable on this device');
                }
                const fileUri = `${FileSystem.cacheDirectory}zaparc-sdk-logs-${transaction.id}-${Date.now()}.json`;
                await FileSystem.writeAsStringAsync(fileUri, payload, {
                  encoding: FileSystem.EncodingType.UTF8,
                });
                await Sharing.shareAsync(fileUri, {
                  mimeType: 'application/json',
                  dialogTitle: 'Export ZapArc detailed SDK logs',
                  UTI: 'public.json',
                });
              })
              .catch((error: unknown) => {
                const reason = error instanceof Error ? error.message : 'Unknown export error';
                showToast(`Detailed SDK logs could not be exported: ${reason}`, true);
              })
              .finally(() => setDiagnosticsAction(null));
          },
        },
      ],
    );
  }, [diagnosticsAction, showToast, transaction]);

  if (!transaction) return null;

  const tx = transaction;
  const isReceived = tx.type === 'receive';
  const method = swapRow?.isSwap ? 'swap' : (tx.method || (tx.txid ? 'onchain' : 'lightning'));
  const date = new Date(tx.timestamp);
  const formatted = formatTx(tx.amount ?? 0, isReceived, {
    asset: tx.asset === 'USDB' ? 'USDB' : 'BTC',
  });
  const claimStatusLabel = tx.onchainClaimState === 'confirming'
    ? tx.onchainConfirmations !== undefined && tx.onchainRequiredConfirmations
      ? t('deposit.statusConfirmingProgress', {
          count: tx.onchainConfirmations,
          required: tx.onchainRequiredConfirmations,
        })
      : t('deposit.statusConfirming')
    : tx.onchainClaimState === 'claiming'
      ? t('deposit.statusClaiming')
      : tx.onchainClaimState === 'retrying'
        ? t('deposit.statusRetrying')
        : tx.onchainClaimState === 'too-small'
          ? t('deposit.statusTooSmall')
          : null;
  const canReconcile = tx.status === 'failed' || tx.status === 'pending';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: primaryTextColor }]}>
              {t('wallet.transactionDetails')}
            </Text>
            <IconButton icon="close" iconColor={iconColor} size={24} onPress={onClose} />
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            <View style={styles.amountContainer}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>{method === 'onchain' ? '⛓️' : method === 'swap' ? '⇄' : '⚡'}</Text>
              </View>
              <Text style={[styles.amount, isReceived ? styles.received : styles.sent]}>
                {formatted.primary}
              </Text>
              {!!formatted.secondary && (
                <Text style={[styles.secondaryAmount, { color: secondaryTextColor }]}>{formatted.secondary}</Text>
              )}
              <Text style={[
                styles.status,
                tx.status === 'failed' ? styles.failed : tx.status === 'pending' ? styles.pending : styles.completed,
              ]}>
                {claimStatusLabel
                  ? `${tx.onchainClaimState === 'too-small' ? '⚠' : '⏳'} ${claimStatusLabel}`
                  : tx.status === 'failed'
                    ? `✕ ${t('wallet.statusFailed')}`
                    : tx.status === 'pending'
                      ? `⏳ ${t('wallet.statusPending')}`
                      : `✓ ${t('wallet.statusCompleted')}`}
              </Text>
            </View>

            <Divider style={styles.divider} />
            <View style={styles.details}>
              <DetailRow label={t('wallet.type')} value={isReceived ? t('wallet.received') : t('wallet.sent')} />
              <DetailRow label={t('wallet.method')} value={method === 'onchain' ? t('wallet.methodOnchain') : method === 'swap' ? t('swap.history.label') : t('wallet.methodLightning')} />
              <DetailRow label={t('wallet.date')} value={date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
              <DetailRow label={t('wallet.time')} value={date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} />
              {!isReceived && recipient && <DetailRow label={t('wallet.to')} value={recipient} copyable />}
              {!!tx.description && <DetailRow label={t('payments.description')} value={tx.description} />}
              {shouldShowPaymentComment(tx.description, comment) && <DetailRow label={t('wallet.comment')} value={comment || ''} />}
              {!!tx.failureReason && (tx.status === 'failed' || !!claimStatusLabel) && (
                <DetailRow label={claimStatusLabel ? t('deposit.statusDetails') : t('wallet.failureReason')} value={tx.failureReason} copyable />
              )}
              {tx.feeSats !== undefined && tx.feeSats > 0 && (
                <DetailRow label={t('wallet.fee')} value={tx.asset === 'USDB' ? `${(tx.feeSats / 1e6).toFixed(6)} USDB` : `${tx.feeSats.toLocaleString()} ${t('wallet.sats')}`} />
              )}
              {swapRow?.isSwap && swapRow.btcSide && swapRow.usdbSide && (
                <>
                  <DetailRow label={t('swap.youPay')} value={swapRow.swapDirection === 'BTC_TO_USDB' ? `${Number(swapRow.btcSide.amount || 0).toLocaleString()} sats` : `${(Number(swapRow.usdbSide.amount || 0) / 1e6).toLocaleString()} USDB`} />
                  <DetailRow label={t('swap.youReceive')} value={swapRow.swapDirection === 'BTC_TO_USDB' ? `${(Number(swapRow.usdbSide.amount || 0) / 1e6).toLocaleString()} USDB` : `${Number(swapRow.btcSide.amount || 0).toLocaleString()} sats`} />
                </>
              )}
              {!!tx.id && <DetailRow label={t('wallet.paymentId')} value={String(tx.id)} copyable />}
              {!!tx.tokenIdentifier && <DetailRow label={t('wallet.token')} value={String(tx.tokenIdentifier)} copyable />}
              {method === 'onchain' && !!tx.txid && (
                <>
                  <DetailRow label="TXID" value={tx.txid} copyable />
                  <TouchableOpacity onPress={() => void Linking.openURL(`https://mempool.space/tx/${tx.txid}`)}>
                    <Text style={styles.mempool}>{t('wallet.viewOnMempool')}</Text>
                  </TouchableOpacity>
                </>
              )}
              {!!tx.paymentHash && <DetailRow label={t('wallet.paymentHash')} value={tx.paymentHash} copyable />}
            </View>

            <View style={styles.supportSection}>
              <Text style={[styles.supportTitle, { color: primaryTextColor }]}>Payment diagnostics</Text>
              <Text style={[styles.supportText, { color: secondaryTextColor }]}>
                Copy a privacy-safe payment report, or detailed Breez SDK logs when support needs broader troubleshooting context. Checking status syncs the wallet with Breez and rechecks this payment, reserved funds, and the displayed balance.
              </Text>
              <Button mode="outlined" icon="content-copy" loading={diagnosticsAction === 'copy'} disabled={diagnosticsAction !== null} onPress={() => void reconcile(true)}>
                Copy diagnostics
              </Button>
              <Button mode="outlined" icon="file-export-outline" loading={diagnosticsAction === 'detailedLogs'} disabled={diagnosticsAction !== null} onPress={copyDetailedSdkLogs}>
                Export detailed SDK logs
              </Button>
              {canReconcile && (
                <Button mode="contained-tonal" icon="sync" loading={diagnosticsAction === 'status'} disabled={diagnosticsAction !== null} onPress={() => void reconcile(false)}>
                  Check payment status
                </Button>
              )}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Button mode="outlined" onPress={onClose} contentStyle={styles.closeContent} labelStyle={{ color: primaryTextColor }}>
              {t('common.close')}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }): React.JSX.Element {
  const { themeMode } = useAppTheme();
  const primaryTextColor = getPrimaryTextColor(themeMode);
  const secondaryTextColor = getSecondaryTextColor(themeMode);
  const iconColor = getIconColor(themeMode);
  const copy = async (): Promise<void> => {
    if (!copyable) return;
    await Clipboard.setStringAsync(value);
    if (Platform.OS === 'android' && ToastAndroid?.show) ToastAndroid.show('Copied', ToastAndroid.SHORT);
  };
  return (
    <TouchableOpacity style={styles.row} activeOpacity={copyable ? 0.65 : 1} onPress={() => void copy()}>
      <Text style={[styles.label, { color: secondaryTextColor }]}>{label}</Text>
      <View style={styles.valueWrap}>
        <Text style={[styles.value, { color: primaryTextColor }]} numberOfLines={1} ellipsizeMode="middle">{value}</Text>
        {copyable && <IconButton icon="content-copy" iconColor={iconColor} size={16} onPress={() => void copy()} style={styles.copyIcon} />}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: 16 },
  sheet: { maxHeight: '92%', minHeight: 420, backgroundColor: '#17182b', borderRadius: 24, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 22, paddingRight: 8, paddingTop: 10 },
  title: { fontSize: 22, fontWeight: '700' },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingBottom: 18 },
  amountContainer: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 18 },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,140,38,0.15)', marginBottom: 12 },
  iconText: { fontSize: 30 },
  amount: { fontSize: 34, fontWeight: '700' },
  secondaryAmount: { fontSize: 16, marginTop: 4 },
  received: { color: '#4CAF50' }, sent: { color: '#ff6577' },
  status: { fontSize: 16, marginTop: 10 }, completed: { color: '#4CAF50' }, pending: { color: '#ffb74d' }, failed: { color: '#ff6577' },
  divider: { marginHorizontal: 20, marginBottom: 14 },
  details: { paddingHorizontal: 20 },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)', gap: 12 },
  label: { flex: 0.42, fontSize: 15 },
  valueWrap: { flex: 0.58, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  value: { flexShrink: 1, fontSize: 15, textAlign: 'right' },
  copyIcon: { margin: 0, marginLeft: 2 },
  mempool: { color: BRAND_COLOR, textAlign: 'right', paddingVertical: 12 },
  supportSection: { margin: 20, marginBottom: 4, padding: 16, gap: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.045)' },
  supportTitle: { fontSize: 16, fontWeight: '700' },
  supportText: { fontSize: 13, lineHeight: 19, marginBottom: 2 },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)', backgroundColor: '#17182b' },
  closeContent: { minHeight: 46 },
});
