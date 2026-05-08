/**
 * Asset Registry
 * --------------
 *
 * Central, statically-defined metadata for every asset the wallet knows
 * about. Today this is just BTC + USDB; tomorrow we'll extend it with
 * USDC, USDT and other Spark/Flashnet tokens — either by adding new
 * entries here or by merging in dynamically-discovered tokens fetched via
 * Breez SDK's `getTokensMetadata`.
 *
 * The registry is the single source of truth for everything UI-facing
 * about an asset (display name, ticker, color, whether it's a stablecoin).
 * It is NOT the source of truth for balances — those live in the wallet
 * service / SDK.
 *
 * **Why a string ticker instead of a richer enum?**  Most existing code
 * uses the literal `'BTC'` / `'USDB'` and persisting it to AsyncStorage
 * via the settings service is much simpler when it's a string. Consumers
 * that need richer metadata look it up via `getAssetMeta(ticker)`.
 */
export type AssetTicker = string;

export type AssetMeta = {
  /** Stable string id used as the active-asset key everywhere. */
  ticker: AssetTicker;
  /** Human-readable name shown in pickers ("Bitcoin", "USD Bitcoin"). */
  name: string;
  /** Spark token identifier (btkn1…). Undefined for native BTC. */
  tokenIdentifier?: string;
  /** Number of decimal places the underlying value uses. */
  decimals: number;
  /** Brand color used for the round icon. */
  color: string;
  /** Glyph rendered inside the round icon (single character). */
  symbol: string;
  /** Categorisation flag — drives "Stablecoins" group, sort order, etc. */
  isStablecoin: boolean;
  /**
   * Order in pickers + tab bars. Lower = earlier. BTC stays first; new
   * stablecoins land after USDB.
   */
  sortOrder: number;
};

const REGISTRY: Record<AssetTicker, AssetMeta> = {
  BTC: {
    ticker: 'BTC',
    name: 'Bitcoin',
    decimals: 8,
    color: '#F7931A',
    symbol: '₿',
    isStablecoin: false,
    sortOrder: 0,
  },
  USDB: {
    ticker: 'USDB',
    name: 'USDB',
    tokenIdentifier:
      // Mirrors EXPO_PUBLIC_USDB_TOKEN_IDENTIFIER. Hardcoded as fallback so
      // the registry remains usable even before env is loaded.
      'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87',
    decimals: 6,
    color: '#2775CA',
    symbol: '$',
    isStablecoin: true,
    sortOrder: 10,
  },
};

/** All registered tickers in sort order. */
export function getAllTickers(): AssetTicker[] {
  return Object.values(REGISTRY)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => m.ticker);
}

/** All asset metadata in sort order. */
export function getAllAssets(): AssetMeta[] {
  return Object.values(REGISTRY).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Look up metadata for a ticker. Falls back to a synthesised "unknown"
 * entry rather than throwing — better UX in the rare case the saved active
 * ticker references an asset we no longer support.
 */
export function getAssetMeta(ticker: AssetTicker): AssetMeta {
  return (
    REGISTRY[ticker] ?? {
      ticker,
      name: ticker,
      decimals: 0,
      color: '#888',
      symbol: '?',
      isStablecoin: false,
      sortOrder: 999,
    }
  );
}

/** Convenience for screens that need to know whether an asset is a token. */
export function isTokenAsset(ticker: AssetTicker): boolean {
  return !!REGISTRY[ticker]?.tokenIdentifier;
}
