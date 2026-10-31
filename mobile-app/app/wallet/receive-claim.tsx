import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { claimLnurlWithdraw, getPayment, resolveLnurlWithdraw, type LnurlWithdrawClaim } from '../../src/services/breezSparkService';
import { BRAND_COLOR, getAppBackgroundColor, getPrimaryTextColor } from '../../src/utils/theme-helpers';
import { useAppTheme } from '../../src/contexts/ThemeContext';
import { t } from '../../src/services/i18nService';
import { useWallet } from '../../src/hooks/useWallet';

export default function ReceiveClaimScreen(): React.JSX.Element {
  const { lnurl } = useLocalSearchParams<{ lnurl?: string }>();
  const { themeMode } = useAppTheme();
  const { refreshBalance, refreshTransactions } = useWallet();
  const [claim, setClaim] = useState<LnurlWithdrawClaim | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'received' | 'pending' | null>(null);
  const textColor = getPrimaryTextColor(themeMode);

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
      await Promise.all([refreshBalance(), refreshTransactions()]);
      const payment = result.paymentId ? await getPayment(result.paymentId) : null;
      setOutcome(payment?.type === 'receive' && payment.status === 'completed' ? 'received' : 'pending');
    } catch {
      setError(t('receiveClaim.unavailable'));
    } finally { setSubmitting(false); }
  }, [amount, claim, refreshBalance, refreshTransactions, submitting]);

  return <SafeAreaView style={[styles.page, { backgroundColor: getAppBackgroundColor(themeMode) }]}>
    <Text variant="headlineSmall" style={{ color: textColor }}>{t('receiveClaim.title')}</Text>
    {loading ? <Text style={{ color: textColor }}>{t('receiveClaim.loading')}</Text> : error && !claim ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button mode="outlined" onPress={() => router.back()}>{t('receiveClaim.scanAnother')}</Button>
    </> : outcome ? <>
      <Text accessibilityRole="alert" style={{ color: textColor }}>{t(outcome === 'received' ? 'receiveClaim.received' : 'receiveClaim.pending')}</Text>
      <Button mode="contained" onPress={() => router.replace('/wallet/home')} buttonColor={BRAND_COLOR}>{t('common.done')}</Button>
    </> : claim ? <>
      <Text style={{ color: textColor }}>{claim.description}</Text>
      <Text style={{ color: textColor }}>This QR can receive {claim.minSats === claim.maxSats ? `${claim.minSats} sats` : `${claim.minSats}–${claim.maxSats} sats`} into your current wallet.</Text>
      <TextInput label={t('receiveClaim.amount')} value={amount} onChangeText={setAmount} keyboardType="number-pad" disabled={submitting} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button mode="contained" onPress={confirmClaim} loading={submitting} disabled={submitting} buttonColor={BRAND_COLOR}>{t('receiveClaim.claim')}</Button>
      <Button mode="text" onPress={() => router.back()} disabled={submitting}>{t('receiveClaim.cancel')}</Button>
    </> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1, gap: 18, padding: 24 }, error: { color: '#c62828' } });
