# BTC ⇄ USDB Swap — Technical Design

## 1. Overview

The Swap feature lets users exchange BTC (sats) and USDB using the Breez SDK Spark conversion primitive. There is no dedicated `swap()` SDK method. The implementation uses a **self-payment pattern**: generate a Spark receive address on the same wallet for the destination currency, then call `prepareSendPayment()` with `ConversionOptions`. The SDK routes the conversion through the Flashnet AMM internally.

Reference: https://sdk-doc-spark.breez.technology/guide/token_conversion.html

### Token configuration — hybrid static/runtime discovery

The static `SWAP_TOKENS` array holds display metadata (label, ticker, icon, preferred display decimals).
The opaque SDK `tokenIdentifier` string and the canonical `decimals` are resolved at runtime from
`getTokensMetadata()` on first connected session and cached in-memory. This avoids hardcoding a
Breez-specific string and allows future tokens to be added purely via this array.

```typescript
// src/config/swapTokens.ts

export type SwapTokenConfig = {
  id: 'USDB';                    // internal ID used in routing / analytics / settings
  ticker: string;                // canonical ticker to match against TokenMetadata.ticker (e.g. "USDB")
  label: string;                 // display label (same as ticker for now)
  displayDecimals: number;       // decimals used for user-facing formatting (2 for USD-like)
  icon?: ImageSourcePropType;
};

// SWAP_TOKENS is the single source of truth for supported conversion tokens.
// Adding USDT/USDC in a future release is a config-only change here.
export const SWAP_TOKENS: readonly SwapTokenConfig[] = [
  { id: 'USDB', ticker: 'USDB', label: 'USDB', displayDecimals: 2 },
] as const;

export const USDB_TOKEN = SWAP_TOKENS[0];

// Populated at runtime — see breezSparkService.resolveSwapTokenIdentifier()
export interface ResolvedSwapToken extends SwapTokenConfig {
  tokenIdentifier: string;       // opaque Spark token ID from getTokensMetadata()
  internalDecimals: number;      // TokenMetadata.decimals — authoritative for amount math
}
```

Runtime resolution (pseudocode in `breezSparkService.ts`):

```typescript
let cachedResolvedTokens: ResolvedSwapToken[] | null = null;

export async function resolveSwapTokens(): Promise<ResolvedSwapToken[]> {
  if (cachedResolvedTokens) return cachedResolvedTokens;

  // First, discover token identifiers. The SDK requires identifiers to be
  // passed into getTokensMetadata, which is chicken-and-egg: we need to either
  // (a) have the identifier baked in via Breez config / env, or
  // (b) query it from an auxiliary SDK surface (TBD — see task T02a spike).
  // This function will be completed once T02a resolves the discovery mechanism.
  const metadata = await sdk.getTokensMetadata({ tokenIdentifiers: [/* TBD */] });

  cachedResolvedTokens = SWAP_TOKENS.map((cfg) => {
    const match = metadata.tokensMetadata.find((m) => m.ticker === cfg.ticker);
    if (!match) throw new Error(`Swap token ${cfg.ticker} not found on Spark`);
    return { ...cfg, tokenIdentifier: match.identifier, internalDecimals: match.decimals };
  });
  return cachedResolvedTokens;
}
```

**BigInt / U128 boundary**: the SDK uses `U128` (BigInt-backed) for all token and sat amounts.
The hook and UI work in `bigint` for source-of-truth amounts and convert to `number` only for
display formatting. Never pass a float to the SDK.

---

## 2. File Map

| File | Role |
|---|---|
| `app/wallet/swap.tsx` | Expo Router route — mounts `SwapScreen` |
| `src/features/wallet/screens/SwapScreen.tsx` | Top-level screen component, owns `useSwap` hook |
| `src/features/wallet/components/SwapAmountCard.tsx` | "You pay" / "You receive" card |
| `src/features/wallet/components/SwapRateLine.tsx` | Rate / fee / slippage summary row |
| `src/features/wallet/components/SwapReviewModal.tsx` | Confirmation dialog |
| `src/features/wallet/components/SwapResultView.tsx` | Success / Dust / Refunded / Error terminal states |
| `src/hooks/useSwap.ts` | State machine + business logic |
| `src/services/breezSparkService.ts` | Extended with `fetchConversionLimits`, `prepareSwap`, `executeSwap` |
| `src/config/swapTokens.ts` | Token registry (see above) |
| `src/locales/` (via `i18nService.ts`) | `swap.*` i18n keys added to EN + BG |

