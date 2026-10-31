import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Text, TextInput } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { claimLnurlWithdraw, resolveLnurlWithdraw, type LnurlWithdrawClaim } from '../../src/services/breezSparkService';
import { BRAND_COLOR, getAppBackgroundColor, getPrimaryTextColor } from '../../src/utils/theme-helpers';
import { useAppTheme } from '../../src/contexts/ThemeContext';

export default function ReceiveClaimScreen(): React.JSX.Element {
  const { lnurl } = useLocalSearchParams<{ lnurl?: string }>();
  const { themeMode } = useAppTheme();
  const [claim, setClaim] = useState<LnurlWithdrawClaim | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const textColor = getPrimaryTextColor(themeMode);

  useEffect(() => {
    if (!lnurl) { setError('This receive claim is missing its QR data. Scan it again.'); setLoading(false); return; }
    resolveLnurlWithdraw(lnurl).then((resolved) => {
      setClaim(resolved);
      setAmount(resolved.minSats === resolved.maxSats ? String(resolved.minSats) : String(resolved.maxSats));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not validate this receive claim.'))
      .finally(() => setLoading(false));
  }, [lnurl]);

  const confirmClaim = useCallback(async () => {
    if (!claim || submitting) return;
    const sats = Number(amount);
    if (!Number.isSafeInteger(sats)) { setError('Enter a whole number of sats.'); return; }
    setSubmitting(true); setError(null);
    try {
      const result = await claimLnurlWithdraw(claim, sats);
      const message = result.status === 'completed'
        ? `${sats} sats arrived in your wallet.`
        : 'The provider accepted the claim, but settlement is pending. Refresh your wallet before trying this QR again.';
      Alert.alert(result.status === 'completed' ? 'Sats received' : 'Claim submitted', message, [{ text: 'Done', onPress: () => router.replace('/wallet/home') }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not claim these sats. The QR may be expired, already claimed, or temporarily unavailable.');
    } finally { setSubmitting(false); }
  }, [amount, claim, submitting]);

  return <SafeAreaView style={[styles.page, { backgroundColor: getAppBackgroundColor(themeMode) }]}>
    <Text variant="headlineSmall" style={{ color: textColor }}>Receive sats</Text>
    {loading ? <Text style={{ color: textColor }}>Checking receive claim…</Text> : error && !claim ? <>
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button mode="outlined" onPress={() => router.back()}>Scan another QR</Button>
    </> : claim ? <>
      <Text style={{ color: textColor }}>{claim.description}</Text>
      <Text style={{ color: textColor }}>This QR can receive {claim.minSats === claim.maxSats ? `${claim.minSats} sats` : `${claim.minSats}–${claim.maxSats} sats`} into your current wallet.</Text>
      <TextInput label="Amount (sats)" value={amount} onChangeText={setAmount} keyboardType="number-pad" disabled={submitting} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Button mode="contained" onPress={confirmClaim} loading={submitting} disabled={submitting} buttonColor={BRAND_COLOR}>Claim sats</Button>
      <Button mode="text" onPress={() => router.back()} disabled={submitting}>Cancel</Button>
    </> : null}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ page: { flex: 1, gap: 18, padding: 24 }, error: { color: '#c62828' } });
