// Breez SDK Spark Service
// Lightning wallet operations using Breez SDK Nodeless (Spark Implementation)
//
// NOTE: This service requires native modules. It will work in:
// - Development builds (npx expo run:android)
// - Production builds
import { BREEZ_API_KEY, BREEZ_STORAGE_DIR } from '../config';
import { getExchangeRates, getCachedRates } from '../utils/currency';
import { SWAP_TOKENS, type ResolvedSwapToken } from '../config/swapTokens';
// Push notifications now flow via Breez's webhook registration + relay.
// Foreground UX still comes from the local notification/event listeners.

// =============================================================================
// SDK Error Extraction Helper
// =============================================================================

/**
 * Extract a human-readable error message from SDK errors.
 * SDK errors may not be standard Error instances — they can be uniffi enum objects
 * with properties like .message, .variant, .code, .inner, etc.
 */
export function extractSdkErrorMessage(error: unknown, fallback = 'Payment failed'): string {
  if (!error) return fallback;

  // Standard Error
  if (error instanceof Error) {
    return error.message || fallback;
  }

  // SDK error objects with various shapes
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;

    // Try common properties
    const message = e.message || e.msg || e.description;
    if (typeof message === 'string' && message.length > 0) return message;

    // uniffi enum errors: { variant: 'SparkError', inner: { message: '...' } }
    if (e.inner && typeof e.inner === 'object') {
      const inner = e.inner as Record<string, unknown>;
      if (typeof inner.message === 'string') {
        const variant = typeof e.variant === 'string' ? `${e.variant}: ` : '';
        return `${variant}${inner.message}`;
      }
    }

    // { variant: 'SparkError' } without inner
    if (typeof e.variant === 'string') {
      const code = typeof e.code === 'string' ? ` (${e.code})` : '';
      return `${e.variant}${code}`;
    }

    // toString fallback
    const str = String(error);
    if (str !== '[object Object]') return str;
  }

  if (typeof error === 'string') return error;

  return fallback;
}

/**
 * Extract full debug details from an SDK error for logging/display.
 */
function extractSdkErrorDetails(error: unknown): string {
  if (!error) return 'No error details';

  const parts: string[] = [];
  const str = String(error);
  if (str !== '[object Object]') parts.push(str);

  if (error instanceof Error) {
    if (error.stack) parts.push(`Stack: ${error.stack}`);
  }

  if (typeof error === 'object' && error !== null) {
    for (const key of Object.keys(error)) {
      const val = (error as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) {
        parts.push(`${key}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`);
      }
    }
  }

  return parts.join('\n') || 'No error details';
}

// =============================================================================
// Types
// =============================================================================

export interface WalletBalance {
  balanceSat: number;
  pendingSendSat: number;
  pendingReceiveSat: number;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  error?: string;
  errorDetails?: string;
}

export interface ReceivePaymentResult {
  paymentRequest: string;
  feeSat: number;
}

export interface TransactionInfo {
  id: string;
  type: 'send' | 'receive';
  amountSat: number;
  feeSat: number;
  status: 'pending' | 'completed' | 'failed';
  timestamp: number;
  description?: string;
  paymentRequest?: string;
  method?: 'lightning' | 'onchain';
  txid?: string;
  failureReason?: string;
  paymentType?: string;
  asset?: 'BTC' | 'USDB';
  tokenIdentifier?: string;
  /** 'swap' for token conversions, 'payment' for regular send/receive. */
  kind?: 'swap' | 'payment';
  /** Populated when kind === 'swap' — carries both sides of the conversion. */
  swap?: {
    direction: 'BTC_TO_USDB' | 'USDB_TO_BTC';
    fromAsset: 'BTC' | 'USDB';
    fromAmount: number;
    fromFee?: number;
    toAsset: 'BTC' | 'USDB';
    toAmount: number;
    toFee?: number;
  };
}

export interface DepositInfo {
  txid: string;
  vout: number;
  amountSats: number;
  claimError?: unknown;
}

export interface LightningAddressInfo {
  lightningAddress: string;  // Full address: username@domain
  username: string;          // Username part only
  description: string;       // Description/display name
  lnurl: string;            // LNURL representation
}

export type SwapDirection = 'BTC_TO_USDB' | 'USDB_TO_BTC';

export interface SwapLimits {
  min: bigint;
  max: bigint;
}


export interface PrepareSwapParams {
  direction: SwapDirection;
  amount: bigint;
  slippageBps: number;
}

export interface SwapQuote {
  direction: SwapDirection;
  amount: bigint;                 // user's input amount (sats for BTC→USDB, USDB base units for USDB→BTC)
  slippageBps: number;
  // Amounts from the SDK's conversionEstimate. For BTC→USDB:
  //   payAmount = actual sats SDK will charge (from amountIn)
  //   receiveAmount = USDB base units user receives (from amountOut)
  //   feeSat = fee in sats
  // For USDB→BTC:
  //   payAmount = USDB base units SDK will deduct
  //   receiveAmount = sats user receives
  //   feeSat = fee in USDB base units (naming kept for back-compat)
  payAmount: bigint;
  receiveAmount: bigint;
  feeSat: bigint;
  rate: number;
  usdbDecimals: number;           // for UI formatting of USDB amounts
  preparedPayment: unknown;
}

export interface SwapResult {
  paymentId?: string;
  /**
   * Raw Payment object returned by the SDK's sendPayment call. Carries the
   * authoritative post-swap amounts + tokenIdentifier so the caller can
   * optimistically update UI state without waiting for the next listPayments
   * round-trip.
   */
  payment?: unknown;
  /**
   * Direction of the swap — needed by callers that apply optimistic deltas
   * to separate BTC/USDB balance buckets.
   */
  direction?: SwapDirection;
  /**
   * Sats spent (BTC_TO_USDB) or USDB base units spent (USDB_TO_BTC). Pulled
   * from conversionEstimate.amountIn.
   */
  spent?: bigint;
  /**
   * USDB base units received (BTC_TO_USDB) or sats received (USDB_TO_BTC).
   * Pulled from conversionEstimate.amountOut — i.e. AMM's estimated delivery
   * (matches what actually lands in the wallet, within slippage tolerance).
   */
  received?: bigint;
}

export type SwapOutcome =
  | { kind: 'success'; result: SwapResult }
  | { kind: 'dustResidual'; result: SwapResult; residualUsdbBaseUnits: bigint }
  | { kind: 'refunded' }
  | { kind: 'error'; message: string; retryable: boolean };

// =============================================================================
// Native Module Detection
// =============================================================================

// Native modules are REQUIRED. Do NOT wrap these imports in try/catch — a
// missing core dependency in a wallet must crash the app loudly at startup,
// not silently let the UI render with a no-op SDK and orphan the user.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BreezSDK = require('@breeztech/breez-sdk-spark-react-native');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RNFS = require('react-native-fs');
const _isNativeAvailable = true;
console.log('✅ [BreezSparkService] Native SDK loaded successfully');

// =============================================================================
// Service State
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sdkInstance: any = null;
let _isInitialized = false;
let cachedResolvedSwapTokens: ResolvedSwapToken[] | null = null;

// Event listeners
type PaymentEventCallback = (payment: TransactionInfo) => void;
const paymentEventListeners: Set<PaymentEventCallback> = new Set();

// Active SDK event listener ID for cleanup
let activeEventListenerId: string | null = null;

// Track recently sent payment IDs to avoid sending "Payment Received" notifications for our own sends
const recentlySentPaymentIds: Set<string> = new Set();
const SENT_PAYMENT_TRACKING_MS = 60000; // Track for 1 minute

function toBigIntOrNull(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function walkObjectForIdentifiers(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const entry of value) walkObjectForIdentifiers(entry, out);
    return;
  }

  const record = value as Record<string, unknown>;
  const maybeTicker = String(record.ticker || record.symbol || '').toUpperCase();
  const maybeIdentifier = record.tokenIdentifier || record.identifier || record.tokenId || record.id;

  if (maybeTicker === 'USDB' && typeof maybeIdentifier === 'string' && maybeIdentifier.length > 0) {
    out.add(maybeIdentifier);
  }

  for (const child of Object.values(record)) walkObjectForIdentifiers(child, out);
}

// The SDK's FetchConversionLimitsResponse only carries minFromAmount + minToAmount
// (no maximum — swaps are limited only by wallet balance + pool liquidity).
// We preserve the SwapLimits.max shape for the UI's above-max check, but set it to
// a sentinel so the check effectively never triggers.
const SWAP_MAX_SENTINEL = (1n << 63n) - 1n;

function extractLimitsFromResponse(response: unknown): SwapLimits {
  const source = (response || {}) as Record<string, unknown>;

  const min =
    // SDK 0.13.1 canonical field name for FetchConversionLimitsResponse.
    toBigIntOrNull(source.minFromAmount) ??
    // Older / alternate field names kept as fallback for forward-compat.
    toBigIntOrNull(source.min) ??
    toBigIntOrNull(source.minAmount) ??
    toBigIntOrNull(source.minAmountSat) ??
    toBigIntOrNull(source.minSendable) ??
    toBigIntOrNull((source.limits as Record<string, unknown> | undefined)?.min);

  const max =
    // SDK 0.13.1 does not expose a max — fall back to sentinel.
    toBigIntOrNull(source.maxFromAmount) ??
    toBigIntOrNull(source.max) ??
    toBigIntOrNull(source.maxAmount) ??
    toBigIntOrNull(source.maxAmountSat) ??
    toBigIntOrNull(source.maxSendable) ??
    toBigIntOrNull((source.limits as Record<string, unknown> | undefined)?.max) ??
    SWAP_MAX_SENTINEL;

  if (min === null) {
    throw new Error('Failed to parse conversion limits from SDK response');
  }

  return { min, max };
}