Existing files consumed (read-only from swap's perspective):

- `src/hooks/useWalletAuth.ts` — biometric gate
- `src/hooks/useLanguage.ts` — `t()` translations
- `src/contexts/ThemeContext.tsx` — `useAppTheme()`
- `src/utils/theme-helpers.ts` — `getGradientColors`, `BRAND_COLOR`
- `src/utils/currency.ts` — `satsToFiat`, `format`
- `src/services/breezSparkService.ts` — `extractSdkErrorMessage`

---

## 3. Component Tree

```
SwapScreen (app/wallet/swap.tsx)
├── LinearGradient (getGradientColors)
└── SafeAreaView
    └── ScrollView
        ├── SwapAmountCard  [You pay]
        │   ├── CurrencyLabel
        │   ├── AmountInput (TextInput)
        │   ├── FiatEquivalent (read-only, satsToFiat)
        │   └── MaxButton
        ├── FlipButton (IconButton swap-horizontal)
        ├── SwapAmountCard  [You receive]
        │   ├── CurrencyLabel
        │   ├── SkeletonShimmer  (Typing state only)
        │   └── AmountDisplay (read-only)
        ├── SwapRateLine
        │   ├── RateText
        │   ├── FeeText
        │   └── SlippageText + AdvancedToggle
        ├── InlineError (Below-min / Above-max / Insufficient)
        └── ReviewButton (Button mode="contained")

SwapReviewModal (Dialog)
├── DialogTitle
├── DialogContent
│   ├── DirectionRow
│   ├── YouPayRow
│   ├── YouReceiveRow
│   ├── RateRow
│   ├── FeeRow
│   └── SlippageRow
└── DialogActions
    ├── CancelButton (outlined)
    └── ConfirmButton (contained) → triggers biometric

SwapResultView  (replaces card area in terminal states)
├── [Success]     CheckIcon + amounts + DoneButton
├── [DustResidual] CheckIcon + amounts + DustNote + DoneButton
├── [Refunded]    InfoIcon + title + body + TryAgainButton + IncreaseSlippageButton
└── [Error]       ErrorIcon + message + RetryButton
```

---

## 4. State Machine

States are modelled as a discriminated union in `useSwap.ts`.

```
SwapState =
  | { status: 'idle' }
  | { status: 'typing' }
  | { status: 'quoteLoading' }
  | { status: 'quoteLoaded';   quote: SwapQuote }
  | { status: 'quoteRefreshing'; quote: SwapQuote }   // background re-fetch; shows stale quote
  | { status: 'insufficientBalance'; quote: SwapQuote }
  | { status: 'belowMin'; min: number }
  | { status: 'aboveMax'; max: number }
  | { status: 'reviewing';   quote: SwapQuote }       // modal open
  | { status: 'confirming' }                          // biometric passed, SDK call in flight
  | { status: 'success';     result: SwapResult }
  | { status: 'dustResidual'; result: SwapResult; residualUsdb: number }
  | { status: 'refunded';    latestQuote: SwapQuote }
  | { status: 'error';       message: string; retryable: boolean }
```

### Transition table

```
idle                 --[amountChanged]-->        typing
typing               --[debounce 400ms]-->       quoteLoading
typing               --[amountCleared]-->        idle
quoteLoading         --[quoteOk, valid]-->       quoteLoaded
quoteLoading         --[quoteOk, belowMin]-->    belowMin
quoteLoading         --[quoteOk, aboveMax]-->    aboveMax
quoteLoading         --[quoteOk, overBalance]--> insufficientBalance
quoteLoading         --[quoteFail]-->            error
quoteLoading         --[amountChanged]-->        typing    (abandons current fetch)

quoteLoaded          --[10s idle timer]-->       quoteRefreshing
quoteLoaded          --[amountChanged]-->        typing
quoteLoaded          --[slippageChanged]-->      typing    (re-quotes with new slippageBps)
quoteLoaded          --[directionFlipped]-->     idle      (amount cleared)
quoteLoaded          --[tapReview]-->            reviewing

quoteRefreshing      --[quoteOk]-->              quoteLoaded  (flash: green if received more, amber if less, only if rate moved >0.1% absolute)
quoteRefreshing      --[quoteFail]-->            quoteLoaded  (silent; keep stale quote)
quoteRefreshing      --[amountChanged]-->        typing

insufficientBalance  --[amountChanged]-->        typing
belowMin             --[amountChanged]-->        typing
aboveMax             --[amountChanged]-->        typing

reviewing            --[tapCancel]-->            quoteLoaded
reviewing            --[authOk]-->               confirming
reviewing            --[authFail]-->             reviewing    (show inline error in modal; Confirm re-enabled)

confirming           --[sdkSuccess, no dust]-->  success
confirming           --[sdkSuccess, dust>0]-->   dustResidual
confirming           --[sdkRefund]-->            refunded
confirming           --[sdkTimeout]-->           error (retryable=true, preserves lastAmount + lastDirection)
confirming           --[sdkError]-->             error (retryable=true, preserves lastAmount + lastDirection)
confirming           --[appBackgrounded]-->      confirming  (no state change; recovery happens on resume)
confirming           --[appResumed]-->           [syncWallet + inspect listPayments → resolve to success/dustResidual/refunded/error]

success              --[tapDone]-->              [navigate home]
dustResidual         --[tapDone]-->              [navigate home]
refunded             --[tapTryAgain]-->          quoteLoading  (re-quote with preserved amount + slippage)
refunded             --[tapIncreaseSlippage]-->  [open Advanced slippage in current screen]

error                --[tapRetry]-->             typing       (restores preserved lastAmount; re-quotes)
```

**Re-entry guard**: `reviewing --[authOk]--> confirming` must be idempotent. The Confirm button in
`SwapReviewModal` disables itself on first tap and re-enables only on authFail. This prevents
double-swap from rapid taps during the auth prompt dismiss.

---

## 5. SDK Call Sequences

Pseudocode below matches the actual SDK shapes verified against `breez_sdk_spark.ts` in
`@breeztech/breez-sdk-spark-react-native@0.13.1`. All SDK amounts are `U128` (BigInt-backed).

### 5.1 Fetch limits (on mount)

```typescript
// breezSparkService.ts — fetchSwapLimits(direction): Promise<SwapLimits>
//
// The SDK's fetchConversionLimits() returns limits keyed by direction.
// Builder: verify exact field names against the 0.13.1 TS types once installed.

const limits = await sdk.fetchConversionLimits();
// Expected shape (verify at implementation time):
// { fromBitcoin: { minSat: U128, maxSat: U128 },
//   toBitcoin:   { minTokenBaseUnits: U128, maxTokenBaseUnits: U128 } }

// The hook consumes limits in the unit appropriate for the active direction:
// BTC→USDB uses fromBitcoin.* (sats), USDB→BTC uses toBitcoin.* (USDB base units).
```

### 5.2 Prepare quote

```typescript
// breezSparkService.ts — prepareSwap(params: PrepareSwapParams): Promise<SwapQuote>
//
// ⚠️ SELF-PAYMENT PATTERN — important for future maintainers:
// We are NOT paying an external recipient. The Breez SDK (as of 0.13.1) exposes
// no dedicated convert() or swap() method — token conversion is only available
// via the payment flow with ConversionOptions. To build a pure BTC⇄USDB swap,
// we generate a Spark receive address on our OWN wallet for the destination
// currency, then call prepareSendPayment() with ConversionOptions. The SDK
// routes through the Flashnet AMM internally and credits the destination
// currency back to us. This is architecturally a self-swap, not a standard
// payment. Do not remove the self-address generation step.
//
// Ref: https://sdk-doc-spark.breez.technology/guide/token_conversion.html

const usdb = (await resolveSwapTokens())[0]; // ResolvedSwapToken for USDB

// Step 1: build a Spark receive address on our own wallet, for the DESTINATION currency.
// ReceivePaymentMethod.SparkAddress carries the tokenIdentifier inside `inner`.
const receiveResp = await sdk.receivePayment({
  paymentMethod: {
    tag: 'SparkAddress',
    inner: {
      tokenIdentifier:
        direction === 'BTC_TO_USDB' ? usdb.tokenIdentifier : undefined,
    },
  },
});
// receiveResp.paymentRequest is the self-address string we'll pay to.

// Step 2: prepare the send with conversion options.
// PrepareSendPaymentRequest fields (verified):
//   paymentRequest: string
//   amount?: U128 (bigint)              — required for Spark addresses
//   tokenIdentifier?: string            — source currency; undefined = sats
//   conversionOptions?: ConversionOptions
//   feePolicy?: FeePolicy
const prepared = await sdk.prepareSendPayment({
  paymentRequest: receiveResp.paymentRequest,
  amount: amountU128,                    // bigint, not number
  tokenIdentifier:
    direction === 'USDB_TO_BTC' ? usdb.tokenIdentifier : undefined,
  conversionOptions: {
    conversionType:
      direction === 'BTC_TO_USDB'
        ? { tag: 'FromBitcoin' }
        : { tag: 'ToBitcoin', inner: { fromTokenIdentifier: usdb.tokenIdentifier } },
    maxSlippageBps: slippageBps,         // default 50
    completionTimeoutSecs: 30,           // source of truth for timeout (see §9)
  },
});

// prepared.paymentMethod (SendPaymentMethod variant) carries fee + token info.
// The ConversionEstimate (if the SDK returns it at prepare time) gives amountIn / amountOut / fee.
// Builder: wire the exact response field names against TS types at implementation time.

return {
  direction,
  preparedPayment: prepared,             // opaque — passed verbatim to executeSwap
  payAmount: amountU128,                 // bigint
  receiveAmount: prepared.conversionEstimate?.amountOut ?? 0n,
  feeSat: prepared.paymentMethod.inner.fee,     // U128 → bigint
  rate: computeRate(amountU128, receiveAmount), // displayed only; avoid precision pitfalls
  slippageBps,
  fetchedAt: Date.now(),
};
```

### 5.3 Execute swap

```typescript
// breezSparkService.ts — executeSwap(quote: SwapQuote): Promise<SwapOutcome>
//
// ⚠️ TIMEOUT STRATEGY: we rely on the SDK's completion_timeout_secs (30s) passed
// in step 5.2 as the single source of truth. We do NOT wrap this call in a
// Promise.race with a JS-side timer — doing so creates a race where the SDK
// completes after the UI gives up, leaving the wallet in a divergent state.
// If the SDK hangs beyond 30s + a small grace window (e.g. 35s hard ceiling),
// we surface an error but mark it as "uncertain" and trigger syncWallet() on
// recovery to reconcile against authoritative payment state.
//
// ⚠️ SLIPPAGE REFUND DETECTION — mechanism determined empirically in kanban #679:
// Per Breez docs: "When a conversion fails due to exceeding the maximum
// slippage, the conversion will be refunded automatically." Whether this
// surfaces as (a) a thrown error with a specific variant or (b) a successful
// payment with a refund flag in the result is UNRESOLVED at spec-write time.
// Instead of writing a memo, kanban #679 includes a Phase 2 spike harness
// (src/devtools/swapSpike.ts) that runs a real tight-slippage swap against
// the installed 0.13.1 SDK and logs the result shape. Findings get written
// to .kiro/specs/btc-usdb-swap/spike-results.md. Whichever branch below the
// spike confirms is kept; the losing branch is deleted when #751 (executeSwap)
// implements the confirmed mechanism, along with the dev-only swapSpike.ts.

type SwapOutcome =
  | { kind: 'success'; result: SwapResult }
  | { kind: 'dustResidual'; result: SwapResult; residualUsdbBaseUnits: bigint }
  | { kind: 'refunded' }
  | { kind: 'error'; message: string; retryable: boolean };

// Snapshot pre-swap USDB balance for dust detection on USDB→BTC swaps.
const preBalance =
  quote.direction === 'USDB_TO_BTC' ? await getTokenBalance(usdb.tokenIdentifier) : 0n;

try {
  const payment = await sdk.sendPayment({ preparedPayment: quote.preparedPayment });

  // Branch A (if refund is signalled as a successful-but-refunded payment):
  if (payment.isRefund === true /* or payment.status === 'Refunded' — TBD */) {
    return { kind: 'refunded' };
  }

  // Dust residual check — only meaningful for USDB→BTC.
  if (quote.direction === 'USDB_TO_BTC') {
    const postBalance = await getTokenBalance(usdb.tokenIdentifier);
    if (postBalance > 0n) {
      return {
        kind: 'dustResidual',
        result: toSwapResult(payment, quote),
        residualUsdbBaseUnits: postBalance,
      };
    }
  }

  return { kind: 'success', result: toSwapResult(payment, quote) };
} catch (err) {
  // Branch B (if refund is signalled as a specific error variant):
  if (isSlippageRefundError(err) /* helper TBD from T02a */) {
    return { kind: 'refunded' };
  }
  if (isTimeoutError(err)) {
    // UI will trigger syncWallet() to reconcile; err may resolve to success later.
    return { kind: 'error', message: t('swap.error.timeoutBody'), retryable: true };
  }
  return {
    kind: 'error',
    message: extractSdkErrorMessage(err),
    retryable: true,
  };
}
```

### 5.4 Backgrounding recovery

```typescript
// useSwap.ts — on AppState change to 'active' while in 'confirming' state:
if (state.status === 'confirming') {
  await sdk.syncWallet();
  const payments = await sdk.listPayments({ /* filter to recent conversions */ });
  const match = payments.find((p) => p.id === state.inFlightPaymentId);
  if (match) {
    // Map payment status to terminal state — see resolvePaymentToOutcome() helper.
  }
  // If no match found within a short grace window, keep Confirming until timeout.
}
```

---

## 6. Data Model

All SDK-boundary amounts are `bigint` (U128). Convert to `number` only at the display layer.

### SwapQuote (in-memory, not persisted)

```typescript
interface SwapQuote {
  direction: 'BTC_TO_USDB' | 'USDB_TO_BTC';
  // Amounts in base units: sats for BTC, USDB base units for USDB.
  payAmount: bigint;
  receiveAmount: bigint;
  feeSat: bigint;               // SDK returns fee in sats regardless of direction
  rate: number;                 // display-only — computed from pay/receive, avoid precision-sensitive math
  slippageBps: number;
  fetchedAt: number;            // Date.now()
  preparedPayment: unknown;     // opaque SDK PreparedPayment, passed verbatim to executeSwap
}
```

### SwapResult (in-memory, passed to result view)

```typescript
interface SwapResult {
  direction: 'BTC_TO_USDB' | 'USDB_TO_BTC';
  paymentId: string;            // SDK-assigned payment id, used for history linkage
  conversionId?: string;        // Flashnet conversion id from ConversionSteps, if exposed
  paidAmount: bigint;
  receivedAmount: bigint;
  feeSat: bigint;
  completedAt: number;
}
```

### Persisted swap settings (via settingsService)

```typescript
interface SwapSettings {
  slippageBps: number;   // default 50
}
// Stored under key: 'swap_settings'
// Read/written via settingsService.getUserSettings() / updateUserSettings()
```

### Transaction history entry

Swap appears as a single `Payment` entry in `sdk.listPayments()`. The `ConversionSteps` field on the payment contains the internal legs — do not render them separately. Use `payment.paymentType === 'conversion'` (verify field name in SDK 0.13.1) to identify swap entries and render with `swap-horizontal` icon.

---

## 7. i18n Key List

All keys live under the `swap` namespace in `src/services/i18nService.ts` (EN + BG).

```
swap.title                          "Swap"
swap.youPay                         "You pay"
swap.youReceive                     "You receive"
swap.flipDirection                  "Flip swap direction"
swap.max                            "Max"
swap.maxBtcLabel                    "Max (keep 500 sats for fees)"
swap.maxUsdbDustNote                "A small USDB residual may remain for slippage protection"
swap.reviewButton                   "Review Swap"
swap.loadingQuote                   "Loading quote…"
swap.rate                           "Rate"
swap.fee                            "Fee"
swap.slippage                       "Slippage"
swap.advanced                       "Advanced"
swap.slippagePreset01               "0.1%"
swap.slippagePreset05               "0.5%"
swap.slippagePreset10               "1%"
swap.slippageCustomLabel            "Custom (bps)"
swap.error.insufficientBalance      "Insufficient balance"
swap.error.belowMin                 "Minimum swap: {{amount}} {{unit}}"
swap.error.aboveMax                 "Maximum swap: {{amount}} {{unit}}"
swap.error.limitsUnavailable        "Limits unavailable — swap temporarily disabled"
swap.error.limitsRetry              "Retry"
swap.error.offline                  "No connection — connect to the internet to swap"
swap.error.connectionLost           "Connection lost — swap may fail"
swap.error.timeoutBody              "Swap timed out. Check your connection and try again."
swap.max.disabledTooltip            "Not enough sats to swap (need more than 500)"
swap.backgrounded.toast             "Swap in progress — please wait"

# Home asset tabs + send/receive asset gating
home.assetTab.btc                   "BTC"
home.assetTab.usdb                  "USDB"
home.usdb.zeroTitle                 "No USDB yet"
home.usdb.zeroSubtitle              "Swap sats to USDB to get started"
home.usdb.zeroCta                   "Swap sats → USDB"
send.asset.onchainDisabled          "USDB transfers stay on Spark."
send.asset.swapToBtcLink            "Swap to BTC →"
send.asset.bolt11NotForUsdb         "Bolt11 invoices are for Bitcoin. Switch to the BTC tab or paste a Spark invoice."
send.asset.switchToBtc              "Switch to BTC"
swap.review.title                   "Review Swap"
swap.review.direction               "Direction"
swap.review.youPay                  "You pay"
swap.review.youReceive              "You receive"
swap.review.rate                    "Rate"
swap.review.fee                     "Fee"
swap.review.slippage                "Slippage tolerance"
swap.review.cancel                  "Cancel"
swap.review.confirm                 "Confirm"
swap.confirming.title               "Swapping…"
swap.confirming.subtitle            "Up to 30 seconds"
swap.success.title                  "Swap complete"
swap.success.paid                   "Paid"
swap.success.received               "Received"
swap.success.done                   "Done"
swap.dustResidual.note              "A small USDB residual ({{amount}}) remains for slippage protection."
swap.refunded.title                 "Swap refunded"
swap.refunded.body                  "Price moved more than {{slippage}} during the swap. Your funds were returned."
swap.refunded.tryAgain              "Try again at current rate"
swap.refunded.increaseSlippage      "Increase slippage tolerance"
swap.error.title                    "Swap failed"
swap.error.retry                    "Retry"
swap.error.networkBody              "Could not complete the swap. Check your connection and try again."
swap.history.label                  "Swap"
swap.history.btcToUsdb              "BTC → USDB"
swap.history.usdbToBtc              "USDB → BTC"
```

---

## 8. ASCII Wireframes

### State 1 — Idle

```
┌─────────────────────────────────┐
│  ← Swap                         │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ You pay                BTC  │ │
│ │                             │ │
│ │  0                    [Max] │ │
│ │  ≈ $0.00                    │ │
│ └─────────────────────────────┘ │
│           ⇅  (flip)             │
│ ┌─────────────────────────────┐ │
│ │ You receive           USDB  │ │
│ │                             │ │
│ │  —                          │ │
│ └─────────────────────────────┘ │
│                                 │
│  Rate  —    Fee  —   Slippage — │
│                                 │
│  [      Review Swap (disabled)] │
└─────────────────────────────────┘
```

### State 2 — Typing

```
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │
│ │ You pay                BTC  │ │
│ │  10,000|               [Max]│ │
│ │  ≈ $6.50                    │ │
│ └─────────────────────────────┘ │
│           ⇅                     │
│ ┌─────────────────────────────┐ │
│ │ You receive           USDB  │ │
│ │  ░░░░░░░░░░  (shimmer)      │ │
│ └─────────────────────────────┘ │
│                                 │
│  Rate  —    Fee  —   Slippage — │
│                                 │
│  [      Review Swap (disabled)] │
└─────────────────────────────────┘
```

### State 3 — Quote Loaded

```
┌─────────────────────────────────┐
│ ┌─────────────────────────────┐ │
│ │ You pay                BTC  │ │
│ │  10,000               [Max] │ │
│ │  ≈ $6.50                    │ │
│ └─────────────────────────────┘ │
│           ⇅                     │
│ ┌─────────────────────────────┐ │
│ │ You receive           USDB  │ │
│ │  6.48                       │ │
│ └─────────────────────────────┘ │
│                                 │
│  Rate 1 BTC=$65,000  Fee 21 sat │
│  Slippage 0.5%  [Advanced ▼]   │
│                                 │
│  [      Review Swap           ] │
└─────────────────────────────────┘
```

### State 4 — Quote Refreshing

```
  (identical to Quote Loaded, but destination amount has a subtle
   pulse/flash animation while background re-fetch is in progress)

│  Rate 1 BTC=$65,000  Fee 21 sat │
│  Slippage 0.5%  ↻ refreshing…  │
```

### State 5 — Insufficient Balance

```
│ ┌─────────────────────────────┐ │
│ │ You pay                BTC  │ │
│ │  500,000              [Max] │ │
│ │  ≈ $325.00                  │ │
│ └─────────────────────────────┘ │
│  ⚠ Insufficient balance         │  ← inline error, red
│           ⇅                     │
│  [      Review Swap (disabled)] │
```

### State 6 — Below-min / Above-max

```
│ ┌─────────────────────────────┐ │
│ │ You pay                BTC  │ │
│ │  10                   [Max] │ │
│ └─────────────────────────────┘ │
│  ⚠ Minimum swap: 1,000 sats     │  ← inline error
│           ⇅                     │
│  [      Review Swap (disabled)] │
```

### State 7 — Review Modal

```
┌─────────────────────────────────┐
│         Review Swap             │
├─────────────────────────────────┤
│  Direction    BTC → USDB        │
│  You pay      10,000 sats       │
│  You receive  6.48 USDB         │
│  Rate         1 BTC = $65,000   │
│  Fee          21 sats           │
│  Slippage     0.5%              │
├─────────────────────────────────┤
│  [Cancel]          [Confirm →]  │
└─────────────────────────────────┘
  (Confirm tap → OS biometric prompt)
```

### State 8 — Confirming

```
┌─────────────────────────────────┐
│                                 │
│           ◌  (spinner)          │
│                                 │
│         Swapping…               │
│       Up to 30 seconds          │
│                                 │
│  ████████████░░░░░░░░  (timer)  │
│                                 │
└─────────────────────────────────┘
```

### State 9 — Success

```
┌─────────────────────────────────┐
│                                 │
│           ✓  (green)            │
│                                 │
│        Swap complete            │
│                                 │
│  Paid      10,000 sats          │
│  Received  6.48 USDB            │
│                                 │
│  [            Done            ] │
└─────────────────────────────────┘
```

### State 10 — Dust Residual (USDB→BTC success variant)

```
┌─────────────────────────────────┐
│           ✓  (green)            │
│        Swap complete            │
│                                 │
│  Paid      6.48 USDB            │
│  Received  9,980 sats           │
│                                 │
│  ⓘ A small USDB residual        │
│    (0.05 USDB) remains for      │
│    slippage protection.         │
│                                 │
│  [            Done            ] │
└─────────────────────────────────┘
```

Residual amount is formatted in USDB (not fiat) with `displayDecimals: 2`.

### State 11 — Refunded

```
┌─────────────────────────────────┐
│           ↩  (amber)            │
│        Swap refunded            │
│                                 │
│  Price moved more than 0.5%     │
│  during the swap. Your funds    │
│  were returned.                 │
│                                 │
│  [  Try again at current rate ] │
│  [  Increase slippage tolerance]│
└─────────────────────────────────┘
```

### State 12 — Network / Pool Error

```
┌─────────────────────────────────┐
│           ✕  (red)              │
│        Swap failed              │
│                                 │
│  Could not complete the swap.   │
│  Check your connection and      │
│  try again.                     │
│                                 │
│  [            Retry           ] │
└─────────────────────────────────┘
```

---

## 9. Error Handling Strategy

| Error condition | Detection | UX state | Recovery |
|---|---|---|---|
| Offline on mount | `NetInfo.isConnected === false` before first SDK call | Offline banner replaces cards | Retry button re-checks connectivity |
| Connection lost mid-quote | NetInfo change event while in quoteLoaded/quoteRefreshing | Non-blocking banner above Review button | Auto-dismiss on reconnect |
| Limits fetch failure | `catch` on `fetchSwapLimits()` at mount | Banner "Limits unavailable — swap temporarily disabled. Retry." | Retry button re-invokes fetchSwapLimits |
| SDK generic error | `catch` on `executeSwap` | Error (retryable=true, preserves amount+direction) | Retry resets to typing with preserved amount |
| Slippage refund | TBD from T02a — either error variant or success-with-flag | Refunded | Try again / increase slippage |
| SDK timeout (30s completion_timeout_secs) | SDK returns timeout result; we do NOT add an outer Promise.race | Error (retryable=true) + `syncWallet()` triggered to reconcile | Retry |
| Below-min / above-max | Compare quote response vs limits | Inline error (with unit: sats or USDB) | Amount change → typing |
| Insufficient balance | Compare input vs wallet balance for the source currency | Inline error | Amount change → typing |
| Quote fetch failure | `catch` on `prepareSwap` | Error (retryable=true) | Retry |
| Background-then-resume while Confirming | `AppState` change to 'active' while state.status === 'confirming' | Call `syncWallet()` + `listPayments()` to find in-flight payment id | Resolve to terminal state based on payment status |
| Back-button / swipe-back during Confirming | `BackHandler` / gesture handler | Block navigation, show Toast `swap.backgrounded.toast` | No-op until state resolves |

All errors are passed through `extractSdkErrorMessage()` before display. This helper returns localized, user-safe strings — raw SDK error objects are never shown.

**Timeout-reconciliation guarantee**: because we removed the outer `Promise.race` timer (see §5.3), the UI never "gives up" while the SDK is still working. Any SDK call that does exceed the SDK-enforced timeout returns a structured timeout result which the UI maps to an error state. On the next screen visit or `syncWallet`, authoritative payment state is recovered from the SDK.

---

## 10. Home Screen Changes — Asset Tabs

The Home screen grows an **asset-tab bar** between the header and the balance card. This replaces the previous "secondary USDB row" idea. Each asset is a self-contained view.

### 10.1 Visual structure (in final order, top to bottom)

```
Header (wallet selector · eye · lock · cog)     ← unchanged
──────────────────────────────────────────
[  BTC  ●  ] [  USDB  ]                         ← NEW asset tab bar
──────────────────────────────────────────
Security reminder banners (optional)             ← unchanged
Balance card                                     ← content varies per active asset
Quick Actions row (Send · Receive · Swap · Scan) ← Swap is NEW; row respects active asset
Transactions list                                ← filtered per active asset
```

### 10.2 Tab bar component — reuse existing pattern

The tab bar uses the same inline `TouchableOpacity` pattern found in `app/wallet/send.tsx` and `app/wallet/receive.tsx`. Do NOT introduce a new tab component. Copy the exact styling:

```typescript
// mirrors styles.tabContainer + tabButton + tabButtonActive from send.tsx
tabContainer: {
  flexDirection: 'row',
  marginHorizontal: 24,
  marginTop: 16,
  marginBottom: 8,
  borderRadius: 14,
  padding: 4,
  backgroundColor: 'rgba(255,255,255,0.08)',
  gap: 6,
},
tabButton: {
  flex: 1,
  borderWidth: 1,
  borderColor: 'transparent',
  borderRadius: 10,
  paddingVertical: 10,
  alignItems: 'center',
},
tabButtonActive: {
  backgroundColor: BRAND_COLOR,
},
tabText: { fontSize: 14, fontWeight: '700' },
// active text color: '#1a1a2e' (dark navy)
// inactive text color: primaryTextColor
```

The asset-tab component lives as a reusable component (`src/features/wallet/components/AssetTabBar.tsx`) so that future tokens (USDT, USDC) add as new entries without refactoring Home.

### 10.3 Active-asset state

The active asset is a `WalletAsset = 'BTC' | 'USDB'` value held in the Home screen via `useState`, initialised from a persisted setting (`settingsService.getActiveAsset()` defaults to `'BTC'`). Switching tabs writes the new value back via `settingsService.setActiveAsset()` so state survives app restart.

The active asset is **not** a global context — it only lives on Home. When the user navigates to Send / Receive / Swap, the active asset is passed as a route param (`asset=BTC` or `asset=USDB`), received screens then initialise their own local state from that param. This avoids cross-screen state coupling.

### 10.4 BTC tab content

Identical to today's Home screen. Zero regressions required. Balance card continues to use the existing `useCurrency.format()` pipeline which respects the user's `displayCurrency` setting (sats / USD / EUR configured in Wallet Settings → Currency). No new interaction added. The only change is that the balance card and transaction list are now conditionally rendered (`activeAsset === 'BTC' ? <BtcContent /> : <UsdbContent />`), but for BTC the inner structure is unchanged.

### 10.5 USDB tab content

- **Balance card**: 
  - Primary: USDB amount formatted to 2 display decimals (e.g. `6.48 USDB`).
  - Secondary: fiat equivalent via new helper `usdbToFiat(amount, displayCurrency)` — see §10.5.1.
  - **No tap-to-cycle** on Home (consistent with BTC tab). The balance card is display-only; unit preference comes from Settings.
- **Quick Actions**: Send · Receive · Swap · Scan. Same row structure as BTC tab. All pass `asset=USDB` route param per §10.6.
- **Transactions**: filtered to `tokenIdentifier === USDB.tokenIdentifier || paymentType === 'conversion'`. Swap entries render with the USDB leg prominent.
- **Zero-state** (`usdbBalance === 0` AND no history): dedicated empty state:
  ```
  No USDB yet
  Swap sats to USDB to get started
  [  Swap sats → USDB  ]   ← big amber CTA, opens Swap with direction preset
  ```
  Send and Receive actions are hidden in zero-state; the only action is the zero-state Swap CTA (equivalent to tapping the Swap quick action).

### 10.5.1 `usdbToFiat` helper

New exported helper in `src/utils/currency.ts` (or alongside `satsToFiat`):

```typescript
/**
 * Convert a USDB amount to the user's preferred display currency.
 *
 * USDB is treated as 1:1 with USD for v1 (Breez USDB is USD-pegged).
 * Non-par behavior would require the Flashnet AMM USDB/USD rate, which is
 * out of scope here — revisit if Breez ever publishes USDB trading off-peg.
 *
 * Returns the value in the target currency's native unit:
 *   - 'usd' → USD number (identity, 1:1)
 *   - 'eur' → EUR via existing USD→EUR rate in `rates`
 *   - 'sats' → sats via USD→BTC rate from `rates` (snapshot at last refresh)
 */
export function usdbToFiat(
  usdbAmount: number,
  displayCurrency: DisplayCurrency,
  rates: FiatRates | null,
): { primary: string; secondary: string | null };
```

Consumes the same `rates` object that `useCurrency` already maintains. No new rate pipeline needed. The helper returns a `{ primary, secondary }` tuple mirroring `format()` so `HomeScreen` can render both tabs with identical component code.

### 10.6 Quick Actions behavior by active asset

All quick actions pass the active asset as a route param. The receiving screens decide how to use it:

| Quick Action | BTC tab → route | USDB tab → route |
|---|---|---|
| Send | `/wallet/send` (no asset param, backward compat) | `/wallet/send?asset=USDB` |
| Receive | `/wallet/receive` | `/wallet/receive?asset=USDB` |
| Swap | `/wallet/swap?direction=BTC_TO_USDB` | `/wallet/swap?direction=USDB_TO_BTC` |
| Scan QR | `/wallet/scan` | `/wallet/scan?asset=USDB` (routes parsed result into correct send flow) |

### 10.7 Send/Receive screen behavior when `asset=USDB`

The existing `[Lightning | On-chain]` sub-tabs inside Send/Receive are retained. When `asset=USDB` is present in route params:

- **Lightning tab**: stays active by default, but the destination-input parser (currently handles bolt11 and Lightning URIs) is extended to accept Spark addresses and Spark invoices with a `tokenIdentifier` matching USDB.
- **On-chain tab**: visibly disabled with `opacity: 0.4` and `disabled={true}` on the TouchableOpacity. Tapping it reveals an inline banner above the tab bar:
  ```
  ⓘ USDB transfers stay on Spark.  [Swap to BTC →]
  ```
- **Parse error for bolt11 on USDB mode**: if user pastes a bolt11, show inline error under the input: `"Bolt11 invoices are for Bitcoin. Switch to the BTC tab or paste a Spark invoice."` with a "Switch to BTC" action that updates the Home active-asset setting and navigates back.

The existing BTC behavior (`asset` undefined or `'BTC'`) is untouched.

### 10.8 Data-layer changes

`useWallet` hook currently exposes `balance: number` (BTC sats). Needs to grow to expose token balances without breaking existing consumers:

```typescript
// Existing
balance: number;                                    // BTC sats
transactions: Transaction[];

// New additions (additive, non-breaking)
tokenBalances: Record<string, bigint>;              // keyed by tokenIdentifier → base units
usdbBalance: bigint;                                // convenience accessor; 0n if not present
getBalanceForAsset(asset: WalletAsset): bigint;     // helper used by Home tab
getTransactionsForAsset(asset: WalletAsset): Transaction[]; // filtered selector
```

`tokenBalances` is populated from `sdk.getInfo().tokenBalances` on every refresh. `usdbBalance` is a derived selector using the resolved USDB token identifier from `resolveSwapTokens()` (§1).

Transaction filtering runs client-side over the same `transactions` array — no second SDK call, no separate cache. See T13 for the exact predicate.

---

## 11. Navigation

```
app/wallet/swap.tsx
  params:
    direction?: 'BTC_TO_USDB' | 'USDB_TO_BTC'   (optional; default BTC_TO_USDB)

app/wallet/send.tsx  (existing screen, new behavior when asset param present)
  params:
    paymentInput?: string                        (existing)
    tab?: 'lightning' | 'onchain'                (existing)
    amount?: string                              (existing)
    comment?: string                             (existing)
    asset?: 'BTC' | 'USDB'                       (NEW — defaults to 'BTC' if absent)

app/wallet/receive.tsx  (existing screen, new behavior when asset param present)
  params:
    asset?: 'BTC' | 'USDB'                       (NEW — defaults to 'BTC' if absent)

app/wallet/scan.tsx  (existing)
  params:
    asset?: 'BTC' | 'USDB'                       (NEW — defaults to 'BTC'; routes parse result to correct send flow)
```

`direction` on Swap is read once on mount via `useLocalSearchParams()` and passed to `useSwap({ initialDirection })`.
The Refunded "Try again" CTA stays within the screen — no `amount` param needed.

On "Done" (Success / DustResidual): `router.back()` returns to Home; Home should then switch its active asset tab to match the destination of the completed swap (e.g. BTC→USDB swap → Home shows USDB tab, so the new balance is visible). This is a small quality-of-life touch handled in T12.

On "Retry" (Error): state transitions to typing with preserved amount — no navigation.

If the wallet is locked when this route is deep-linked, the existing global auth gate intercepts navigation and unlocks before the screen mounts.

### Accessibility implementation notes (T15)

- Skeleton quote placeholders are announced as `Loading quote` via `accessibilityRole="progressbar"` + live region.
- Dynamic inline errors in rate/auth flows use polite live-region alerts so VoiceOver/TalkBack announce changes.
- Confirming state is exposed as a progress status with an announced remaining-time hint.
- Swap result cards expose terminal semantics (`summary` for success/refund, `alert` for failure).

---

## 12. Future Enhancements (out of scope for v1)

- **Swap transaction detail view**: tap a swap entry in history to open a detail screen with full ConversionSteps, poolId, conversionId, and fee breakdown. v1 renders history entries as non-interactive.
- **Dust sweep helper**: a one-tap action to convert residual USDB dust to BTC.
- **Non-USDB tokens**: wire up additional entries in `SWAP_TOKENS` once USDT/USDC land on Spark with liquidity.
- **Stable Balance**: separate epic — the auto-hold-as-USD mode (`StableBalanceConfig` + `updateUserSettings({stableBalanceActiveLabel})`) is a distinct feature. Do not conflate.
- **Fiat-priced input**: users enter sats or USDB; fiat is read-only in v1.
- **Analytics / telemetry**: no event tracking for swap lifecycle in v1. Can be added via the existing analytics service.
