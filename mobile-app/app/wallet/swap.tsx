import React, { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';

import { SwapScreen } from '../../src/features/wallet/screens/SwapScreen';
import type { SwapDirection } from '../../src/services/breezSparkService';
import { SWAP_FEATURE_ENABLED } from '../../src/config/features';

function parseDirection(asset: unknown, direction: unknown): SwapDirection {
  const normalizedAsset = Array.isArray(asset) ? asset[0] : asset;
  if (normalizedAsset === 'USDB') {
    return 'USDB_TO_BTC';
  }
  if (normalizedAsset === 'BTC') {
    return 'BTC_TO_USDB';
  }

  const normalizedDirection = Array.isArray(direction) ? direction[0] : direction;
  if (normalizedDirection === 'USDB_TO_BTC' || normalizedDirection === 'BTC_TO_USDB') {
    return normalizedDirection;
  }

  return 'BTC_TO_USDB';
}

export default function SwapRoute() {
  const params = useLocalSearchParams<{ asset?: string | string[]; direction?: string | string[] }>();

  // Swap feature is gated for App Store compliance (see src/config/features.ts).
  // Redirect any deep-link / orphaned navigation back to home so the swap UI
  // is genuinely unreachable when the flag is off.
  useEffect(() => {
    if (!SWAP_FEATURE_ENABLED) {
      router.replace('/wallet/home');
    }
  }, []);

  if (!SWAP_FEATURE_ENABLED) {
    return null;
  }

  const direction = parseDirection(params.asset, params.direction);
  return <SwapScreen initialDirection={direction} />;
}