function pickBigInt(record: Record<string, unknown>, keys: string[]): bigint | null {
  for (const key of keys) {
    const value = toBigIntOrNull(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function parsePreparedAmounts(
  prepared: unknown
): { receiveAmount: bigint; feeSat: bigint; payAmount: bigint } {
  const source = (prepared || {}) as Record<string, unknown>;
  const estimate = (source.conversionEstimate || {}) as Record<string, unknown>;

  // Verified against actual SDK 0.13.1 responses (BTC→USDB direction):
  //   • `outer.amount`                     = NET amount delivered to the user
  //   • `conversionEstimate.amountIn`      = total sats debited from the user
  //   • `conversionEstimate.amountOut`     = GROSS pre-fee output (always
  //                                          ≈ amountIn × rate, ignores fees)
  //   • `conversionEstimate.fee`           = an inflated pool-impact /
  //                                          slippage-reserve number, NOT the
  //                                          actual user-charged fee. Do not
  //                                          display it.
  //
  // Real economic fee = amountOut − outer.amount (in destination token units).
  // We surface this as `feeSat` for now (the UI formats it per-direction).
  //
  // On a 163,964-sat swap we observed amountOut=123,043,715 USDB base units
  // vs outer.amount=122,436,922 → fee = 606,793 base units = 0.60 USDB = ~800
  // sats = 0.5%, which matches real-world AMM expectations. The SDK's
  // inflated `conversionEstimate.fee=61,222` was the source of the "40% fee"
  // bug — it's unrelated to what the user actually pays.
  const outerAmount = pickBigInt(source, ['amount']) ?? 0n;
  const gross = pickBigInt(estimate, ['amountOut']) ?? 0n;
  const payAmount =
    pickBigInt(estimate, ['amountIn']) ??
    outerAmount ??
    0n;

  // Display the AMM's estimated delivery (`amountOut`) as the receive
  // amount — that's what the user actually gets in practice. `outer.amount`
  // is the slippage-protected minimum (what Rust will enforce), which is
  // a less helpful number to show upfront because users compare it against
  // the actual settlement and get confused when they receive "more".
  // The gap between gross (estimated) and outer (min) is the slippage
  // buffer — we still use outer as the floor internally for safety.
  const receiveAmount = gross || outerAmount;
  const feeInDestinationUnits = gross > outerAmount ? gross - outerAmount : 0n;

  return { receiveAmount, feeSat: feeInDestinationUnits, payAmount };
}

function parseRateFromPrepared(prepared: unknown): number {
  // Rate = destination-per-source, derived from amountIn/amountOut.
  const source = (prepared || {}) as Record<string, unknown>;
  const estimate = (source.conversionEstimate || {}) as Record<string, unknown>;
  const amountIn = pickBigInt(estimate, ['amountIn']);
  const amountOut = pickBigInt(estimate, ['amountOut']);
  if (amountIn && amountOut && amountIn > 0n) {
    return Number(amountOut) / Number(amountIn);
  }
  return 0;
}

function isSlippageRefundError(error: unknown): boolean {
  const msg = extractSdkErrorMessage(error, '').toLowerCase();
  const raw = JSON.stringify(error || {}).toLowerCase();
  return (
    msg.includes('slippage') ||
    msg.includes('refund') ||
    msg.includes('conversion') ||
    raw.includes('slippage') ||
    raw.includes('refund')
  );
}

function paymentLooksRefunded(payment: unknown): boolean {
  if (!payment || typeof payment !== 'object') return false;
  // BigInt-safe stringify: payment records contain u128 amounts that JSON
  // can't serialize natively. We only need a text blob to keyword-scan, so
  // coerce bigints to strings via a replacer.
  let raw: string;
  try {
    raw = JSON.stringify(payment, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).toLowerCase();
  } catch {
    raw = String(payment).toLowerCase();
  }
  return raw.includes('refund') || raw.includes('refunded') || raw.includes('conversion_refund');
}

function paymentLooksTimeout(error: unknown): boolean {
  const msg = extractSdkErrorMessage(error, '').toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out') || msg.includes('completion_timeout');
}

function extractUsdbBalanceBaseUnitsFromObject(value: unknown, tokenIdentifier: string): bigint {
  if (!value || typeof value !== 'object') return 0n;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = extractUsdbBalanceBaseUnitsFromObject(entry, tokenIdentifier);
      if (found > 0n) return found;
    }
    return 0n;
  }

  const record = value as Record<string, unknown>;
  const id = String(record.tokenIdentifier || record.identifier || record.tokenId || '');
  if (id === tokenIdentifier) {
    return (
      pickBigInt(record, ['balance', 'amount', 'baseUnits', 'amountBaseUnits', 'value']) ??
      0n
    );
  }

  for (const child of Object.values(record)) {
    const found = extractUsdbBalanceBaseUnitsFromObject(child, tokenIdentifier);
    if (found > 0n) return found;
  }

  return 0n;
}

async function getUsdbBalanceBaseUnits(tokenIdentifier: string): Promise<bigint> {
  const info = await sdkInstance.getInfo?.({ ensureSynced: true });
  return extractUsdbBalanceBaseUnitsFromObject(info?.tokenBalances, tokenIdentifier);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the local Node ID (Public Key)
 * Spark SDK doesn't expose node ID directly, so we generate a minimal invoice and parse it
 */
 export async function getNodeId(): Promise<string | null> {
  if (!_isNativeAvailable || !sdkInstance) return null;
  try {
    // Spark SDK doesn't have getNodeInfo() - try to get pubkey from a generated invoice
    const paymentMethod = BreezSDK.ReceivePaymentMethod.Bolt11Invoice.new({
      description: '__nodeId_probe__',
      amountSats: BigInt(1),
      expirySecs: 60,
    });
    
    const response = await sdkInstance.receivePayment({ paymentMethod });
    const invoice = response.paymentRequest;
    
    // Parse the invoice to get our own pubkey
    const parsed = await sdkInstance.parse(invoice);
    
    if (parsed.tag === 'Bolt11Invoice' && parsed.inner) {
      const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
      const nodeId = innerData?.payeePubkey || innerData?.destination || innerData?.nodeId;
      if (nodeId) {
        console.log('✅ [BreezSparkService] Got node ID:', nodeId.substring(0, 20) + '...');
        return nodeId;
      }
    }
    
    console.warn('⚠️ [BreezSparkService] Could not extract node ID from invoice');
    return null;
  } catch (err) {
    console.warn('⚠️ [BreezSparkService] Failed to get node ID:', err);
    return null;
  }
}


export async function resolveSwapTokens(): Promise<ResolvedSwapToken[]> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  if (cachedResolvedSwapTokens) return cachedResolvedSwapTokens;

  const tokenIdentifiers = new Set<string>();

  // Primary source: env-provided identifier(s). Set EXPO_PUBLIC_USDB_TOKEN_IDENTIFIER
  // in .env with the canonical USDB tokenIdentifier from Breez. This bypasses the
  // chicken-and-egg problem of needing to HOLD a token before you can discover its
  // identifier via getTokenBalances. Kept as env rather than hardcoded constant so
  // it's easy to rotate without a code change.
  const envIdentifier = process.env.EXPO_PUBLIC_USDB_TOKEN_IDENTIFIER?.trim();
  if (envIdentifier) {
    tokenIdentifiers.add(envIdentifier);
  }

  try {
    const issuer = await sdkInstance.getTokenIssuer?.();
    if (typeof issuer === 'string' && issuer.length > 0) {
      tokenIdentifiers.add(issuer);
    } else {
      walkObjectForIdentifiers(issuer, tokenIdentifiers);
    }
  } catch (error) {
    console.warn('⚠️ [BreezSparkService] getTokenIssuer discovery failed:', error);
  }

  try {
    const info = await sdkInstance.getInfo?.({ ensureSynced: true });
    walkObjectForIdentifiers(info?.tokenBalances, tokenIdentifiers);
  } catch (error) {
    console.warn('⚠️ [BreezSparkService] getInfo token discovery failed:', error);
  }

  if (tokenIdentifiers.size === 0) {
    throw new Error(
      'USDB token discovery failed: no identifiers found via getTokenIssuer or getTokenBalances. ' +
      'Set EXPO_PUBLIC_USDB_TOKEN_IDENTIFIER in .env with the canonical USDB tokenIdentifier ' +
      '(ask Breez support at t.me/breezsdk or check https://sparkscan.io) and restart Metro.'
    );
  }

  const metadataResponse = await sdkInstance.getTokensMetadata?.({
    tokenIdentifiers: Array.from(tokenIdentifiers),
  });

  const metadataList: Array<Record<string, unknown>> =
    metadataResponse?.tokensMetadata ||
    metadataResponse?.metadata ||
    metadataResponse ||
    [];

  if (!Array.isArray(metadataList) || metadataList.length === 0) {
    throw new Error('USDB token metadata unavailable');
  }

  cachedResolvedSwapTokens = SWAP_TOKENS.map((token) => {
    const match = metadataList.find((entry) => {
      const ticker = String(entry.ticker || entry.symbol || '').toUpperCase();
      return ticker === token.ticker.toUpperCase();
    });

    if (!match) throw new Error(`Swap token ${token.ticker} not found in Spark metadata`);

    const tokenIdentifier = String(match.identifier || match.tokenIdentifier || '').trim();
    const internalDecimals = Number(match.decimals);

    if (!tokenIdentifier) throw new Error(`Swap token ${token.ticker} missing tokenIdentifier`);
    if (!Number.isFinite(internalDecimals)) throw new Error(`Swap token ${token.ticker} missing decimals`);

    return { ...token, tokenIdentifier, internalDecimals };
  });

  return cachedResolvedSwapTokens;
}



export async function getTokenBalances(): Promise<Array<Record<string, unknown>>> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }
  const info = await sdkInstance.getInfo?.({ ensureSynced: true });
  const raw = info?.tokenBalances;

  // SDK returns `Map<string, TokenBalance>` where TokenBalance =
  // { balance: u128, tokenMetadata: { identifier, ticker, decimals, ... } }
  // Normalize to a flat array of records with the fields useWallet expects.
  const entries: Array<Record<string, unknown>> = [];
  const pushEntry = (identifierKey: string | undefined, tb: any): void => {
    if (!tb || typeof tb !== 'object') return;
    const meta = (tb.tokenMetadata || tb.metadata || {}) as Record<string, unknown>;
    entries.push({
      ...tb,
      ...meta,
      // Preserve originals + promote key fields to the top level
      balance: tb.balance,
      tokenIdentifier: meta.identifier || meta.tokenIdentifier || identifierKey,
      ticker: meta.ticker || (meta as any).symbol,
      decimals: meta.decimals,
      tokenMetadata: meta,
    });
  };

  if (raw instanceof Map) {
    for (const [k, v] of raw.entries()) pushEntry(k, v);
  } else if (Array.isArray(raw)) {
    for (const v of raw) pushEntry(undefined, v);
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) pushEntry(k, v);
  }

  return entries;
}

export async function fetchSwapLimits(direction: SwapDirection): Promise<SwapLimits> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  const [usdbToken] = await resolveSwapTokens();
  if (!usdbToken) throw new Error('USDB token unavailable');
  console.log('🔬 [fetchSwapLimits] start', { direction, usdbTokenIdentifier: usdbToken.tokenIdentifier });

  // Lazily resolve ConversionType factory; avoids top-level-import crash.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ConversionType } = require('@breeztech/breez-sdk-spark-react-native');

  let response: unknown;
  try {
    if (direction === 'BTC_TO_USDB') {
      response = await sdkInstance.fetchConversionLimits?.({
        conversionType: ConversionType.FromBitcoin.new(),
        tokenIdentifier: usdbToken.tokenIdentifier,
      });
    } else {
      response = await sdkInstance.fetchConversionLimits?.({
        conversionType: ConversionType.ToBitcoin.new({
          fromTokenIdentifier: usdbToken.tokenIdentifier,
        }),
        tokenIdentifier: undefined,
      });
    }
    console.log('🔬 [fetchSwapLimits] ok', { direction, response });
  } catch (error) {
    console.error('❌ [fetchSwapLimits] threw', {
      direction,
      name: (error as any)?.name,
      message: (error as any)?.message,
      raw: error,
    });
    throw error;
  }

  return extractLimitsFromResponse(response);
}


