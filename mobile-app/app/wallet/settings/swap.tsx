import React, { useEffect } from 'react';
import { router } from 'expo-router';

import { SwapSettingsScreen } from '../../../src/features/wallet/screens/settings/SwapSettingsScreen';
import { SWAP_FEATURE_ENABLED } from '../../../src/config/features';

export default function SwapSettingsRoute() {
  // Swap feature is gated for App Store compliance — bounce any direct
  // navigation back to the settings root.
  useEffect(() => {
    if (!SWAP_FEATURE_ENABLED) {
      router.replace('/wallet/settings');
    }
  }, []);

  if (!SWAP_FEATURE_ENABLED) {
    return null;
  }

  return <SwapSettingsScreen />;
}
