import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SwapScreen } from '../../src/features/wallet/screens/SwapScreen';
import type { SwapDirection } from '../../src/services/breezSparkService';

function parseDirection(value: unknown): SwapDirection {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === 'USDB_TO_BTC' || normalized === 'BTC_TO_USDB') {
    return normalized;
  }
  return 'BTC_TO_USDB';
}

export default function SwapRoute() {
  const params = useLocalSearchParams<{ direction?: string | string[] }>();
  const direction = parseDirection(params.direction);

  return <SwapScreen initialDirection={direction} />;
}