export async function prepareSwap(params: PrepareSwapParams): Promise<SwapQuote> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  const [usdbToken] = await resolveSwapTokens();
  if (!usdbToken) throw new Error('USDB token unavailable');
  console.log('🔬 [prepareSwap] start', {
    direction: params.direction,
    amount: params.amount.toString(),
    slippageBps: params.slippageBps,
    usdbTokenIdentifier: usdbToken.tokenIdentifier,
    usdbDecimals: usdbToken.internalDecimals,
  });

  let receivePayment;
  try {
    // Receive-side: use SparkInvoice for conversion swaps.
    // ReceivePaymentMethod.SparkAddress has NO inner fields (can only emit a
    // plain sats-only address), so we need SparkInvoice to attach a
    // destination tokenIdentifier for BTC→USDB.
    receivePayment = await sdkInstance.receivePayment?.({
      paymentMethod: {
        tag: 'SparkInvoice',
        inner: {
          amount: undefined,
          tokenIdentifier: params.direction === 'BTC_TO_USDB' ? usdbToken.tokenIdentifier : undefined,
          expiryTime: undefined,
          description: undefined,
          senderPublicKey: undefined,
        },
      },
    });
    console.log('🔬 [prepareSwap] receivePayment ok', {
      paymentRequest: String(receivePayment?.paymentRequest || '').slice(0, 60) + '...',
    });
  } catch (error) {
    console.error('❌ [prepareSwap] receivePayment threw', {
      step: 'self-receive',
      direction: params.direction,
      name: (error as any)?.name,
      message: (error as any)?.message,
      raw: error,
    });
    throw error;
  }

  const paymentRequest = String(receivePayment?.paymentRequest || '').trim();
  if (!paymentRequest) throw new Error('Failed to generate swap self-address');

  // ⚠️ SELF-PAYMENT PATTERN — important for future maintainers:
  // We are NOT paying an external recipient. The Breez SDK has no direct swap API,
  // so BTC⇄USDB conversion is performed by paying our own Spark receive address
  // with conversionOptions enabled. Do not remove this self-address step.
  let preparedPayment;
  try {
    // SDK rules (learned empirically):
    //   • If top-level tokenIdentifier is undefined → conversionType must be ToBitcoin.
    //   • If top-level tokenIdentifier is set → conversionType must be FromBitcoin
    //     and `amount` is in the TOKEN's base units (the destination amount).
    //   • If top-level tokenIdentifier is undefined + ToBitcoin → `amount` is in
    //     sats (destination is BTC).
    //
    // UX semantics: the user types what they want to PAY in the SOURCE currency.
    // The SDK needs `amount` in the DESTINATION currency for BTC→USDB swaps.
    // So we convert sats → approx USDB base units using the cached BTC/USD rate
    // (USDB ≈ USD 1:1). The final exact amounts come back in the prepareResponse.
    // For USDB→BTC, the user's input is USDB display units; we convert to approx
    // sats. Slippage tolerance on the conversion covers rate drift between here
    // and when the SDK settles the swap.
    let amountForSdk = BigInt(params.amount);
    const rates = getCachedRates() || (await getExchangeRates().catch(() => null));
    if (rates && rates.usd > 0) {
      if (params.direction === 'BTC_TO_USDB') {
        // source: sats → target USDB base units
        // sats → USD = sats * USD_PER_BTC / 100_000_000
        // USD → USDB base units = USD * 10^internalDecimals
        const sats = Number(params.amount);
        const usd = (sats * rates.usd) / 100_000_000;
        const usdbBaseUnits = Math.max(1, Math.floor(usd * 10 ** usdbToken.internalDecimals));
        amountForSdk = BigInt(usdbBaseUnits);
      } else {
        // source: USDB base units (what user typed × 10^decimals) → target sats
        // base units → USD = base / 10^decimals
        // USD → sats = USD * 100_000_000 / USD_PER_BTC
        const usdbBase = Number(params.amount);
        const usd = usdbBase / 10 ** usdbToken.internalDecimals;
        const sats = Math.max(1, Math.floor((usd * 100_000_000) / rates.usd));
        amountForSdk = BigInt(sats);
      }
    }
    console.log('🔬 [prepareSwap] amount conversion', {
      direction: params.direction,
      userAmount: params.amount.toString(),
      amountForSdk: amountForSdk.toString(),
      usdRate: rates?.usd,
    });

    preparedPayment = await sdkInstance.prepareSendPayment?.({
      paymentRequest,
      amount: amountForSdk,
      tokenIdentifier: params.direction === 'BTC_TO_USDB' ? usdbToken.tokenIdentifier : undefined,
      conversionOptions: {
        conversionType: (() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { ConversionType } = require('@breeztech/breez-sdk-spark-react-native');
          return params.direction === 'BTC_TO_USDB'
            ? ConversionType.FromBitcoin.new()
            : ConversionType.ToBitcoin.new({ fromTokenIdentifier: usdbToken.tokenIdentifier });
        })(),
        maxSlippageBps: params.slippageBps,
        completionTimeoutSecs: 30,
      },
    });
    console.log('🔬 [prepareSwap] prepareSendPayment ok', {
      hasResponse: !!preparedPayment,
    });
  } catch (error) {
    console.error('❌ [prepareSwap] prepareSendPayment threw', {
      step: 'prepare-send',
      direction: params.direction,
      amount: params.amount.toString(),
      slippageBps: params.slippageBps,
      name: (error as any)?.name,
      message: (error as any)?.message,
      raw: error,
    });
    throw error;
  }

  const { receiveAmount, feeSat, payAmount } = parsePreparedAmounts(preparedPayment);
  const rate = parseRateFromPrepared(preparedPayment);
  // Dump the full response shape — including paymentMethod.inner — so we can
  // see every fee field the SDK exposes. Large fees in the conversionEstimate
  // may hide a separate small sparkTransferFeeSats on the paymentMethod.
  const safePrepared = JSON.parse(
    JSON.stringify(preparedPayment, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
  console.log('🔬 [prepareSwap] raw response', safePrepared);
  console.log('🔬 [prepareSwap] parsed quote', {
    direction: params.direction,
    payAmount: payAmount.toString(),
    receiveAmount: receiveAmount.toString(),
    feeSat: feeSat.toString(),
    rate,
  });

  return {
    direction: params.direction,
    amount: BigInt(params.amount),
    slippageBps: params.slippageBps,
    payAmount,
    receiveAmount,
    feeSat,
    rate,
    usdbDecimals: usdbToken.internalDecimals,
    preparedPayment,
  };
}

export async function executeSwap(quote: SwapQuote): Promise<SwapOutcome> {
  if (!_isNativeAvailable || !sdkInstance) {
    return { kind: 'error', message: 'SDK not available', retryable: true };
  }

  const [usdbToken] = await resolveSwapTokens();
  if (!usdbToken) {
    return { kind: 'error', message: 'USDB token unavailable', retryable: true };
  }

  const preBalance =
    quote.direction === 'USDB_TO_BTC'
      ? await getUsdbBalanceBaseUnits(usdbToken.tokenIdentifier)
      : 0n;

  try {
    // Canonical pattern from https://sdk-doc-spark.breez.technology/guide/token_conversion.html:
    //   1. receivePayment → self Spark address (encodes destination token for BTC→USDB)
    //   2. prepareSendPayment with ConversionType class instance
    //   3. sendPayment with the prepareResponse VERBATIM (no rebuild / no round-trip)
    //
    // The live object reference from prepareSendPayment carries uniffi enum
    // class markers on nested fields (ConversionType, SendPaymentMethod,
    // FeePolicy). If we spread/clone/React-setState it, those markers are
    // stripped and sendPayment fails Rust-side validation with
    // "Token identifier is required for from Bitcoin conversion" — even
    // though the data looks right. So: keep the returned reference, pass it
    // straight through.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const breezModule = require('@breeztech/breez-sdk-spark-react-native');
    const { ConversionType, ReceivePaymentMethod } = breezModule;

    // Receive-side: use SparkInvoice (NOT SparkAddress) because
    // ReceivePaymentMethod.SparkAddress has NO fields — it can only generate a
    // plain sats-only address. For a BTC→USDB conversion we need the invoice
    // to carry `tokenIdentifier = USDB` so the Rust send layer can thread the
    // destination-token context through to the conversion step.
    const receivePaymentMethod = ReceivePaymentMethod?.SparkInvoice?.new
      ? ReceivePaymentMethod.SparkInvoice.new({
          amount: undefined,
          tokenIdentifier: quote.direction === 'BTC_TO_USDB' ? usdbToken.tokenIdentifier : undefined,
          expiryTime: undefined,
          description: undefined,
          senderPublicKey: undefined,
        })
      : ({
          tag: 'SparkInvoice',
          inner: {
            amount: undefined,
            tokenIdentifier: quote.direction === 'BTC_TO_USDB' ? usdbToken.tokenIdentifier : undefined,
            expiryTime: undefined,
            description: undefined,
            senderPublicKey: undefined,
          },
        } as any);

    const recv = await sdkInstance.receivePayment?.({
      paymentMethod: receivePaymentMethod,
    } as any);
    const paymentRequest = String(recv?.paymentRequest || '').trim();
    if (!paymentRequest) throw new Error('Failed to generate swap self-address on execute');

    // Amount semantics per docs:
    //   • FromBitcoin (BTC→USDB): amount is in TOKEN BASE UNITS (USDB)
    //   • ToBitcoin (USDB→BTC):   amount is in SATS (destination BTC)
    // prepareSwap stored the correctly-denominated amount on quote.preparedPayment.amount.
    const storedAmount =
      quote.preparedPayment && typeof quote.preparedPayment === 'object'
        ? BigInt(String((quote.preparedPayment as any).amount ?? 0))
        : 0n;

    const conversionType =
      quote.direction === 'BTC_TO_USDB'
        ? new ConversionType.FromBitcoin()
        : new ConversionType.ToBitcoin({ fromTokenIdentifier: usdbToken.tokenIdentifier });

    // Per docs:
    //   FromBitcoin: top-level tokenIdentifier = destination token (USDB)
    //   ToBitcoin:   top-level tokenIdentifier = undefined
    const fresh = await sdkInstance.prepareSendPayment?.({
      paymentRequest,
      amount: storedAmount,
      tokenIdentifier: quote.direction === 'BTC_TO_USDB' ? usdbToken.tokenIdentifier : undefined,
      conversionOptions: {
        conversionType,
        maxSlippageBps: quote.slippageBps,
        completionTimeoutSecs: 30,
      } as any,
      feePolicy: undefined,
    } as any);

    // Pass the fresh PrepareSendPaymentResponse verbatim — see
    // canonical snippet in
    // https://sdk-doc-spark.breez.technology/guide/token_conversion.html.
    // `options: undefined` because HTLC is only for on-chain Bitcoin.
    const response = await sdkInstance.sendPayment?.({
      prepareResponse: fresh,
      options: undefined,
      idempotencyKey: undefined,
    } as any);

    if (paymentLooksRefunded(response?.payment)) {
      // TODO T15: prune losing branch after spike-results.md confirms mechanism.
      return { kind: 'refunded' };
    }

    const result: SwapResult = {
      paymentId: response?.payment?.id,
      payment: response?.payment,
      direction: quote.direction,
      spent: quote.payAmount,
      received: quote.receiveAmount,
    };

    if (quote.direction === 'USDB_TO_BTC') {
      const postBalance = await getUsdbBalanceBaseUnits(usdbToken.tokenIdentifier);
      const residual = postBalance > preBalance ? postBalance - preBalance : postBalance;
      if (residual > 0n) {
        return { kind: 'dustResidual', result, residualUsdbBaseUnits: residual };
      }
    }

    return { kind: 'success', result };
  } catch (error) {
    // Dump every angle on the error so truncation in the Metro monitor
    // doesn't hide the underlying message.
    const e = error as any;
    try {
      console.error('❌ [executeSwap] sendPayment threw (full)', JSON.stringify({
        name: e?.name,
        message: e?.message,
        toString: String(e),
        code: e?.code,
        variant: e?.variant,
        cause: e?.cause && String(e.cause),
        keys: e && typeof e === 'object' ? Object.keys(e) : [],
      }));
    } catch {
      console.error('❌ [executeSwap] sendPayment threw (string):', String(e));
    }
    console.error('❌ [executeSwap] sendPayment threw (raw):', e);
    // Also dump every property on the error so nothing is hidden behind
    // non-enumerable fields.
    try {
      const own = Object.getOwnPropertyNames(e || {});
      const dump: Record<string, unknown> = {};
      for (const k of own) {
        try {
          const v = (e as any)[k];
          dump[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        } catch {
          dump[k] = '<unserializable>';
        }
      }
      console.error('❌ [executeSwap] sendPayment threw (ownProps)', JSON.stringify(dump));
    } catch {}
    if (isSlippageRefundError(error)) {
      return { kind: 'refunded' };
    }

    if (paymentLooksTimeout(error)) {
      return {
        kind: 'error',
        message: extractSdkErrorMessage(error, 'Swap timed out'),
        retryable: true,
      };
    }

    // Surface the complete error detail into the UI message so the user can
    // see what's happening without needing Metro — Metro truncates long lines.
    const details = extractSdkErrorDetails(error);
    const short = extractSdkErrorMessage(error, 'Swap failed');
    return {
      kind: 'error',
      message: `${short}\n---\n${details}`.slice(0, 1200),
      retryable: false,
    };
  }
}


/**
 * Check if native SDK is available
 */
export function isNativeAvailable(): boolean {
  return _isNativeAvailable;
}

/**
 * Check if SDK is initialized
 */
export function isSDKInitialized(): boolean {
  return _isInitialized && sdkInstance !== null;
}

/**
 * DEVTOOLS ONLY: expose the connected raw SDK instance for local diagnostics.
 * Never use this in production application flows.
 */
export function getRawSdkInstanceForDevtools(): unknown {
  if (!__DEV__) {
    return null;
  }
  return sdkInstance;
}

/**
 * Generate a wallet-specific storage directory from mnemonic
 * Uses a simple hash of first 3 words to create unique storage per wallet
 */
function generateWalletStorageId(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/);
  // Use first 3 words to create a deterministic but unique identifier
  const identifier = words.slice(0, 3).join('-');
  // Create a simple hash for privacy (don't expose actual words in storage name)
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `wallet-${Math.abs(hash).toString(16)}`;
}

/**
 * Initialize the Breez SDK with a mnemonic
 * @param mnemonic - The wallet mnemonic
 * @param apiKey - Optional Breez API key
 * @param walletNickname - Optional wallet name for push notifications
 */
export async function initializeSDK(
  mnemonic: string,
  apiKey?: string,
  walletNickname?: string,
  walletIdentity?: { masterKeyId: string; subWalletIndex: number },
): Promise<boolean> {
  const walletId = generateWalletStorageId(mnemonic);

  console.log('🔵 [BreezSparkService] initializeSDK called for wallet:', walletId);

  if (!_isNativeAvailable) {
    console.warn('⚠️ [BreezSparkService] Cannot initialize - native SDK not available');
    return false;
  }

  try {
    // If already initialized with same wallet, return true
    if (sdkInstance && _isInitialized) {
      console.log('⚠️ [BreezSparkService] SDK already initialized, disconnecting first...');
      await disconnectSDK();
    }

    // Construct the seed using mnemonic words (per official Breez SDK Spark docs)
    const seed = new BreezSDK.Seed.Mnemonic({
      mnemonic,
      passphrase: undefined,
    });

    // Create the default config
    const config = BreezSDK.defaultConfig(BreezSDK.Network.Mainnet);
    
    // Only set API key if provided (empty string = no key)
    const effectiveApiKey = apiKey || BREEZ_API_KEY;
    if (effectiveApiKey && effectiveApiKey.length > 0) {
      config.apiKey = effectiveApiKey;
    } else {
      console.warn('⚠️ [BreezSparkService] No API key configured');
    }

    // Allow deposit claims to use network-recommended fees (+2 sat/vB leeway)
    // This prevents maxDepositClaimFeeExceeded errors during fee spikes
    try {
      config.maxDepositClaimFee = new BreezSDK.MaxFee.NetworkRecommended({ leewaySatPerVbyte: BigInt(2) });
    } catch (feeConfigErr) {
      console.warn('⚠️ [BreezSparkService] Failed to set maxDepositClaimFee:', feeConfigErr);
    }

    // Use wallet-specific storage directory
    const storageDir = `${RNFS.DocumentDirectoryPath}/${BREEZ_STORAGE_DIR}/${walletId}`;
    // Storage directory set to: storageDir

    // Ensure storage directory exists
    const dirExists = await RNFS.exists(storageDir);
    if (!dirExists) {
      await RNFS.mkdir(storageDir);
    }


    sdkInstance = await BreezSDK.connect({
      config,
      seed,
      storageDir,
    });

    _isInitialized = true;

    // Setup event listeners for real-time payment notifications
    try {
      await setupEventListeners();
    } catch (eventError) {
      console.warn('⚠️ [BreezSparkService] Event listeners failed:', eventError);
      // Don't fail SDK init if events don't work - user can still pull-to-refresh
    }

    console.log('✅ [BreezSparkService] SDK initialized');

    // Notification pipeline setup:
    //   1. Cache identity pubkey + lightning address (used by any in-app
    //      notification logic that runs while the app is foregrounded).
    //   2. Register a Breez webhook for background notifications — the
    //      DB-less relay at /breezWebhook/<pubkey>/<expoPushToken> fires
    //      Expo pushes for incoming Lightning events even when the app
    //      is killed. See services/breezWebhookService.ts.
    try {
      const [lnAddress, info] = await Promise.all([
        getLightningAddress(),
        sdkInstance.getInfo({}),
      ]);
      const identityPubkey = info?.identityPubkey;
      if (lnAddress?.lightningAddress && identityPubkey) {
        const { cacheWalletAddress } = require('./notificationSubscriptionService');
        await cacheWalletAddress(
          identityPubkey,
          lnAddress.lightningAddress,
          walletIdentity
            ? {
                masterKeyId: walletIdentity.masterKeyId,
                subWalletIndex: walletIdentity.subWalletIndex,
              }
            : undefined,
          walletNickname,
        );
        console.log(`🔑 [BreezSparkService] Identity pubkey: ${identityPubkey.slice(0, 16)}…`);

        // Register the Breez webhook. Idempotent — re-register is a no-op
        // unless the FCM token rotated. We use a NATIVE FCM token (via
        // @react-native-firebase/messaging), not Expo's push token, so
        // the Cloud Function can talk to FCM directly via firebase-admin
        // without Expo's push server as an intermediary.
        try {
          const Notifications = require('expo-notifications');
          console.log('🔔 [BreezWebhook] setup check', {
            hasRegisterWebhook: typeof sdkInstance.registerWebhook === 'function',
          });

          // Read current permission. If undetermined (never asked), prompt
          // the user. expo-notifications shows the OS dialog on iOS; on
          // Android <13 this is a no-op and on Android 13+ it asks for
          // POST_NOTIFICATIONS.
          let permStatus = await Notifications.getPermissionsAsync();
          console.log('🔔 [BreezWebhook] notification permission (initial)', permStatus.status);
          if (permStatus.status !== 'granted') {
            try {
              permStatus = await Notifications.requestPermissionsAsync({
                ios: {
                  allowAlert: true,
                  allowBadge: true,
                  allowSound: true,
                },
              });
              console.log('🔔 [BreezWebhook] notification permission (after request)', permStatus.status);
            } catch (e) {
              console.warn('⚠️ [BreezWebhook] permission request failed', e);
            }
          }
          if (permStatus.status !== 'granted') {
            console.warn('⚠️ [BreezWebhook] Notifications permission not granted — user must enable in OS settings; skipping FCM registration.');
            // Without permission, iOS won't issue an APNs token, so getToken()
            // will fail or return a token that can't deliver. Bail out
            // gracefully — we'll retry on next wallet open.
            return false;
          }

          // Fetch native FCM token. On iOS this also ensures APNs registration
          // first; on Android it's a direct FCM call.
          const messaging = require('@react-native-firebase/messaging').default;
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { Platform } = require('react-native');
          if (Platform.OS === 'ios') {
            try {
              await messaging().registerDeviceForRemoteMessages();
              // Wait briefly for APNs token to be available before asking
              // for the FCM token — getToken() needs APNs to have been
              // registered first or it returns an unusable result.
              const apnsToken = await messaging().getAPNSToken();
              console.log('🔔 [BreezWebhook] APNs token', apnsToken ? 'present' : 'missing');
            } catch (e) {
              console.warn('⚠️ [BreezWebhook] APNs registration failed', e);
            }
          }
          const fcmToken = await messaging().getToken();
          console.log('🔔 [BreezWebhook] FCM token', fcmToken ? `${fcmToken.slice(0, 24)}…` : null);
          if (fcmToken) {
            const { registerBreezWebhook } = require('./breezWebhookService');
            await registerBreezWebhook({
              identityPubkey,
              pushToken: fcmToken,
              walletNickname,
              sdk: sdkInstance,
            });

            // NOTE: LN-Address-push relay registration is disabled until
            // Breez activates our LNURL webhook domain on their side.
            // Without that, our backend is never invoked for LN-Address
            // payments, so the registration call is a no-op that only
            // sends user identifiers to a backend that can't act on them.
            // Re-enable when Breez confirms domain enrollment.
            //
            // try {
            //   const resp = await fetch(
            //     'https://europe-west3-investave-1337.cloudfunctions.net/registerLnurlPushTarget',
            //     {
            //       method: 'POST',
            //       headers: { 'Content-Type': 'application/json' },
            //       body: JSON.stringify({
            //         identityPubkey,
            //         fcmToken,
            //         walletNickname: walletNickname || undefined,
            //       }),
            //     },
            //   );
            //   if (resp.ok) {
            //     console.log('✅ [LnurlPush] registered push target for', identityPubkey.slice(0, 12) + '…');
            //   } else {
            //     const text = await resp.text().catch(() => '');
            //     console.warn('⚠️ [LnurlPush] register failed:', resp.status, text);
            //   }
            // } catch (regErr) {
            //   console.warn('⚠️ [LnurlPush] register network error:', regErr);
            // }
          } else {
            console.warn('⚠️ [BreezWebhook] No FCM token — skipping webhook register');
          }
        } catch (webhookErr) {
          console.warn('⚠️ [BreezSparkService] webhook registration failed:', webhookErr);
        }
      } else if (lnAddress?.lightningAddress) {
        console.log('ℹ️ [BreezSparkService] No identityPubkey — skipping notification setup');
      }
    } catch (e) {
      console.warn('⚠️ [BreezSparkService] Notification setup warning:', e);
    }

    return true;
  } catch (error) {
    // Try multiple ways to extract error info from native errors
    const errorStr = String(error);
    const errorName = (error as { name?: string })?.name || 'Unknown';
    const errorMessage = (error as { message?: string })?.message || errorStr;
    const errorCode = (error as { code?: string })?.code;
    const errorVariant = (error as { variant?: string })?.variant;

    console.error('❌ [BreezSparkService] Failed to initialize Breez SDK');
    console.error('❌ [BreezSparkService] Error toString:', errorStr);
    console.error('❌ [BreezSparkService] Error name:', errorName);
    console.error('❌ [BreezSparkService] Error message:', errorMessage);
    console.error('❌ [BreezSparkService] Error code:', errorCode);
    console.error('❌ [BreezSparkService] Error variant:', errorVariant);

    // Log all own properties
    if (error && typeof error === 'object') {
      console.error('❌ [BreezSparkService] Error properties:', Object.keys(error));
      for (const key of Object.keys(error)) {
        console.error(`❌ [BreezSparkService] Error.${key}:`, (error as Record<string, unknown>)[key]);
      }
    }

    _isInitialized = false;
    sdkInstance = null;
    return false;
  }
}

/**
 * Disconnect and cleanup SDK
 */
// Track in-flight disconnect so multiple callers can await the same operation
let _disconnectPromise: Promise<void> | null = null;

export async function disconnectSDK(): Promise<void> {
  // If a disconnect is already in progress, await it instead of starting another
  if (_disconnectPromise) {
    await _disconnectPromise;
    return;
  }

  if (!_isNativeAvailable) return;

  _disconnectPromise = (async () => {
    try {
      // Unsubscribe from events
      if (activeEventListenerId && sdkInstance) {
        try {
          await sdkInstance.removeEventListener(activeEventListenerId);
        } catch (e) {
          console.warn('⚠️ [BreezSparkService] Error removing listener during disconnect:', e);
        }
        activeEventListenerId = null;
      }

      if (sdkInstance) {
        // Spark SDK uses sdkInstance.disconnect(), not BreezSDK.disconnect()
        await sdkInstance.disconnect();
        sdkInstance = null;
        _isInitialized = false;
        cachedResolvedSwapTokens = null;
        console.log('✅ [BreezSparkService] Breez SDK disconnected');
      }
    } catch (error) {
      console.error('❌ [BreezSparkService] Failed to disconnect SDK:', error);
    }
  })();

  await _disconnectPromise;
  _disconnectPromise = null;
}

/**
 * Start disconnecting SDK without waiting — caller can await disconnectSDK() later.
 * Marks SDK as uninitialized immediately to prevent stale refreshes.
 */
export function beginDisconnectSDK(): void {
  if (!_isNativeAvailable || !sdkInstance) return;
  _isInitialized = false; // Mark as disconnected immediately
  disconnectSDK(); // Fire and forget — sets _disconnectPromise
}

/**
 * Subscribe to payment events
 * Returns unsubscribe function
 */
export function onPaymentReceived(callback: PaymentEventCallback): () => void {
  paymentEventListeners.add(callback);
  console.log('✅ [BreezSparkService] Payment event listener added');

  return () => {
    paymentEventListeners.delete(callback);
    console.log('✅ [BreezSparkService] Payment event listener removed');
  };
}


/**
 * Setup SDK event listeners
 * Based on: https://sdk-doc-spark.breez.technology/guide/events.html
 */
async function setupEventListeners(): Promise<void> {
  if (!sdkInstance || !_isNativeAvailable) return;

  try {
    // Unsubscribe from previous listener if exists
    if (activeEventListenerId) {
      try {
        await sdkInstance.removeEventListener(activeEventListenerId);
      } catch (e) {
        console.warn('⚠️ [BreezSparkService] Error removing listener:', e);
      }
      activeEventListenerId = null;
    }

    // Create event listener object with onEvent method (per SDK docs)
    // The SDK expects an object with an onEvent method, not a plain function
    const eventListener = {
      onEvent: async (event: unknown): Promise<void> => {
        try {
          // Cast to expected structure based on SDK docs
          const evt = event as {
            tag?: string;
            inner?: {
              payment?: unknown;
              unclaimedDeposits?: unknown;
              claimedDeposits?: unknown;
            };
          };

          const eventTag = evt?.tag || (event as Record<string, unknown>)?.type || 'unknown';

          // Handle PaymentSucceeded event (try multiple possible formats)
          const isPaymentEvent = 
            eventTag === 'PaymentSucceeded' || 
            eventTag === 'paymentSucceeded' ||
            eventTag === 'payment_succeeded';
            
          if (isPaymentEvent) {
            // Try to find payment data in different possible locations
            const paymentData = (
              evt?.inner?.payment || 
              (event as Record<string, unknown>)?.payment ||
              (event as Record<string, unknown>)?.data
            ) as Record<string, unknown>;
            
            // Determine if this is a received or sent payment
            // paymentType: 1 = receive, 0 = send (or string 'receive'/'send')
            const paymentType = paymentData?.paymentType;
            const isReceived = 
              paymentType === 1 || 
              paymentType === 'receive' || 
              paymentType === 'Receive' ||
              String(paymentType).toLowerCase() === 'receive';
            
            const payment: TransactionInfo = {
              id: String(paymentData?.id || Date.now()),
              type: isReceived ? 'receive' : 'send',
              amountSat: Number(paymentData?.amountSat || paymentData?.amount || paymentData?.amountSats || 0),
              feeSat: Number(paymentData?.feeSat || paymentData?.fee || paymentData?.feesSats || 0),
              status: 'completed',
              timestamp: Date.now(),
              description: String(paymentData?.description || ''),
            };

            // Only send push notification for RECEIVED payments
            // Skip if: not received, no amount, or we recently sent this payment ourselves
            const wasRecentlySent = recentlySentPaymentIds.has(payment.id);
            if (isReceived && payment.amountSat > 0 && !wasRecentlySent) {
              // NOTE: Local notification disabled here to avoid duplicate banners.
              // Remote push comes from the registered Breez webhook relay path instead.
              console.log('🔔 [BreezSparkService] Payment received - webhook relay push expected');
            }

            // Notify all listeners (for UI refresh etc)
            paymentEventListeners.forEach((listener) => {
              try {
                listener(payment);
              } catch (err) {
                console.error('❌ [BreezSparkService] Listener callback error:', err);
              }
            });
          }

          // Handle claim deposits events - trigger refresh for all listeners
          if (
            eventTag === 'claimDepositsSucceeded' ||
            eventTag === 'ClaimDepositsSucceeded'
          ) {
            const syncEvent: TransactionInfo = {
              id: 'sync-claim-succeeded-' + Date.now(),
              type: 'receive',
              amountSat: 0,
              feeSat: 0,
              status: 'completed',
              timestamp: Date.now(),
              description: '__SYNC_EVENT__',
            };

            paymentEventListeners.forEach((listener) => {
              try {
                listener(syncEvent);
              } catch (err) {
                console.error('❌ [BreezSparkService] Claim sync listener error:', err);
              }
            });
          }

          if (
            eventTag === 'claimDepositsFailed' ||
            eventTag === 'ClaimDepositsFailed'
          ) {
            const unclaimedDeposits = (
              evt?.inner?.unclaimedDeposits ||
              (event as Record<string, unknown>)?.unclaimedDeposits ||
              []
            ) as Array<Record<string, unknown>>;

            for (const dep of unclaimedDeposits) {
              const txid = String(dep?.txid || '');
              const vout = Number(dep?.vout || 0);
              if (!txid) continue;

              try {
                await claimDeposit(txid, vout);
              } catch (claimErr) {
                console.warn('⚠️ [BreezSparkService] Auto-retry claimDeposit failed:', claimErr);
              }
            }
          }

          // Handle Synced event - trigger refresh for all listeners
          if (eventTag === 'Synced') {
            // Create a "sync" event to notify listeners to refresh their data
            const syncEvent: TransactionInfo = {
              id: 'sync-' + Date.now(),
              type: 'receive',
              amountSat: 0,
              feeSat: 0,
              status: 'completed',
              timestamp: Date.now(),
              description: '__SYNC_EVENT__', // Special marker
            };
            // Notify listeners - they can check for this marker and refresh
            paymentEventListeners.forEach((listener) => {
              try {
                listener(syncEvent);
              } catch (err) {
                console.error('❌ [BreezSparkService] Sync listener error:', err);
              }
            });

            // Auto-claim any pending on-chain deposits
            try {
              const deposits = await listDeposits();
              for (const dep of deposits) {
                if (!dep.claimError) {
                  await claimDeposit(dep.txid, dep.vout);
                }
              }
            } catch (e) {
              console.warn('[BreezSparkService] Auto-claim check failed:', e);
            }
          }

        } catch (handlerError) {
          console.error('❌ [BreezSparkService] Event handler error:', handlerError);
        }
      }
    };

    // Add the event listener using sdk.addEventListener(listener)
    const listenerId = await sdkInstance.addEventListener(eventListener);
    console.log('✅ [BreezSparkService] Event listener added with ID:', listenerId);
    
    // Store the ID for later removal
    activeEventListenerId = listenerId;

  } catch (error) {
    console.warn('⚠️ [BreezSparkService] Failed to setup event listeners:', error);
    // Don't fail initialization if events don't work
  }
}

/**
 * Get current wallet balance
 */
export async function getBalance(): Promise<WalletBalance> {
  if (!_isNativeAvailable || !sdkInstance) {
    return { balanceSat: 0, pendingSendSat: 0, pendingReceiveSat: 0 };
  }

  try {
    // First try to get balance from getInfo()
    try {
      const info = await sdkInstance.getInfo({ ensureSynced: true });
      if (info) {
        return {
          balanceSat: Number(info.balanceSats || 0),
          pendingSendSat: Number(info.pendingSendSats || 0),
          pendingReceiveSat: Number(info.pendingReceiveSats || 0),
        };
      }
    } catch (infoError) {
      console.warn('⚠️ [BreezSparkService] getInfo() failed:', infoError);
    }

    // Re-check sdkInstance before fallback (could have disconnected during getInfo)
    if (!sdkInstance) {
      console.warn('⚠️ [BreezSparkService] SDK disconnected during balance fetch');
      return { balanceSat: 0, pendingSendSat: 0, pendingReceiveSat: 0 };
    }

    // Fallback: Calculate from payments
    const response = await sdkInstance.listPayments({});
    const payments = response.payments || [];

    let balanceSat = 0;
    let pendingSendSat = 0;
    let pendingReceiveSat = 0;

    for (const payment of payments) {
      // Spark SDK uses object status and plural Sats
      const status = mapPaymentStatus(payment.status);
      const paymentType = (payment.paymentType === 'receive' || String(payment.paymentType).toLowerCase() === 'receive') ? 'receive' : 'send';
      
      const amount = typeof payment.amountSats === 'bigint' 
        ? Number(payment.amountSats) 
        : Number(payment.amountSats || 0);
        
      const fees = typeof payment.feesSats === 'bigint' 
        ? Number(payment.feesSats) 
        : Number(payment.feesSats || 0);

      if (status === 'completed') {
        if (paymentType === 'receive') {
          balanceSat += amount;
        } else {
          balanceSat -= amount + fees;
        }
      } else if (status === 'pending') {
        if (paymentType === 'receive') {
          pendingReceiveSat += amount;
        } else {
          pendingSendSat += amount;
        }
      }
    }

    return {
      balanceSat: Math.max(0, balanceSat),
      pendingSendSat,
      pendingReceiveSat,
    };
  } catch (error) {
    console.error('❌ [BreezSparkService] Failed to get balance:', error);
    return { balanceSat: 0, pendingSendSat: 0, pendingReceiveSat: 0 };
  }
}

/**
 * Pay a Lightning invoice
 */
export async function payInvoice(
  paymentRequest: string,
  _amountSat?: number
): Promise<PaymentResult> {
  if (!_isNativeAvailable || !sdkInstance) {
    return { success: false, error: 'SDK not available' };
  }

  try {
    const prepareResponse = await sdkInstance.prepareSendPayment({
      paymentRequest,
      amount: _amountSat ? BigInt(_amountSat) : undefined,
    });

    const response = await sdkInstance.sendPayment({
      prepareResponse,
    });

    // Track this payment ID so we don't show "Payment Received" notification for it
    const paymentId = response.payment?.id;
    if (paymentId) {
      recentlySentPaymentIds.add(paymentId);
      if (__DEV__) {
        console.log('📤 [BreezSparkService] Tracking sent payment');
      }
      // Remove from tracking after timeout
      global.setTimeout(() => {
        recentlySentPaymentIds.delete(paymentId);
      }, SENT_PAYMENT_TRACKING_MS);

            // Trigger notification to recipient if possible
            try {
              // Attempt to extract destination from payment request
              const parsed = await sdkInstance.parse(paymentRequest);

              if (__DEV__) {
                console.log('🔍 [BreezSparkService] Parsed payment request metadata');
              }

              let recipientIdentifier: string | undefined;
              let identifierType: 'lightningAddress' | 'pubKey' = 'pubKey';

              // Check if this is a Lightning Address (preferred - unique per wallet)
              if (parsed.tag === 'LightningAddress' && parsed.inner) {
                const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
                recipientIdentifier = innerData?.lightningAddress || innerData?.address;
                identifierType = 'lightningAddress';
                if (__DEV__) {
                  console.log('🔍 [BreezSparkService] Detected Lightning Address recipient');
                }
              }
              // Also check if input looks like a Lightning Address (user@domain format)
              else if (paymentRequest.includes('@') && !paymentRequest.startsWith('ln')) {
                recipientIdentifier = paymentRequest.toLowerCase().trim();
                identifierType = 'lightningAddress';
                if (__DEV__) {
                  console.log('🔍 [BreezSparkService] Input is Lightning Address recipient');
                }
              }
              // Fall back to Bolt11 invoice parsing (may have LSP pubkey, not unique)
              else if (parsed.tag === 'Bolt11Invoice' && parsed.inner) {
                 const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
                 recipientIdentifier = innerData?.payeePubkey || innerData?.destination || innerData?.nodeId;
                 if (__DEV__) {
                   console.log('🔍 [BreezSparkService] Extracted recipient pubkey from invoice');
                 }
              }

              if (!recipientIdentifier || identifierType !== 'lightningAddress') {
                console.warn('⚠️ [BreezSparkService] Webhook push now owns remote notifications; skipping legacy client trigger (no unique lightning address identifier)');
              }
          } catch (err) {
              console.warn('⚠️ [BreezSparkService] Failed to parse payment request for notification:', err);
          }
    }

    return {
      success: true,
      paymentId,
    };
  } catch (error) {
    console.error('Failed to pay invoice:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment failed',
    };
  }
}

/**
 * Generate a Lightning invoice (or Spark address/invoice) to receive payment.
 *
 * - BTC, no amount: any-amount Bolt11 invoice (sender chooses).
 * - BTC, with `amountSat`: Bolt11 with that demand baked in.
 * - USDB, no amount: SparkAddress (sender chooses USDB amount).
 * - USDB, with `options.usdbAmount` (display units, e.g. 50.00): SparkInvoice
 *   with a token-base-unit amount the sender must match.
 *
 * @param amountSat   Amount in sats. Ignored for USDB invoices.
 * @param description Optional human-readable description.
 * @param options     Spark token routing + optional USDB demand amount.
 */
export async function receivePayment(
  amountSat: number,
  description?: string,
  options?: { tokenIdentifier?: string; usdbAmount?: number },
): Promise<ReceivePaymentResult> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  try {
    let paymentMethod: any;

    if (options?.tokenIdentifier) {
      // USDB / token receive path. SparkAddress is the "any amount" form;
      // SparkInvoice lets us bake in a token amount in base units. We use
      // the latter only when the caller specified one.
      // TODO(usdc): generalise the hardcoded decimals once additional
      // tokens land — query getTokensMetadata or the asset registry.
      const USDB_DECIMALS = 6;
      const wantsAmount = typeof options.usdbAmount === 'number' && options.usdbAmount > 0;

      if (wantsAmount) {
        const baseUnits = BigInt(
          Math.max(1, Math.floor((options.usdbAmount as number) * 10 ** USDB_DECIMALS)),
        );
        paymentMethod = BreezSDK.ReceivePaymentMethod.SparkInvoice.new({
          amount: baseUnits,
          tokenIdentifier: options.tokenIdentifier,
          expiryTime: BigInt(Math.floor(Date.now() / 1000) + 900),
          description: description || undefined,
          senderPublicKey: undefined,
        });
      } else {
        paymentMethod = {
          tag: 'SparkAddress',
          inner: {
            tokenIdentifier: options.tokenIdentifier,
          },
        };
      }
    } else {
      // BTC path — Bolt11 with optional amount.
      const invoiceParams: {
        description: string;
        amountSats?: bigint;
        expirySecs: number;
      } = {
        description: description || '',
        expirySecs: 900, // 15 minutes
      };
      if (amountSat && amountSat > 0) {
        invoiceParams.amountSats = BigInt(amountSat);
      }
      paymentMethod = BreezSDK.ReceivePaymentMethod.Bolt11Invoice.new(invoiceParams);
    }

    const response = await sdkInstance.receivePayment({
      paymentMethod,
    });

    return {
      paymentRequest: response.paymentRequest,
      feeSat: Number(response.fee),
    };
  } catch (error) {
    console.error('Failed to create receive invoice:', error);
    throw error;
  }
}

