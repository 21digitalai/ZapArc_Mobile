// PinLockoutBanner
//
// Surfaces the current PIN-lockout state on screens where the user might
// otherwise think a control "doesn't work" (Security Settings / general
// Settings). The lockout itself is enforced inside `storageService` and
// historically only shown on the unlock screen — leaving everyone else
// guessing why their toggle didn't move. This banner fills that gap.
//
// The banner polls `getPinAuthStatus` every second while the screen is
// mounted so the countdown updates live. We deliberately do not silently
// swallow errors here: any failure to read the lockout state goes
// through reportError() so the user sees that something abnormal is
// happening rather than a frozen UI.

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useWalletAuth } from '../../../hooks/useWalletAuth';
import type { PinAuthStatus } from '../../../services/storageService';
import { reportError } from '../../../utils/globalErrorSink';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function PinLockoutBanner(): React.JSX.Element | null {
  const { getPinAuthStatus, currentMasterKeyId } = useWalletAuth();
  const [status, setStatus] = useState<PinAuthStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getPinAuthStatus();
      setStatus(next);
    } catch (err) {
      // Surface the failure instead of swallowing — if the keystore
      // read is the actual culprit, we want the user to know.
      reportError('Could not read PIN lockout state', err);
    }
  }, [getPinAuthStatus]);

  // Initial read on mount + whenever the wallet identity changes.
  useEffect(() => {
    void refresh();
  }, [refresh, currentMasterKeyId]);

  // Tick once a second while the lockout is active so the countdown
  // is live. Stop ticking when there's no active lockout to avoid
  // burning cycles needlessly.
  useEffect(() => {
    if (!status?.isLocked) return;
    const interval = setInterval(() => {
      void refresh();
    }, 1000);
    return () => clearInterval(interval);
  }, [status?.isLocked, refresh]);

  if (!status || !status.isLocked) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>Account temporarily locked</Text>
      <Text style={styles.subtitle}>
        Too many failed PIN attempts. Try again in {formatRemaining(status.remainingMs)}.
        {status.failedAttempts > 0 ? ` (${status.failedAttempts} failed attempts on record.)` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(244, 67, 54, 0.12)',
    borderColor: 'rgba(244, 67, 54, 0.4)',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  title: {
    color: '#f44336',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 13,
    lineHeight: 18,
  },
});
