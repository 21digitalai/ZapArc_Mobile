import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { claimLnurlWithdraw, getPayment, resolveLnurlWithdraw, type LnurlWithdrawClaim } from '../../src/services/breezSparkService';
import { BRAND_COLOR, getAppBackgroundColor, getPrimaryTextColor } from '../../src/utils/theme-helpers';
import { useAppTheme } from '../../src/contexts/ThemeContext';
import { t } from '../../src/services/i18nService';
import { useWallet } from '../../src/hooks/useWallet';

const PENDING_RECEIVE_CLAIM_KEY = '@zap_arc/pending_receive_claim_v1';

type PendingReceiveClaim = {
  paymentId: string;
  walletKey: string;
};

function pendingClaimWalletKey(wallet: { masterKeyId: string; subWalletIndex: number } | null): string | null {
  return wallet ? `${wallet.masterKeyId}:${wallet.subWalletIndex}` : null;
}

function pendingClaimStorageKey(walletKey: string): string {
  return `${PENDING_RECEIVE_CLAIM_KEY}_${encodeURIComponent(walletKey)}`;
}

export default function ReceiveClaimScreen(): React.JSX.Element {
  const { lnurl } = useLocalSearchParams<{ lnurl?: string }>();
  const { themeMode } = useAppTheme();
  const { activeWalletInfo, refreshBalance, refreshTransactions } = useWallet();
  const [claim, setClaim] = useState<LnurlWithdrawClaim | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'received' | 'pending' | null>(null);
  const textColor = getPrimaryTextColor(themeMode);
  const walletKey = pendingClaimWalletKey(activeWalletInfo);
  const walletKeyRef = useRef(walletKey);

  useEffect(() => {
    walletKeyRef.current = walletKey;
  }, [walletKey]);

  const reconcilePendingClaim = useCallback(async (paymentId: string, expectedWalletKey: string): Promise<void> => {
    if (walletKeyRef.current !== expectedWalletKey) return;
    const payment = await getPayment(paymentId);
    if (walletKeyRef.current !== expectedWalletKey) return;
    if (payment?.type === 'receive' && payment.status === 'completed') {
      await AsyncStorage.removeItem(pendingClaimStorageKey(expectedWalletKey));
      await Promise.all([refreshBalance(), refreshTransactions()]);
      if (walletKeyRef.current !== expectedWalletKey) return;
      setOutcome('received');
      return;
    }
    if (payment?.type === 'receive' && payment.status === 'failed') {
      await AsyncStorage.removeItem(pendingClaimStorageKey(expectedWalletKey));
      setError(t('receiveClaim.unavailable'));
      return;
    }
    setOutcome('pending');
  }, [refreshBalance, refreshTransactions]);

  useEffect(() => {
    if (!walletKey) return;
    let cancelled = false;
    AsyncStorage.getItem(pendingClaimStorageKey(walletKey)).then((raw) => {
      if (cancelled) return;
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingReceiveClaim;
      if (pending.walletKey === walletKey && pending.paymentId) {
        setOutcome('pending');
        return reconcilePendingClaim(pending.paymentId, walletKey);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [reconcilePendingClaim, walletKey]);

  useEffect(() => {
    if (!lnurl) { setError(t('receiveClaim.missing')); setLoading(false); return; }
    resolveLnurlWithdraw(lnurl).then((resolved) => {
      setClaim(resolved);
      setAmount(resolved.minSats === resolved.maxSats ? String(resolved.minSats) : String(resolved.maxSats));
    }).catch(() => setError(t('receiveClaim.invalid')))
      .finally(() => setLoading(false));
  }, [lnurl]);

  const confirmClaim = useCallback(async () => {
    if (!claim || submitting) return;
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats)) { setError(t('receiveClaim.wholeAmount')); return; }
    let submittedPaymentId: string | null = null;
    setSubmitting(true); setError(null);
    try {
      const result = await claimLnurlWithdraw(claim, sats);
      if (!result.paymentId || !walletKey) {
        setOutcome('pending');
        return;
      }
      submittedPaymentId = result.paymentId;
      await AsyncStorage.setItem(pendingClaimStorageKey(walletKey), JSON.stringify({ paymentId: result.paymentId, walletKey }));
      await reconcilePendingClaim(result.paymentId, walletKey);
    } catch {
      // A claim with a payment ID was accepted by the provider. A failed
      // follow-up lookup must stay pending so the QR cannot be submitted again.
      if (submittedPaymentId) setOutcome('pending');
      else setError(t('receiveClaim.unavailable'));
    } finally { setSubmitting(false); }
  }, [amount, claim, reconcilePendingClaim, submitting, walletKey]);

  return <SafeAreaView style={[styles.page, { backgroundColor: getAppBackgroundColor(themeMode) }]}>
    <Text variant="headlineSmall" style={{ color: textColor }}>{t('receiveClaim.title')}</Text>
    {loading ? <Text style={{ color: textColor }}>{t('receiveClaim.loading')}</Text> : error && !claim ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button mode="outlined" onPress={() => router.back()}>{t('receiveClaim.scanAnother')}</Button>
    </> : outcome ? <>
      <Text accessibilityRole="alert" style={{ color: textColor }}>{t(outcome === 'received' ? 'receiveClaim.received' : 'receiveClaim.pending')}</Text>
      <Button mode="contained" onPress={() => router.replace('/wallet/home')} buttonColor={BRAND_COLOR}>{t('common.done')}</Button>
    </> : claim ? <>
      <Text style={{ color: textColor }}>{claim.description}</Text>
      <Text style={{ color: textColor }}>{t('receiveClaim.destinationAmount', {
        amount: claim.minSats === claim.maxSats
          ? String(claim.minSats)
          : `${claim.minSats}–${claim.maxSats}`,
      })}</Text>
      <TextInput label={t('receiveClaim.amount')} value={amount} onChangeText={setAmount} keyboardType="number-pad" disabled={submitting} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button mode="contained" onPress={confirmClaim} loading={submitting} disabled={submitting} buttonColor={BRAND_COLOR}>{t('receiveClaim.claim')}</Button>
      <Button mode="text" onPress={() => router.back()} disabled={submitting}>{t('receiveClaim.cancel')}</Button>
    </> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1, gap: 18, padding: 24 }, error: { color: '#c62828' } });