/**
 * Generate an on-chain bitcoin receive address/URI
 */
export async function receiveOnchain(): Promise<string> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  try {
    // SDK 0.13.6+: BitcoinAddress factory now takes an `inner` object with
    // `newAddress: boolean | undefined`. undefined → return existing
    // deposit address if one exists, otherwise create a fresh one. Calling
    // .new() with no args (the old signature) crashes inside the SDK with
    // "cannot read property newAddress of undefined".
    const response = await sdkInstance.receivePayment({
      paymentMethod: BreezSDK.ReceivePaymentMethod.BitcoinAddress.new({
        newAddress: undefined,
      }),
    });

    return response.paymentRequest;
  } catch (error) {
    console.error('Failed to generate on-chain receive address:', error);
    throw error;
  }
}

/**
 * List unclaimed on-chain deposits
 */
export async function listDeposits(): Promise<DepositInfo[]> {
  if (!_isNativeAvailable || !sdkInstance) {
    return [];
  }

  try {
    const response = await sdkInstance.listUnclaimedDeposits({});
    const deposits = response?.deposits || [];
    console.log(`🔍 [BreezSparkService] listUnclaimedDeposits: ${deposits.length} found`);

    return deposits.map((deposit: any) => ({
      txid: String(deposit?.txid || ''),
      vout: Number(deposit?.vout || 0),
      amountSats: Number(deposit?.amountSats || deposit?.amountSat || 0),
      claimError: deposit?.claimError,
    })).filter((deposit: DepositInfo) => !!deposit.txid);
  } catch (error) {
    console.error('❌ [BreezSparkService] Failed to list deposits:', error);
    return [];
  }
}

