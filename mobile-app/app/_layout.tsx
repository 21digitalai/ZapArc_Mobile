import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { initializeDeepLinking } from '../src/utils/deepLinking';
import { syncAllFromCache } from '../src/services/notificationSubscriptionService';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { LanguageProvider } from '../src/contexts/LanguageContext';
import { WalletProvider } from '../src/contexts/WalletContext';
import { FeedbackProvider } from '../src/features/wallet/components/FeedbackComponents';
import { initializeTlsPinning } from '../src/services/tlsPinningService';
import { installGlobalErrorHandler } from '../src/utils/globalErrorSink';

// Install before React mounts: catches errors thrown by import-time
// initialisers and any background promise that escapes a try/catch.
// Routes through the FeedbackProvider's Snackbar once it registers.
installGlobalErrorHandler();

/**
 * Clear the app icon badge. iOS keeps the badge counter sticky after a push
 * with `aps.badge` arrives, even if the user dismisses the drawer notification
 * — nothing clears it unless the app explicitly resets to 0. Call on launch
 * and on every foreground.
 */
async function clearAppIconBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (err) {
    // Non-fatal — badge clear shouldn't ever block the app.
    if (__DEV__) console.warn('⚠️ [Layout] Failed to clear app icon badge:', err);
  }
}

export default function RootLayout(): React.JSX.Element {
  useEffect(() => {
    // Initialize deep linking when the app starts
    initializeDeepLinking();

    // Sync push notification subscriptions from cached lightning addresses.
    // This registers all wallets with the backend in one shot, no SDK init needed.
    syncAllFromCache().catch((e) =>
      console.warn('⚠️ [Layout] Notification sync failed:', e)
    );

    initializeTlsPinning().catch((e) =>
      console.warn('⚠️ [Layout] TLS pinning init failed:', e)
    );

    // Clear sticky app icon badge on launch and every time the app comes back
    // to the foreground.
    clearAppIconBadge();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        clearAppIconBadge();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <WalletProvider>
            <FeedbackProvider>
              {/* Status bar with light content (white text/icons) for dark theme */}
              <StatusBar style="light" translucent backgroundColor="transparent" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: 'slide_from_right',
                }}
              >
                <Stack.Screen
                  name="index"
                  options={{
                    animation: 'none',
                    gestureEnabled: false
                  }}
                />
                <Stack.Screen
                  name="wallet"
                  options={{
                    headerShown: false,
                  }}
                />
                <Stack.Screen
                  name="auth"
                  options={{
                    animation: 'none',
                    gestureEnabled: false
                  }}
                />
                <Stack.Screen name="(main)" options={{ headerShown: false }} />
              </Stack>
            </FeedbackProvider>
          </WalletProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
