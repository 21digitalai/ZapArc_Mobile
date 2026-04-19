import type { ImageSourcePropType } from 'react-native';

export type SwapTokenConfig = {
  id: 'USDB';
  ticker: string;
  label: string;
  displayDecimals: number;
  icon?: ImageSourcePropType;
};

export interface ResolvedSwapToken extends SwapTokenConfig {
  tokenIdentifier: string;
  internalDecimals: number;
}

export const SWAP_TOKENS: readonly SwapTokenConfig[] = [
  { id: 'USDB', ticker: 'USDB', label: 'USDB', displayDecimals: 2 },
] as const;

export const USDB_TOKEN = SWAP_TOKENS[0];