/**
 * Claim an on-chain deposit
 */
export async function claimDeposit(txid: string, vout: number): Promise<void> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  // Use network-recommended fees with leeway to prevent maxDepositClaimFeeExceeded
  let maxFee: unknown;
  try {
    maxFee = new BreezSDK.MaxFee.NetworkRecommended({ leewaySatPerVbyte: BigInt(2) });
  } catch {
    // Fall back to no maxFee (SDK default)
  }

  await sdkInstance.claimDeposit({ txid, vout, maxFee });
}

/**
 * List all payments/transactions
 */
export async function listPayments(): Promise<TransactionInfo[]> {
  if (!_isNativeAvailable || !sdkInstance) {
    console.log('⚠️ [BreezSparkService] listPayments: SDK not available');
    return [];
  }

  try {
    const response = await sdkInstance.listPayments({
      sortAscending: false,
    });

    const payments = response.payments || [];

    // Group payments by conversionId (shared across both legs of a swap)
    // so a single swap becomes ONE Transaction with both sides populated,
    // instead of two separate send/receive rows.
    const byConversionId = new Map<string, any[]>();
    for (const p of payments) {
      const cid = p?.details?.inner?.conversionInfo?.conversionId;
      if (typeof cid === 'string' && cid.length > 0) {
        const bucket = byConversionId.get(cid) ?? [];
        bucket.push(p);
        byConversionId.set(cid, bucket);
      }
    }
    // Ids of payments that are part of a pair (processed as swap row) —
    // the outer map will skip them when walking individually.
    const pairedPaymentIds = new Set<string>();
    for (const bucket of byConversionId.values()) {
      if (bucket.length >= 2) {
        for (const p of bucket) pairedPaymentIds.add(String(p?.id));
      }
    }

    // Helper: extract a normalized numeric amount + asset classification
    // for a single payment leg. Used both for the solo-payment path and
    // for swap-pair construction.
    const toBig = (v: unknown): bigint =>
      typeof v === 'bigint' ? v : BigInt(String(v ?? '0'));
    const isTokenLeg = (p: any): boolean => {
      const mNum = p?.method;
      const dTag = String(p?.details?.tag ?? '').toLowerCase();
      return mNum === 2 || dTag === 'token';
    };
    const legAmount = (p: any): number => Number(toBig(p?.amount ?? p?.amountSats ?? p?.amountSat ?? 0));
    const legFee = (p: any): number => Number(toBig(p?.fees ?? p?.feesSats ?? p?.feeSat ?? p?.fee ?? 0));

    // Breez emits only the RECEIVE side of each conversion as a Payment
    // (the send is internal to the conversion). So every conversion shows
    // up as a single leg carrying `details.inner.conversionInfo`. We detect
    // direction from the leg's method:
    //   method=2 (Token) + receive → BUY  (user paid BTC, received USDB)
    //   method=1 (Spark) + receive + conversionInfo → SELL (user paid USDB, received BTC)
    // The source amount isn't provided by the SDK — we approximate it from
    // current exchange rates so the UI can show both legs. Recent swaps
    // done in-app also get an optimistic entry via applySwapResult which
    // carries the precise source amount; the SDK reconciliation replaces
    // that with this estimated row, but any persisted local record could
    // override in the future.
    const out: TransactionInfo[] = [];
    const seenConversions = new Set<string>();
    // Pull current rates (module-level cache inside currency util) so we
    // can convert sats ↔ USDB for estimation. Fall back to 0 if missing.
    let usdPerBtc = 0;
    try {
      const { getCachedRates } = require('../utils/currency');
      const r = getCachedRates();
      usdPerBtc = r?.usd || 0;
    } catch {}
    for (const p of payments) {
      const convInfo = p?.details?.inner?.conversionInfo;
      if (!convInfo) continue;
      const cid = convInfo.conversionId;
      if (!cid || seenConversions.has(cid)) continue;
      seenConversions.add(cid);

      const tokenSide = isTokenLeg(p);
      const direction: 'BTC_TO_USDB' | 'USDB_TO_BTC' = tokenSide ? 'BTC_TO_USDB' : 'USDB_TO_BTC';
      const toAsset: 'BTC' | 'USDB' = tokenSide ? 'USDB' : 'BTC';
      const fromAsset: 'BTC' | 'USDB' = tokenSide ? 'BTC' : 'USDB';
      const toAmount = legAmount(p);
      const toFee = legFee(p);

      // Approximate the source amount via current rate. USDB decimals = 6.
      const USDB_DECIMALS = 6;
      let fromAmount = 0;
      if (usdPerBtc > 0) {
        if (direction === 'BTC_TO_USDB') {
          // toAmount = USDB base units; fromAmount = sats.
          // sats = (usdbBase / 10^decimals) / usdPerBtc * 1e8
          const usd = toAmount / 10 ** USDB_DECIMALS;
          fromAmount = Math.round((usd / usdPerBtc) * 1e8);
        } else {
          // toAmount = sats; fromAmount = USDB base units.
          const usd = (toAmount * usdPerBtc) / 1e8;
          fromAmount = Math.round(usd * 10 ** USDB_DECIMALS);
        }
      }

      const fee = Number(toBig(convInfo.fee ?? 0));

      const rawTime = p?.timestamp ?? 0;
      let timestamp = typeof rawTime === 'bigint' ? Number(rawTime) : Number(rawTime);
      if (timestamp > 0 && timestamp < 1e10) timestamp *= 1000;

      const innerMeta = p?.details?.inner?.metadata as Record<string, unknown> | undefined;
      const tokenIdentifier = typeof innerMeta?.identifier === 'string' ? innerMeta.identifier : undefined;

      out.push({
        id: String(p.id),
        type: 'receive', // the user-facing leg — they received the destination asset
        amountSat: 0, // unused for swaps — per-tab amount is in swap.{from,to}Amount
        feeSat: fee,
        status: mapPaymentStatus(p?.status),
        timestamp: timestamp || Date.now(),
        description: '',
        method: 'lightning',
        paymentType: 'conversion',
        asset: toAsset,
        tokenIdentifier,
        kind: 'swap',
        swap: {
          direction,
          fromAsset,
          fromAmount,
          fromFee: direction === 'BTC_TO_USDB' ? fee : 0,
          toAsset,
          toAmount,
          toFee: direction === 'USDB_TO_BTC' ? fee : 0,
        },
      });
    }

    // Second pass: remaining non-swap payments mapped individually.
    // Skip anything we already emitted as a swap row.
    const swapHandledIds = new Set(out.map((r) => r.id));
    const remaining = payments.filter((p: any) => !swapHandledIds.has(String(p?.id)));
    const individuals = remaining.map((payment: any, index: number) => {
      // Try multiple field name variations (SDK may return different formats)
      const rawAmount = payment.amount ?? payment.amountSats ?? payment.amountSat ?? 0;
      const amountSat = typeof rawAmount === 'bigint' ? Number(rawAmount) : Number(rawAmount);

      const rawFees = payment.fees ?? payment.feesSats ?? payment.feeSat ?? payment.fee ?? 0;
      const feeSat = typeof rawFees === 'bigint' ? Number(rawFees) : Number(rawFees);

      const rawTime = payment.timestamp ?? payment.createdAt ?? 0;
      let timestamp = typeof rawTime === 'bigint' ? Number(rawTime) : Number(rawTime);
      // Convert from seconds to milliseconds if needed
      if (timestamp > 0 && timestamp < 10000000000) {
        timestamp *= 1000;
      }

      // Determine payment type - try multiple formats
      let type: 'receive' | 'send' = 'send';
      const paymentType = payment.paymentType;
      if (
        paymentType === 1 || 
        paymentType === '1' || 
        paymentType === 'receive' || 
        String(paymentType).toLowerCase() === 'receive'
      ) {
        type = 'receive';
      }

      const description = payment.details?.inner?.description || payment.details?.description || payment.description || '';

      // RN SDK: method is numeric (0=lightning, 3=deposit, others TBD), details uses {tag, inner}
      // Web SDK: method is string ("lightning", "deposit"), details uses {type, txId}
      const methodNum = payment.method;
      const detailsTag = String(payment.details?.tag || '').toLowerCase();
      const detailsType = String(payment.details?.type || '').toLowerCase();
      const methodStr = String(methodNum ?? '').toLowerCase();

      // RN SDK method numbers: 0=Lightning, 1=Spark, 3=Deposit (on-chain receive), 4=Withdraw (on-chain send)
      const isOnchain =
        methodNum === 3 ||
        methodNum === 4 ||
        detailsTag === 'deposit' ||
        detailsTag === 'withdraw' ||
        methodStr.includes('deposit') ||
        methodStr.includes('withdraw');

      const method: 'lightning' | 'onchain' = isOnchain ? 'onchain' : 'lightning';

      const txid = payment.details?.inner?.txId || payment.details?.txId || payment.details?.txid || payment.txid;

      const mappedStatus = mapPaymentStatus(payment.status);
      const failureReasonRaw =
        payment.failureReason ||
        payment.error ||
        payment.claimError ||
        payment.details?.error ||
        payment.details?.failureReason ||
        payment.details?.claimError ||
        payment.status?.failedReason;
      const failureReason =
        typeof failureReasonRaw === 'string'
          ? failureReasonRaw
          : failureReasonRaw
            ? JSON.stringify(failureReasonRaw)
            : undefined;

      const rawPaymentType = String(payment.paymentType ?? '').trim();
      const paymentTypeNormalized = rawPaymentType.toLowerCase();
      // Token payments: details.tag === 'Token', with inner.metadata.identifier
      // holding the tokenIdentifier (btkn1…) and inner.metadata.ticker === 'USDB'.
      // Other payment details variants (Spark / Lightning) don't carry a token.
      const innerMeta = payment.details?.inner?.metadata as Record<string, unknown> | undefined;
      const tokenIdentifierRaw =
        innerMeta?.identifier ||
        innerMeta?.tokenIdentifier ||
        payment.details?.inner?.tokenIdentifier ||
        payment.details?.tokenIdentifier ||
        payment.tokenIdentifier;
      const tokenIdentifier =
        typeof tokenIdentifierRaw === 'string' && tokenIdentifierRaw.trim().length > 0
          ? tokenIdentifierRaw.trim()
          : undefined;
      const currencyRaw = String(
        payment.currency ||
        payment.asset ||
        payment.details?.currency ||
        payment.details?.inner?.currency ||
        payment.details?.inner?.ticker ||
        innerMeta?.ticker ||
        innerMeta?.symbol ||
        ''
      ).toUpperCase();
      const isTokenByTag = detailsTag === 'token' || methodNum === 2;
      const asset: 'BTC' | 'USDB' =
        currencyRaw === 'USDB' || isTokenByTag || tokenIdentifier ? 'USDB' : 'BTC';

      // Detect a swap. Breez surfaces both legs of a conversion on a single
      // Payment record via `conversionDetails = { from, to, status }`. Each
      // side is a ConversionStep with `amount`, `fee`, and `tokenMetadata`.
      // If tokenMetadata is set the step is in token base units; otherwise
      // it's in sats (BTC).
      const convDetails = (payment as any).conversionDetails as
        | {
            from?: { amount?: unknown; fee?: unknown; tokenMetadata?: { identifier?: string; ticker?: string; decimals?: number } | null };
            to?: { amount?: unknown; fee?: unknown; tokenMetadata?: { identifier?: string; ticker?: string; decimals?: number } | null };
          }
        | undefined;

      let kind: 'swap' | 'payment' = 'payment';
      let swapInfo: TransactionInfo['swap'];
      let normalizedPaymentType = paymentTypeNormalized || undefined;
      if (convDetails?.from && convDetails?.to) {
        const toBig = (v: unknown): bigint =>
          typeof v === 'bigint' ? v : BigInt(String(v ?? '0'));
        const fromIsToken = !!convDetails.from.tokenMetadata;
        const toIsToken = !!convDetails.to.tokenMetadata;
        const fromAsset: 'BTC' | 'USDB' = fromIsToken ? 'USDB' : 'BTC';
        const toAsset: 'BTC' | 'USDB' = toIsToken ? 'USDB' : 'BTC';
        const direction: 'BTC_TO_USDB' | 'USDB_TO_BTC' =
          fromAsset === 'BTC' ? 'BTC_TO_USDB' : 'USDB_TO_BTC';
        kind = 'swap';
        normalizedPaymentType = 'conversion';
        swapInfo = {
          direction,
          fromAsset,
          fromAmount: Number(toBig(convDetails.from.amount)),
          fromFee: Number(toBig(convDetails.from.fee)),
          toAsset,
          toAmount: Number(toBig(convDetails.to.amount)),
          toFee: Number(toBig(convDetails.to.fee)),
        };
      }

      return {
        id: payment.id,
        type,
        amountSat,
        feeSat,
        status: mappedStatus,
        timestamp: timestamp || Date.now(),
        description,
        method,
        txid: txid ? String(txid) : undefined,
        failureReason,
        paymentType: normalizedPaymentType,
        asset,
        tokenIdentifier,
        kind,
        swap: swapInfo,
      };
    });

    // Merge swap rows + individual rows, sorted by timestamp (newest first).
    const combined = [...out, ...individuals].sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    return combined;
  } catch (error) {
    console.error('❌ [BreezSparkService] Failed to list payments:', error);
    return [];
  }
}

