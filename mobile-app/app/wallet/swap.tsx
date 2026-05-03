import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SwapScreen } from '../../src/features/wallet/screens/SwapScreen';
import type { SwapDirection } from '../../src/services/breezSparkService';

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
  const direction = parseDirection(params.asset, params.direction);

  return <SwapScreen initialDirection={direction} />;
}
