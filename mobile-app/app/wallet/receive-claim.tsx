import React, { useCallback, useEffect, useState } from 'react';
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

  const reconcilePendingClaim = useCallback(async (paymentId: string): Promise<void> => {
    const payment = await getPayment(paymentId);
    if (payment?.type === 'receive' && payment.status === 'completed') {
      await AsyncStorage.removeItem(PENDING_RECEIVE_CLAIM_KEY);
      await Promise.all([refreshBalance(), refreshTransactions()]);
      setOutcome('received');
      return;
    }
    if (payment?.type === 'receive' && payment.status === 'failed') {
      await AsyncStorage.removeItem(PENDING_RECEIVE_CLAIM_KEY);
      setError(t('receiveClaim.unavailable'));
      return;
    }
    setOutcome('pending');
  }, [refreshBalance, refreshTransactions]);

  useEffect(() => {
    if (!walletKey) return;
    AsyncStorage.getItem(PENDING_RECEIVE_CLAIM_KEY).then((raw) => {
      if (!raw) return;
      const pending = JSON.parse(raw) as PendingReceiveClaim;
      if (pending.walletKey === walletKey && pending.paymentId) {
        return reconcilePendingClaim(pending.paymentId);
      }
    }).catch(() => undefined);
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
    setSubmitting(true); setError(null);
    try {
      const result = await claimLnurlWithdraw(claim, sats);
      if (!result.paymentId || !walletKey) {
        setOutcome('pending');
        return;
      }
      await AsyncStorage.setItem(PENDING_RECEIVE_CLAIM_KEY, JSON.stringify({ paymentId: result.paymentId, walletKey }));
      await reconcilePendingClaim(result.paymentId);
    } catch {
      setError(t('receiveClaim.unavailable'));
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
      <Text style={{ color: textColor }}>{t('receiveClaim.destination')} {claim.minSats === claim.maxSats ? `${claim.minSats} sats` : `${claim.minSats}–${claim.maxSats} sats`}.</Text>
      <TextInput label={t('receiveClaim.amount')} value={amount} onChangeText={setAmount} keyboardType="number-pad" disabled={submitting} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button mode="contained" onPress={confirmClaim} loading={submitting} disabled={submitting} buttonColor={BRAND_COLOR}>{t('receiveClaim.claim')}</Button>
      <Button mode="text" onPress={() => router.back()} disabled={submitting}>{t('receiveClaim.cancel')}</Button>
    </> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1, gap: 18, padding: 24 }, error: { color: '#c62828' } });