/**
 * Get a specific payment by ID
 */
export async function syncWallet(): Promise<void> {
  if (!sdkInstance) {
    return;
  }

  await sdkInstance.syncWallet();
}

export async function getPayment(paymentId: string): Promise<TransactionInfo | null> {
  if (!_isNativeAvailable || !sdkInstance) {
    return null;
  }

  try {
    const response = await sdkInstance.getPayment({ paymentId });
    if (response.payment) {
      const p = response.payment;
      // Properly convert BigInt to number for amounts
      const amountSat = typeof p.amountSat === 'bigint'
        ? Number(p.amountSat)
        : p.amountSat;
      const feeSat = p.feesSat
        ? (typeof p.feesSat === 'bigint' ? Number(p.feesSat) : p.feesSat)
        : 0;
      // Convert timestamp from seconds to milliseconds
      const timestamp = typeof p.createdAt === 'bigint'
        ? Number(p.createdAt) * 1000
        : p.createdAt * 1000;

      return {
        id: p.id,
        type: (p.paymentType === 'receive' || p.paymentType === 'Receive') ? 'receive' : 'send',
        amountSat,
        feeSat,
        status: mapPaymentStatus(p.status),
        timestamp,
        description: p.description,
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to get payment:', error);
    return null;
  }
}

/**
 * Get Spark address for receiving payments
 */
export async function getSparkAddress(): Promise<string> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  try {
    const response = await sdkInstance.receivePayment({
      paymentMethod: {
        type: 'sparkAddress',
      },
    });

    return response.paymentRequest;
  } catch (error) {
    console.error('Failed to get Spark address:', error);
    throw error;
  }
}

/**
 * Pay to a Lightning address
 */
export async function payLightningAddress(
  address: string,
  amountSat: number,
  _comment?: string
): Promise<PaymentResult> {
  return await payInvoice(address, amountSat);
}

// =============================================================================
// Lightning Address Registration (LNURL)
// =============================================================================

/**
 * Check if a Lightning Address username is available
 * @param username - Desired username (without @domain)
 * @returns true if available, false if taken
 */
export async function checkLightningAddressAvailable(
  username: string
): Promise<boolean> {
  if (!_isNativeAvailable || !sdkInstance) {
    console.warn('⚠️ [BreezSparkService] checkLightningAddressAvailable: SDK not available');
    return false;
  }

  try {
    const request = { username };
    const available = await sdkInstance.checkLightningAddressAvailable(request);
    console.log(`✅ [BreezSparkService] Username "${username}" available:`, available);
    return available;
  } catch (error) {
    console.error('❌ [BreezSparkService] checkLightningAddressAvailable failed:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to check username availability'
    );
  }
}

/**
 * Register a Lightning Address
 * @param username - Desired username (without @domain)
 * @param description - Optional description for the address
 * @returns Registered address information
 */
export async function registerLightningAddress(
  username: string,
  description?: string
): Promise<LightningAddressInfo> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available. Please ensure the wallet is initialized.');
  }

  try {
    const request = {
      username,
      description: description || '',
    };
    const result = await sdkInstance.registerLightningAddress(request);

    const addressInfo: LightningAddressInfo = {
      lightningAddress: result.lightningAddress || `${username}@breez.tips`,
      username: result.username || username,
      description: result.description || description || '',
      lnurl: result.lnurl || '',
    };

    console.log('✅ [BreezSparkService] Lightning Address registered:', addressInfo.lightningAddress);
    return addressInfo;
  } catch (error) {
    console.error('❌ [BreezSparkService] registerLightningAddress failed:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to register Lightning Address'
    );
  }
}

/**
 * Get currently registered Lightning Address
 * @returns Address info or null if not registered
 */
export async function getLightningAddress(): Promise<LightningAddressInfo | null> {
  if (!_isNativeAvailable || !sdkInstance) {
    console.warn('⚠️ [BreezSparkService] getLightningAddress: SDK not available');
    return null;
  }

  try {
    const result = await sdkInstance.getLightningAddress();

    if (!result || !result.lightningAddress) {
      console.log('ℹ️ [BreezSparkService] No Lightning Address registered');
      return null;
    }

    const addressInfo: LightningAddressInfo = {
      lightningAddress: result.lightningAddress,
      username: result.username || result.lightningAddress.split('@')[0],
      description: result.description || '',
      lnurl: result.lnurl || '',
    };

    console.log('✅ [BreezSparkService] Got Lightning Address:', addressInfo.lightningAddress);
    return addressInfo;
  } catch (error) {
    console.error('❌ [BreezSparkService] getLightningAddress failed:', error);
    return null;
  }
}

/**
 * Unregister/delete the current Lightning Address
 */
export async function unregisterLightningAddress(): Promise<void> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available. Please ensure the wallet is initialized.');
  }

  try {
    await sdkInstance.deleteLightningAddress();
    console.log('✅ [BreezSparkService] Lightning Address unregistered');
  } catch (error) {
    console.error('❌ [BreezSparkService] unregisterLightningAddress failed:', error);
    throw new Error(
      error instanceof Error ? error.message : 'Failed to unregister Lightning Address'
    );
  }
}

/**
 * Parse and validate a payment request
 */
export async function parsePaymentRequest(input: string): Promise<{
  type: 'bolt11' | 'sparkInvoice' | 'lnurl' | 'lightningAddress' | 'bitcoinAddress' | 'sparkAddress' | 'unknown';
  isValid: boolean;
  /** Amount in sats. Set for BTC invoices (Bolt11 or sat-denominated SparkInvoice). */
  amountSat?: number;
  /**
   * Amount in **token base units** (NOT display units). Set for SparkInvoices
   * carrying a `tokenIdentifier`. Convert with `tokenAmount / 10^decimals` to
   * display units before showing it to the user.
   */
  tokenAmount?: number;
  description?: string;
  tokenIdentifier?: string;
}> {
  const trimmed = input.trim();
  const trimmedLower = trimmed.toLowerCase();

  // FIRST: Check for Lightning Address (user@domain.com) - handle locally, SDK doesn't support this
  // Must check before SDK parsing because SDK throws InvalidInput for Lightning Addresses
  if (trimmed.includes('@') && !trimmedLower.startsWith('lnurl') && !trimmedLower.startsWith('lnbc')) {
    const parts = trimmed.split('@');
    if (parts.length === 2 && parts[0] && parts[1] && parts[1].includes('.')) {
      // Valid Lightning Address format - no amount embedded, user must specify
      return { type: 'lightningAddress', isValid: true };
    }
  }

  // For other types, try SDK if available
  if (!_isNativeAvailable || !sdkInstance) {
    // Fallback to simple string matching if SDK not available
    if (trimmedLower.startsWith('lnurl')) {
      return { type: 'lnurl', isValid: true };
    }

    if (trimmedLower.startsWith('lnbc') || trimmedLower.startsWith('lntb') || trimmedLower.startsWith('lnbcrt')) {
      return { type: 'bolt11', isValid: true };
    }

    if (trimmedLower.startsWith('bc1') || trimmedLower.startsWith('1') || trimmedLower.startsWith('3') || trimmedLower.startsWith('tb1')) {
      return { type: 'bitcoinAddress', isValid: true };
    }

    if (trimmedLower.startsWith('sp1')) {
      return { type: 'sparkAddress', isValid: true };
    }

    return { type: 'unknown', isValid: false };
  }

  try {
    // Use SDK to parse for full details including amount
    const parsed = await sdkInstance.parse(trimmed);

    // Check the parsed result type
    if (parsed.tag === 'Bolt11Invoice' && parsed.inner) {
      // The inner might be an array with the invoice details as first element
      const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
      const invoiceDetails = innerData?.invoiceDetails || innerData;

      const amountSat = invoiceDetails?.amountMsat ? Number(invoiceDetails.amountMsat) / 1000 : undefined;

      return {
        type: 'bolt11',
        isValid: true,
        amountSat,
        description: invoiceDetails?.description,
        tokenIdentifier: invoiceDetails?.tokenIdentifier,
      };
    }

    if (parsed.tag === 'SparkInvoice' && parsed.inner) {
      const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
      const invoiceDetails = innerData?.invoiceDetails || innerData;

      // SparkInvoiceDetails.amount is a U128 denominated in:
      //   - sats              when tokenIdentifier is absent (BTC-on-Spark)
      //   - token base units  when tokenIdentifier is set    (USDB / future tokens)
      // U128 across the bridge usually arrives as a JS number for small values
      // and may also surface as a string. Coerce defensively.
      const tokenIdentifier: string | undefined = invoiceDetails?.tokenIdentifier;
      const rawAmount = invoiceDetails?.amount;
      const amountNum =
        typeof rawAmount === 'number'
          ? rawAmount
          : typeof rawAmount === 'string'
            ? Number(rawAmount)
            : typeof rawAmount === 'bigint'
              ? Number(rawAmount)
              : undefined;

      return {
        type: 'sparkInvoice',
        isValid: true,
        // BTC SparkInvoice → sats; token SparkInvoice → tokenAmount.
        amountSat: tokenIdentifier ? undefined : amountNum,
        tokenAmount: tokenIdentifier ? amountNum : undefined,
        description: invoiceDetails?.description,
        tokenIdentifier,
      };
    }


    if (parsed.tag === 'LightningAddress') {
      return { type: 'lightningAddress', isValid: true };
    }

    if (parsed.tag === 'Lnurl') {
      return { type: 'lnurl', isValid: true };
    }

    if (parsed.tag === 'BitcoinAddress') {
      return { type: 'bitcoinAddress', isValid: true };
    }

    if (parsed.tag === 'SparkAddress') {
      const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
      return {
        type: 'sparkAddress',
        isValid: true,
        tokenIdentifier: innerData?.tokenIdentifier,
      };
    }

    return { type: 'unknown', isValid: false };
  } catch (error) {
    console.error('Failed to parse payment request:', error);
    return { type: 'unknown', isValid: false };
  }
}

/**
 * Prepare a payment (get fee estimate)
 * Handles both BOLT11 invoices and Lightning Addresses (via LNURL resolution)
 */
export async function prepareSendPayment(
  paymentRequest: string,
  amountSat?: number,
  options?: { tokenIdentifier?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!_isNativeAvailable || !sdkInstance) {
    throw new Error('SDK not available');
  }

  const trimmed = paymentRequest.trim();
  
  // Check if this is a Lightning Address (user@domain.com format)
  if (trimmed.includes('@') && !trimmed.toLowerCase().startsWith('lnurl') && !trimmed.toLowerCase().startsWith('lnbc')) {
    // Lightning Address needs to be resolved to LNURL pay endpoint first
    const parts = trimmed.split('@');
    if (parts.length === 2 && parts[0] && parts[1] && parts[1].includes('.')) {
      const [username, domain] = parts;
      const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
      
      if (__DEV__) {
        console.log('🔗 [BreezSparkService] Resolving Lightning Address');
      }
      
      try {
        // Step 1: Fetch LNURL pay data
        const lnurlResponse = await fetch(lnurlEndpoint);
        if (!lnurlResponse.ok) {
          throw new Error(`Failed to resolve Lightning Address: HTTP ${lnurlResponse.status}`);
        }
        
        const lnurlData = await lnurlResponse.json();
        if (__DEV__) {
          console.log('🔗 [BreezSparkService] LNURL pay metadata received');
        }
        
        if (lnurlData.tag !== 'payRequest') {
          throw new Error('Lightning Address does not support payments');
        }
        
        // Validate amount against min/max
        const amountMsat = (amountSat || 0) * 1000;
        if (amountMsat < lnurlData.minSendable) {
          throw new Error(`Amount too small. Minimum: ${Math.ceil(lnurlData.minSendable / 1000)} sats`);
        }
        if (amountMsat > lnurlData.maxSendable) {
          throw new Error(`Amount too large. Maximum: ${Math.floor(lnurlData.maxSendable / 1000)} sats`);
        }
        
        // Step 2: Request BOLT11 invoice from callback
        const callbackUrl = new URL(lnurlData.callback);
        callbackUrl.searchParams.set('amount', amountMsat.toString());
        
        if (__DEV__) {
          console.log('🔗 [BreezSparkService] Requesting Lightning invoice');
        }
        
        const invoiceResponse = await fetch(callbackUrl.toString());
        if (!invoiceResponse.ok) {
          throw new Error(`Failed to get invoice: HTTP ${invoiceResponse.status}`);
        }
        
        const invoiceData = await invoiceResponse.json();
        if (__DEV__) {
          console.log('🔗 [BreezSparkService] Invoice response received');
        }
        
        if (invoiceData.status === 'ERROR') {
          throw new Error(invoiceData.reason || 'Failed to generate invoice');
        }
        
        if (!invoiceData.pr) {
          throw new Error('No invoice received from Lightning Address provider');
        }
        
        // Step 3: Now prepare payment with the BOLT11 invoice
        if (__DEV__) {
          console.log('🔗 [BreezSparkService] Preparing payment with resolved invoice');
        }
        
        return await sdkInstance.prepareSendPayment({
          paymentRequest: invoiceData.pr,
          // Don't pass amount for BOLT11 with embedded amount
        });
        
      } catch (error) {
        console.error('❌ [BreezSparkService] Lightning Address resolution failed:', error);
        throw error;
      }
    }
  }

  // For BOLT11, LNURL, or other formats, pass directly to SDK
  return await sdkInstance.prepareSendPayment({
    paymentRequest: trimmed,
    amount: amountSat ? BigInt(amountSat) : undefined,
    tokenIdentifier: options?.tokenIdentifier,
  });
}

/**
 * Send a prepared on-chain payment
 * @param prepareResponse - The response from prepareSendPayment
 * @param confirmationSpeed - Desired confirmation speed
 * @param idempotencyKey - Optional idempotency key
 */
export async function sendOnchainPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepareResponse: any,
  confirmationSpeed: 'fast' | 'medium' | 'slow',
  idempotencyKey?: string
): Promise<PaymentResult> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!_isNativeAvailable) {
      return { success: false, error: 'SDK not available (native module missing)' };
    }

    if (!sdkInstance) {
      if (attempt < MAX_RETRIES) {
        console.log(
          '⏳ [BreezSparkService] SDK instance not ready, retrying in ' +
            RETRY_DELAY_MS +
            'ms (attempt ' +
            attempt +
            '/' +
            MAX_RETRIES +
            ')'
        );
        await new Promise(resolve => global.setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      return { success: false, error: 'SDK not available (not initialized)' };
    }

    break;
  }

  try {
    // Import the SDK enum types for proper serialization
    const { SendPaymentOptions, OnchainConfirmationSpeed } = require('@breeztech/breez-sdk-spark-react-native');

    const speedEnumValue =
      confirmationSpeed === 'fast'
        ? OnchainConfirmationSpeed.Fast
        : confirmationSpeed === 'slow'
          ? OnchainConfirmationSpeed.Slow
          : OnchainConfirmationSpeed.Medium;

    const options = new SendPaymentOptions.BitcoinAddress({
      confirmationSpeed: speedEnumValue,
    });

    const response = await sdkInstance.sendPayment({
      prepareResponse,
      idempotencyKey,
      options,
    });

    const paymentId = response.payment?.id;
    if (paymentId) {
      recentlySentPaymentIds.add(paymentId);
      global.setTimeout(() => {
        recentlySentPaymentIds.delete(paymentId);
      }, SENT_PAYMENT_TRACKING_MS);
    }

    return {
      success: true,
      paymentId,
    };
  } catch (error) {
    console.error('Failed to send on-chain payment:', error);
    console.error('On-chain payment error details:', extractSdkErrorDetails(error));
    return {
      success: false,
      error: extractSdkErrorMessage(error, 'On-chain payment failed'),
      errorDetails: extractSdkErrorDetails(error),
    };
  }
}

/**
 * Send a prepared payment
 * @param prepareResponse - The response from prepareSendPayment
 * @param originalPaymentRequest - Original payment request (for notification trigger)
 * @param amountSat - Amount in sats (for notification)
 * @param idempotencyKey - Optional idempotency key
 */
export async function sendPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepareResponse: any,
  originalPaymentRequest?: string,
  amountSat?: number,
  idempotencyKey?: string
): Promise<PaymentResult> {
  // Retry logic for temporary SDK unavailability (e.g., during wallet switch)
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 500;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (!_isNativeAvailable) {
      return { success: false, error: 'SDK not available (native module missing)' };
    }

    if (!sdkInstance) {
      if (attempt < MAX_RETRIES) {
        console.log(`⏳ [BreezSparkService] SDK instance not ready, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => global.setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      return { success: false, error: 'SDK not available (not initialized)' };
    }

    break; // SDK is available, proceed
  }

  try {
    const response = await sdkInstance.sendPayment({
      prepareResponse,
      idempotencyKey,
    });

    // Track this payment ID so we don't show "Payment Received" notification for it
    const paymentId = response.payment?.id;
    if (paymentId) {
      recentlySentPaymentIds.add(paymentId);
      if (__DEV__) {
        console.log('📤 [BreezSparkService] Tracking sent payment (sendPayment)');
      }
      // Remove from tracking after timeout
      global.setTimeout(() => {
        recentlySentPaymentIds.delete(paymentId);
      }, SENT_PAYMENT_TRACKING_MS);

      // Trigger notification to recipient
      try {
        let recipientIdentifier: string | undefined;
        let identifierType: 'lightningAddress' | 'pubKey' = 'pubKey';

        // Method 1: Check if original input is a Lightning Address (most reliable)
        if (originalPaymentRequest?.includes('@') && !originalPaymentRequest.startsWith('ln')) {
          recipientIdentifier = originalPaymentRequest.toLowerCase().trim();
          identifierType = 'lightningAddress';
          if (__DEV__) {
            console.log('🔍 [BreezSparkService] Input is Lightning Address recipient');
          }
        }

        // Method 2: Try to get destination from payment result (like web extension)
        if (!recipientIdentifier && response.payment) {
          const payment = response.payment as Record<string, unknown>;
          const details = payment.details as Record<string, unknown> | undefined;
          const destPubkey = details?.destinationPubkey || details?.destination || payment.destinationPubkey;
          if (destPubkey && typeof destPubkey === 'string') {
            recipientIdentifier = destPubkey;
            identifierType = 'pubKey';
            if (__DEV__) {
              console.log('🔍 [BreezSparkService] Got destination from payment result');
            }
          }
        }

        // Method 3: Fall back to parsing original input
        if (!recipientIdentifier && originalPaymentRequest && sdkInstance) {
          try {
            const parsed = await sdkInstance.parse(originalPaymentRequest);
            if (__DEV__) {
              console.log('🔍 [BreezSparkService] Parsed for notification:', parsed?.tag);
            }

            if (parsed.tag === 'LightningAddress' && parsed.inner) {
              const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
              recipientIdentifier = innerData?.lightningAddress || innerData?.address;
              identifierType = 'lightningAddress';
            } else if (parsed.tag === 'Bolt11Invoice' && parsed.inner) {
              const innerData = Array.isArray(parsed.inner) ? parsed.inner[0] : parsed.inner;
              recipientIdentifier = innerData?.payeePubkey || innerData?.destination || innerData?.nodeId;
              identifierType = 'pubKey';
            }
          } catch (parseErr) {
            console.warn('⚠️ [BreezSparkService] Parse failed, continuing with other methods:', parseErr);
          }
        }

        if (!recipientIdentifier || identifierType !== 'lightningAddress') {
          console.warn('⚠️ [BreezSparkService] Webhook push now owns remote notifications; skipping legacy client trigger (no unique lightning address identifier)');
        }
      } catch (err) {
        console.warn('⚠️ [BreezSparkService] Failed to trigger notification:', err);
      }
    }

    return {
      success: true,
      paymentId,
    };
  } catch (error) {
    console.error('Failed to send payment:', error);
    console.error('Send payment error details:', extractSdkErrorDetails(error));
    return {
      success: false,
      error: extractSdkErrorMessage(error, 'Payment failed'),
      errorDetails: extractSdkErrorDetails(error),
    };
  }
}

/**
 * Add event listener for payment updates
 */
export function addPaymentListener(
  _callback: (payment: TransactionInfo) => void
): () => void {
  console.log('Payment listener registered');
  return () => {
    console.log('Payment listener removed');
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPaymentStatus(status: any): 'pending' | 'completed' | 'failed' {
  // Handle numeric status codes from Breez SDK
  if (typeof status === 'number') {
    if (status === 0) return 'completed'; // Completed
    if (status === 1) return 'pending';   // Pending
    if (status === 2) return 'failed';    // Failed
    return 'pending'; // Default for unknown numeric codes
  }
  
  // Handle object status (e.g., { type: 'completed' })
  let s: string;
  if (typeof status === 'object' && status !== null) {
    s = (status.type || status.variant || '').toLowerCase();
  } else {
    s = String(status || '').toLowerCase();
  }
  
  if (s === 'completed' || s === 'complete' || s === 'succeeded') {
    return 'completed';
  }
  if (s === 'failed' || s === 'canceled') {
    return 'failed';
  }
  return 'pending';
}

// =============================================================================
// Exports
// =============================================================================

export const BreezSparkService = {
  isNativeAvailable,
  initializeSDK,
  disconnectSDK,
  beginDisconnectSDK,
  isSDKInitialized,
  getRawSdkInstanceForDevtools,
  resolveSwapTokens,
  getTokenBalances,
  fetchSwapLimits,
  prepareSwap,
  executeSwap,
  getBalance,
  prepareSendPayment,
  sendPayment,
  sendOnchainPayment,
  payInvoice,
  receivePayment,
  receiveOnchain,
  listDeposits,
  claimDeposit,
  getSparkAddress,
  listPayments,
  syncWallet,
  getPayment,
  payLightningAddress,
  parsePaymentRequest,
  addPaymentListener,
  // Lightning Address Registration
  checkLightningAddressAvailable,
  registerLightningAddress,
  getLightningAddress,
  unregisterLightningAddress,
};

export default BreezSparkService;
