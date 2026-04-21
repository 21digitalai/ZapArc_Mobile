# BTC ⇄ USDB Swap — Implementation Tasks

Tasks are ordered so each builds on a verified foundation. Each task is a single commit / single testable slice sized for the Nexus builder agent to complete in under a day.

Commit style: Conventional Commits — e.g. `feat(swap): add swap screen scaffold`.

## Task index (18 tasks total)

| ID | Title | Effort | Depends on |
|---|---|---|---|
| T01 | SDK Upgrade to 0.13.1 + **empirical spike harness** (kanban #679) | L | none |
| ~~T02a~~ | ~~SPIKE~~ — **subsumed into T01**, see kanban #748 (done) | — | — |
| T02 | Token Config + `fetchSwapLimits` (consumes spike-results.md) | M | T01 |
| T03 | i18n Keys EN+BG | S | none (parallel) |
| T04 | `prepareSwap` + `executeSwap` service methods (encodes spike branch) | L | T01, T02 |
| T05 | `useSwap` hook (state machine) | L | T02, T03, T04, T14 |
| T06 | Swap screen scaffold + route | S | T03, T05 |
| T07 | `SwapAmountCard` component | M | T03, T06 |
| T08 | `SwapRateLine` + inline error | M | T03, T07 |
| T09 | `SwapReviewModal` | M | T03, T07 |
| T10 | `SwapResultView` (all 4 terminal states) | M | T03, T06 |
| T11 | Wire up `SwapScreen` (full integration) | L | T05, T07–T10 |
| **T12** | **Home screen asset tabs + Swap quick action** (split into T12.a data, T12.b component, T12.c integration) | L | T06 |
| T12b | Send/Receive asset param handling (on-chain disabled for USDB, bolt11 parse error) | M | T02, T03, T12.c |
| T13 | History: swap entry rendering (per-tab filtering) | M | T03, T04, T11, T12.a |
| T14 | Slippage persistence + custom-bps Settings row | M | T03 |
| T15 | E2E QA pass + accessibility audit | M | T11–T14, T12b |
| T16 | DECISION: scope of full USDB send/receive composition (a/b/c) | S | T12.c |

**Key structural change from earlier versions**: T12 is no longer a small "add a USDB row" task — it's the biggest structural piece in the spec because it restructures Home around asset tabs. That's why it's split into 3 sub-parts (data / component / integration) so each can land as its own PR.

Clean DAG: T14 depends only on T03 and lands before T05. T12.a (data) should land alongside or before T12.c (integration). T12b is a **followup** to T12.c, not a blocker for swap delivery.

---

## T01 — SDK Upgrade to 0.13.1 + Empirical Spike Harness

**Tracked externally as kanban #679. This task is a hard blocker for all subsequent tasks. Scope extended to absorb the previous T02a spike (#748 done).**

### Phase 1 — SDK upgrade

Upgrade `@breeztech/breez-sdk-spark-react-native` from `0.12.2` to `0.13.1`. Verify the existing payment and balance flows still work. Confirm `prepareSendPayment`, `ConversionOptions`, `fetchConversionLimits`, and `receivePayment` (with token identifier) are present in the new SDK types. Fix any type-level breakage from the minor version jump.

### Phase 2 — Empirical spike harness (replaces the former T02a memo)

Add a **dev-build-only** diagnostic module `src/devtools/swapSpike.ts` exposing a `runSwapSpike()` function. Gate it behind `__DEV__` and a hidden entry point (long-press on a Home icon, or a debug-menu toggle). This module is temporary — it will be deleted in T04 (#751) once findings are captured.

`runSwapSpike()` does, in order:

1. **Discover the USDB token identifier** — try each of the following and log the output:
   - `sdk.getInfo().tokenBalances` — is USDB present even with zero balance?
   - `sdk.fetchConversionLimits()` — does the response carry per-token identifiers?
   - `sdk.getTokenIssuer()` — the SDK class exposes this method; inspect return shape.
   - If none work, fall back to any Breez-published identifier (search SDK README / docs).

2. **Generate a self-receive Spark address** for USDB once the identifier is known:
   ```typescript
   const recv = await sdk.receivePayment({
     paymentMethod: { tag: 'SparkAddress', inner: { tokenIdentifier: usdbId } },
   });
   ```

3. **Prepare with intentionally tight slippage** (`maxSlippageBps: 1`) and a small amount (`1000n` sats):
   ```typescript
   const prep = await sdk.prepareSendPayment({
     paymentRequest: recv.paymentRequest,
     amount: 1000n,
     conversionOptions: {
       conversionType: { tag: 'FromBitcoin' },
       maxSlippageBps: 1,
       completionTimeoutSecs: 30,
     },
   });
   ```

4. **Execute and observe**:
   ```typescript
   try {
     const result = await sdk.sendPayment({ preparedPayment: prep });
     log('RESOLVED:', result);
     log('→ REFUND IS SIGNALLED ON THE PAYMENT RESULT');
   } catch (err) {
     log('THREW:', err.constructor?.name, err);
     log('→ REFUND IS SIGNALLED AS A THROWN ERROR VARIANT');
   }
   ```

5. If `maxSlippageBps: 1` does not trigger a refund (pool too stable), escalate to `0` bps or retry with a larger amount until the refund path fires.

### Outputs

Record findings in `.kiro/specs/btc-usdb-swap/spike-results.md` including:
- USDB Spark token identifier string
- Whether slippage refund surfaces as thrown error or resolved Payment
- If thrown: the exact class / variant / code check
- If resolved: the exact `Payment` field to inspect (e.g. `status === 'Refunded'`)
- Full raw log output of at least one successful refund-path execution

### Safety

Each attempt moves ≤1000 sats (≈$0.65) inside the tester's own wallet. If state drifts, `sdk.syncWallet()` reconciles. The harness is stripped from release builds via `__DEV__` + deleted outright in T04 (#751).

**Depends on:** none

**Effort:** L (was M — the spike adds ~2–4 hrs)

**Files touched**
- `package.json`, `package-lock.json` (or `yarn.lock`)
- `src/services/breezSparkService.ts` — fix any type-level breakage from the SDK version bump
- `src/devtools/swapSpike.ts` (new, temporary — deleted in T04)
- A hidden debug-menu entry (e.g. a dev-only long-press handler on `HomeScreen.tsx`) to invoke the spike
- `.kiro/specs/btc-usdb-swap/spike-results.md` (new)

**Acceptance criteria**

Phase 1 tests:
- `breezSparkService.test.ts` — existing tests pass with at most minor type fixes.

Phase 1 manual QA:
1. `npm install` completes without errors.
2. App builds on iOS and Android.
3. Existing send and receive flows work end-to-end on a test wallet.
4. `sdk.fetchConversionLimits`, `sdk.prepareSendPayment` with `conversionOptions`, and `sdk.receivePayment` with `paymentMethod.inner.tokenIdentifier` are all callable without TS errors.

Phase 2 deliverables:
5. `spike-results.md` exists and unambiguously states the refund-detection mechanism.
6. `spike-results.md` records the USDB token identifier string.
7. At least one raw log of a refund-triggered `sendPayment()` is captured in `spike-results.md`.

Phase 2 cleanup (performed in T04, not here):
- `src/devtools/swapSpike.ts` is deleted.
- Any debug-menu entry that invoked the spike is removed.

---

## T02 — Token Config and Swap Limits Service Method

**Description**  
Add `src/config/swapTokens.ts` per design.md §1 (static `SWAP_TOKENS` with display metadata, plus `ResolvedSwapToken` type for runtime-resolved identifier + decimals). Implement `resolveSwapTokens()` in `breezSparkService.ts` that calls `getTokensMetadata()` and caches in-memory — the token identifier resolution strategy is finalised in T02a. Add `fetchSwapLimits(direction)` to `breezSparkService.ts` returning bigint min/max in the direction's unit (sats for BTC→USDB, USDB base units for USDB→BTC).

**Depends on:** T01, T02a

**Effort:** M

**Files touched**
- `src/config/swapTokens.ts` (new)
- `src/services/breezSparkService.ts` — add `resolveSwapTokens()` and `fetchSwapLimits()`

**Acceptance criteria**

Unit tests:
- `swapTokens.test.ts` — `USDB_TOKEN` is defined with `id`, `ticker`, `label`, `displayDecimals`.
- `breezSparkService.swap.test.ts` — `resolveSwapTokens()` caches result across calls and throws if ticker not found in metadata.
- `breezSparkService.swap.test.ts` — `fetchSwapLimits('BTC_TO_USDB')` returns `{ min: bigint, max: bigint }` using the sats-side fields.
- `breezSparkService.swap.test.ts` — `fetchSwapLimits('USDB_TO_BTC')` returns `{ min: bigint, max: bigint }` using the token-base-units-side fields.
- `breezSparkService.swap.test.ts` — `prepareSwap_failsGracefully_whenUsdbTokenIdentifierMissing`.

Manual QA:
1. `npm run type-check` passes.
2. In a connected dev build, `resolveSwapTokens()` returns a USDB entry with a non-empty `tokenIdentifier` and `internalDecimals`.
3. `fetchSwapLimits('BTC_TO_USDB')` returns sensible bigint min/max.

---

## ~~T02a — SPIKE (SUBSUMED into T01 / kanban #679)~~

**Status: merged into T01.** Rather than writing a memo up front, the spike is executed empirically as Phase 2 of the SDK upgrade (#679).

### What replaced it

A dev-only `src/devtools/swapSpike.ts` harness (added in #679, deleted in #751) runs a real tight-slippage swap against the installed 0.13.1 SDK and logs:

1. Which mechanism signals the slippage refund — **thrown error variant** vs **successful Payment with refund flag**
2. The canonical USDB Spark token identifier string — discovered via `getInfo().tokenBalances`, `fetchConversionLimits()`, or `getTokenIssuer()`

Findings are written to `.kiro/specs/btc-usdb-swap/spike-results.md`.

### Consequences for downstream tasks

- **T04 (#751)** uses `spike-results.md` as source of truth: implements only the confirmed refund-detection branch and prunes the losing branch from `design.md §5.3`. Deletes `src/devtools/swapSpike.ts` when done.
- **T02 (#749)** references the discovered USDB identifier — either baked into `SWAP_TOKENS` as a constant if Breez publishes one, or resolved at runtime via whichever SDK call the spike confirms.

### Safety

1000 sats (~$0.65) moved inside the tester's own wallet per attempt. `syncWallet()` reconciles any anomaly.

Kanban #748 has been moved to `done`. This section is retained for historical traceability.

---

## T03 — i18n Keys (EN + BG)

**Description**  
Add all `swap.*` i18n keys listed in `design.md §7` to both the `en` and `bg` translation objects in `src/services/i18nService.ts`. Bulgarian translations may be machine-translated placeholders marked with `// TODO: native review` — they must not be empty strings.

**Depends on:** none (can land in parallel with T01/T02)

**Effort:** S

**Files touched**
- `src/services/i18nService.ts`

**Acceptance criteria**

Unit tests:
- `i18nService.swap.test.ts` — for every key in the `swap.*` namespace, `t(key, 'en')` and `t(key, 'bg')` return non-empty strings.

Manual QA:
1. `npm run type-check` passes.
2. Switching app language to Bulgarian shows Bulgarian text on any screen that uses `swap.*` keys (once the screen exists).

---

## T04 — `prepareSwap` and `executeSwap` Service Methods

**Description**  
Add `prepareSwap(params: PrepareSwapParams): Promise<SwapQuote>` and `executeSwap(quote: SwapQuote): Promise<SwapOutcome>` to `breezSparkService.ts` per design.md §5.2–5.3. Implement the self-payment pattern with the mandatory code comment block from design.md §5.2. All SDK-boundary amounts are `bigint`. Slippage-refund detection uses the branch confirmed in T02a (not both). Dust-residual detection compares pre-swap vs post-swap USDB balance. Timeout is surfaced via the SDK's `completion_timeout_secs: 30` — do NOT wrap in an outer `Promise.race`.

**Depends on:** T01, T02, T02a

**Effort:** L

**Files touched**
- `src/services/breezSparkService.ts`
- `src/services/__tests__/breezSparkService.swap.test.ts` (new)

**Acceptance criteria**

Unit tests (mock SDK):
- `prepareSwap_btcToUsdb_callsPrepareSendPaymentWithFromBitcoinConversionType`
- `prepareSwap_usdbToBtc_callsPrepareSendPaymentWithToBitcoinConversionType_andFromTokenIdentifier`
- `prepareSwap_passesBigintAmountsToSdk_noFloats`
- `prepareSwap_respectsSlippageBpsParam`
- `prepareSwap_passesCompletionTimeoutSecs30`
- `prepareSwap_failsGracefullyWhenUsdbIdentifierUnresolved`
- `executeSwap_onSuccess_returnsSwapOutcomeSuccess_withPaymentId`
- `executeSwap_onSlippageRefund_returnsSwapOutcomeRefunded` (mechanism per T02a)
- `executeSwap_onTimeout_returnsSwapOutcomeError_retryableTrue`
- `executeSwap_detectsDustResidual_whenUsdbBalanceNonZeroAfterUsdbToBtcSwap`
- `executeSwap_noDustCheckForBtcToUsdbDirection`
- `executeSwap_doesNotUseOuterPromiseRaceTimer`

Manual QA:
1. `npm run type-check` passes.
2. In a connected dev build, calling `prepareSwap({ direction: 'BTC_TO_USDB', amount: 10_000n, slippageBps: 50 })` returns a `SwapQuote` with bigint `receiveAmount`, `feeSat`, and a number `rate`.
3. `executeSwap` returns a `SwapOutcome` discriminated union, not a thrown error, for the refunded case.

---

## T05 — `useSwap` Hook (State Machine)

**Description**  
Implement `src/hooks/useSwap.ts`. Owns the full state machine from design.md §4 (all 14 state-machine states covering the 12 user-visible UX states). Exposes: `state`, `direction`, `setDirection`, `setAmount`, `flipDirection`, `loadLimits`, `retryLimits`, `refreshQuote`, `openReview`, `closeReview`, `confirmSwap`, `retrySwap`, `tryAgainFromRefund`, `slippageBps`, `setSlippageBps`. Reads `slippageBps` default from `settingsService` (T14). Implements the 400 ms debounce, 10-second idle quote-refresh timer, AppState-based backgrounding recovery (design.md §5.4), and concurrent-confirm guard (briefing US-5.3).

**Depends on:** T02, T03, T04, T14

**Effort:** L

**Files touched**
- `src/hooks/useSwap.ts` (new)
- `src/hooks/__tests__/useSwap.test.ts` (new)

**Acceptance criteria**

Unit tests (mock service + settings layer):

Initial / basic transitions
- `useSwap_initialState_isIdle`
- `useSwap_initialDirection_defaultsToBtcToUsdb_unlessPropOverrides`
- `useSwap_setAmount_debouncedBy400ms_thenTransitionsToQuoteLoading`
- `useSwap_setAmount_transitionsToTypingThenQuoteLoaded`
- `useSwap_setAmount_belowMin_transitionsToBelowMin`
- `useSwap_setAmount_aboveMax_transitionsToAboveMax`
- `useSwap_setAmount_exceedsBalance_transitionsToInsufficientBalance`
- `useSwap_setAmount_zeroCleared_returnsToIdle`
- `useSwap_flipDirection_clearsAmountAndReturnsToIdle`

Amount-change re-entry from all non-idle states (C2 fix)
- `useSwap_amountChanged_fromQuoteLoaded_returnsToTyping`
- `useSwap_amountChanged_fromQuoteRefreshing_returnsToTyping_abandonsFetch`
- `useSwap_amountChanged_fromBelowMin_returnsToTyping`
- `useSwap_amountChanged_fromAboveMax_returnsToTyping`
- `useSwap_amountChanged_fromInsufficientBalance_returnsToTyping`

Slippage re-quote (US-3.2a)
- `useSwap_slippageChanged_whileQuoteLoaded_reQuotesWithNewBps`

Review / auth / confirm
- `useSwap_openReview_transitionsToReviewing`
- `useSwap_closeReview_returnsToQuoteLoaded`
- `useSwap_confirmSwap_onAuthSuccess_transitionsToConfirming`
- `useSwap_confirmSwap_onAuthFailure_staysInReviewing_showsError`
- `useSwap_confirmSwap_ignoresSecondCallWhileConfirming` (US-5.3 re-entry guard)
- `useSwap_confirmSwap_onSuccess_transitionsToSuccess`
- `useSwap_confirmSwap_onDustResidual_transitionsToDustResidual`
- `useSwap_confirmSwap_onRefund_transitionsToRefunded`
- `useSwap_confirmSwap_onTimeout_transitionsToError_retryableTrue`

Limits failure (FR-4 retry)
- `useSwap_limitsFetchFailure_setsLimitsUnavailableFlag_disablesReview`
- `useSwap_retryLimits_clearsLimitsUnavailableFlag_onSuccess`

Retry & recovery
- `useSwap_retrySwap_fromError_preservesLastAmountAndDirection`
- `useSwap_tryAgainFromRefund_preservesAmount_reQuotes`
- `useSwap_quoteRefreshTimer_firesAfter10Seconds`
- `useSwap_appBackgroundedWhileConfirming_doesNotChangeState`
- `useSwap_appResumedFromBackgroundWhileConfirming_callsSyncWalletAndResolvesTerminal`

Offline
- `useSwap_offlineOnMount_entersOfflineState_blockingQuotes`
- `useSwap_cameOnline_clearsOfflineState`

Manual QA:
1. `npm test src/hooks/__tests__/useSwap.test.ts` — all tests pass.

---

## T06 — Swap Screen Scaffold and Route

**Description**  
Create `app/wallet/swap.tsx` (Expo Router route) and `src/features/wallet/screens/SwapScreen.tsx` (shell only — no business logic yet). Apply standard screen chrome: `LinearGradient`, `SafeAreaView`, back navigation header. Read `direction` query param and pass to `useSwap`. Render a placeholder "Swap screen coming soon" text so the route is navigable.

**Depends on:** T03, T05

**Effort:** S

**Files touched**
- `app/wallet/swap.tsx` (new)
- `src/features/wallet/screens/SwapScreen.tsx` (new)
- `src/features/wallet/screens/index.ts` — export `SwapScreen`

**Acceptance criteria**

Unit tests:
- `SwapScreen.test.tsx` — renders without crashing with no props.
- `SwapScreen.test.tsx` — renders without crashing with `direction="USDB_TO_BTC"` param.

Manual QA:
1. Navigating to `/wallet/swap` renders the screen with gradient background and back button.
2. Navigating to `/wallet/swap?direction=USDB_TO_BTC` does not crash.
3. Back button returns to Home.

---

## T07 — SwapAmountCard Component

**Description**  
Implement `src/features/wallet/components/SwapAmountCard.tsx`. Props: `label`, `currency`, `amount`, `onAmountChange`, `onMax`, `maxDisabled`, `maxDisabledTooltip`, `isReadOnly`, `isLoading` (skeleton), `fiatEquivalent`. Skeleton is a simple animated `View` with opacity pulse (avoid adding `react-native-reanimated` unless already in the repo). Do NOT use `ActivityIndicator` — it is a spinner, not a skeleton. Max button must be disabled and show the tooltip when `maxDisabled=true` (C7 fix for low-balance edge case). Currency label is a plain `Text` (no dropdown arrow / picker — v1 is single-token).

**Depends on:** T03, T06

**Effort:** M

**Files touched**
- `src/features/wallet/components/SwapAmountCard.tsx` (new)

**Acceptance criteria**

Unit tests:
- `SwapAmountCard.test.tsx` — renders plain currency label (no dropdown arrow).
- `SwapAmountCard.test.tsx` — renders opacity-pulse skeleton when `isLoading=true`.
- `SwapAmountCard.test.tsx` — calls `onAmountChange` when text input changes.
- `SwapAmountCard.test.tsx` — calls `onMax` when Max button pressed and `maxDisabled=false`.
- `SwapAmountCard.test.tsx` — Max button is disabled and does not call onMax when `maxDisabled=true`.
- `SwapAmountCard.test.tsx` — shows `maxDisabledTooltip` when Max is disabled.
- `SwapAmountCard.test.tsx` — input is disabled when `isReadOnly=true`.
- `SwapAmountCard.test.tsx` — has correct `accessibilityLabel` on Max button.

Manual QA:
1. "You pay" card shows numeric keyboard and Max button.
2. "You receive" card shows opacity-pulse skeleton when `isLoading=true`.
3. Fiat equivalent updates when amount changes.
4. With BTC balance = 300 sats, Max button is disabled with tooltip text.

---

## T08 — SwapRateLine and Inline Error Components

**Description**  
Implement `src/features/wallet/components/SwapRateLine.tsx` (rate / fee / slippage row with Advanced toggle and preset chips) and the inline error display (can be a small component or inline JSX in `SwapScreen`). Slippage preset chips use `BRAND_COLOR` for the active selection. Advanced section is collapsed by default.

**Depends on:** T03, T07

**Effort:** M

**Files touched**
- `src/features/wallet/components/SwapRateLine.tsx` (new)

**Acceptance criteria**

Unit tests:
- `SwapRateLine.test.tsx` — renders rate, fee, slippage when all props provided.
- `SwapRateLine.test.tsx` — Advanced section hidden by default; visible after toggle tap.
- `SwapRateLine.test.tsx` — tapping a preset chip calls `onSlippageChange` with correct bps value.
- `SwapRateLine.test.tsx` — active preset chip has BRAND_COLOR styling.

Manual QA:
1. Rate line shows "1 BTC = X USDB", fee in sats, slippage %.
2. Tapping "Advanced" expands preset chips.
3. Selecting 1% chip updates the slippage display.

---

## T09 — SwapReviewModal Component

**Description**  
Implement `src/features/wallet/components/SwapReviewModal.tsx` using `react-native-paper` `Dialog`. Shows direction, pay amount, receive amount, rate, fee, slippage — formatted per direction (sats for BTC, 2-decimal USDB for token side). Cancel button closes modal. Confirm button triggers auth via `useWalletAuth` (same path as Send — auto-falls-back to PIN when biometric unavailable). Confirm is **disabled after first tap** and re-enabled only when `authError` prop is set (US-5.3 double-tap guard). Auth failure shows an inline error inside the modal.

**Depends on:** T03, T07

**Effort:** M

**Files touched**
- `src/features/wallet/components/SwapReviewModal.tsx` (new)

**Acceptance criteria**

Unit tests:
- `SwapReviewModal.test.tsx` — renders all quote fields.
- `SwapReviewModal.test.tsx` — formats pay amount as sats for BTC→USDB and as 2-decimal USDB for USDB→BTC.
- `SwapReviewModal.test.tsx` — formats receive amount inversely.
- `SwapReviewModal.test.tsx` — Cancel calls `onCancel`.
- `SwapReviewModal.test.tsx` — Confirm calls `onConfirm` exactly once on rapid double-tap.
- `SwapReviewModal.test.tsx` — Confirm re-enables when `authError` prop becomes set.
- `SwapReviewModal.test.tsx` — auth error message is shown when `authError` prop is set.

Manual QA:
1. Modal opens with correct amounts from the quote.
2. Cancel closes modal, returns to Quote Loaded state.
3. Confirm triggers OS biometric prompt (or PIN if biometric unavailable).
4. Auth cancellation shows error text inside modal without closing it, and Confirm becomes tappable again.
5. Rapidly double-tapping Confirm fires only one auth prompt.

---

## T10 — SwapResultView Component

**Description**  
Implement `src/features/wallet/components/SwapResultView.tsx`. Handles four terminal states: Success, DustResidual, Refunded, Error. Each state has distinct icon, title, body, and CTA(s) as per wireframes in design.md §8. "Done" navigates to Home. "Try again" calls `onRetryWithQuote`. "Increase slippage" calls `onOpenSlippage`.

**Depends on:** T03, T06

**Effort:** M

**Files touched**
- `src/features/wallet/components/SwapResultView.tsx` (new)

**Acceptance criteria**

Unit tests:
- `SwapResultView.test.tsx` — renders checkmark and amounts for `status='success'`.
- `SwapResultView.test.tsx` — renders dust note for `status='dustResidual'`.
- `SwapResultView.test.tsx` — renders refund title and both CTAs for `status='refunded'`.
- `SwapResultView.test.tsx` — renders error message and Retry for `status='error'`.
- `SwapResultView.test.tsx` — Done button calls `onDone`.

Manual QA:
1. Success state shows green checkmark, paid/received amounts, Done button.
2. Dust residual state shows the residual amount in the note.
3. Refunded state shows both "Try again" and "Increase slippage tolerance" buttons.
4. Error state shows the error message and Retry button.

---

## T11 — Wire Up SwapScreen (Full State Machine Integration)

**Description**  
Replace the placeholder in `SwapScreen.tsx` with the full layout: `SwapAmountCard` (pay), flip button, `SwapAmountCard` (receive), `SwapRateLine`, inline error, Review button, `SwapReviewModal`, `SwapResultView`. Connect all components to `useSwap` hook. Handle the Confirming state (spinner + progress bar fed from SDK's `completion_timeout_secs`). Handle Offline, LimitsUnavailable, and ConnectionLost banners (new tests in T05). Block Android hardware back button and iOS swipe-back during Confirming (display `swap.backgrounded.toast`). New integration test file — do NOT overwrite T06's smoke test.

**Depends on:** T05, T07, T08, T09, T10

**Effort:** L

**Files touched**
- `src/features/wallet/screens/SwapScreen.tsx`
- `src/features/wallet/screens/__tests__/SwapScreen.integration.test.tsx` (new — separate from T06's smoke test)

**Acceptance criteria**

Integration tests (mocking useSwap to expose state):
- in Idle state, Review button is disabled.
- in Quote Loaded state, Review button is enabled.
- in Typing state, destination card shows opacity-pulse skeleton.
- in Confirming state, spinner is visible; source input is disabled; flip button is disabled.
- in Confirming state, Android BackHandler is registered and returns true (blocks back).
- in Confirming state, swipe-back gesture handler is disabled.
- in Success state, `SwapResultView` with `status='success'` is rendered.
- in DustResidual state, `SwapResultView` shows residual amount in USDB units (not fiat).
- in Refunded state, `SwapResultView` with both CTAs is rendered.
- in Error state (retryable), Retry button preserves amount when tapped.
- when `limitsUnavailable=true`, a retry banner renders above the Review button.
- when `isOffline=true`, the cards are replaced with an offline banner + Retry CTA.

Manual QA (happy path + edge cases):
1. Full happy path: enter amount → quote loads → tap Review → auth → Confirming spinner → Success screen → Done returns to Home.
2. Flip button swaps currencies and clears amount.
3. Max button fills correct amount with label; disabled + tooltip when balance < 500 sats.
4. Inline errors appear for below-min, above-max, insufficient balance — with correct unit.
5. Refunded state shows both CTAs; "Try again" pre-fills the amount and re-quotes.
6. Error state Retry preserves amount (not reset to 0).
7. SDK timeout (simulated) triggers error state; app does not hang.
8. Airplane-mode on mount → offline banner; toggle off → banner clears and limits refetch.
9. Backgrounding during Confirming → foreground recovery reconciles state via syncWallet.
10. Android back / iOS swipe-back during Confirming shows toast and blocks navigation.

---

## T12 — Home Screen: Asset Tabs (BTC · USDB) + Swap Quick Action

**Description**  
Restructure the Home screen around asset tabs. This is the biggest structural change in the spec. Add a new `AssetTabBar` component, extend `useWallet` with multi-asset balance + transaction selectors, refactor `HomeScreen.tsx` to render per-asset content, add the Swap `QuickAction` button.

### Sub-parts (one PR per bullet for reviewability)

**T12.a — Data layer extension (~M)**
- Extend `useWallet` hook with `tokenBalances`, `usdbBalance`, `getBalanceForAsset(asset)`, `getTransactionsForAsset(asset)` as documented in design.md §10.8.
- Populate `tokenBalances` from `sdk.getInfo().tokenBalances` on every refresh. Non-breaking: existing `balance: number` stays.
- Add `settingsService.getActiveAsset()` / `.setActiveAsset()` with default `'BTC'`.

**T12.b — `AssetTabBar` component (~S)**
- New `src/features/wallet/components/AssetTabBar.tsx`. Props: `assets: WalletAsset[]`, `active: WalletAsset`, `onChange: (a: WalletAsset) => void`.
- Reuses styling from `send.tsx` tab pattern verbatim (see design.md §10.2). Do NOT introduce a new styling idiom.
- i18n keys `home.assetTab.btc`, `home.assetTab.usdb`.

**T12.c — `HomeScreen.tsx` refactor (~L)**
- Add `AssetTabBar` between header and ScrollView.
- State: `const [activeAsset, setActiveAsset] = useState<WalletAsset>(...)` initialised from settingsService, persisted on change.
- Branch content rendering: BTC tab keeps today's UI unchanged; USDB tab uses new balance card + filtered transaction list + zero-state empty view per design.md §10.5.
- Update `QuickAction` row: add Swap action (icon `swap-horizontal`, `BRAND_COLOR`), pass active asset to Send/Receive/Swap route params per design.md §10.6.

**Depends on:** T06

**Effort:** L (combined); can be delivered as 3 PRs T12.a → T12.b → T12.c.

**Files touched**
- `src/hooks/useWallet.ts`
- `src/services/settingsService.ts`
- `src/services/displayCurrencyService.ts` (possibly — active asset persistence)
- `src/features/wallet/components/AssetTabBar.tsx` (new)
- `src/features/wallet/screens/HomeScreen.tsx`
- `src/features/wallet/types.ts` — add `WalletAsset` type
- `src/services/i18nService.ts` — new keys (handled in T03 but verify coverage)

**Acceptance criteria**

T12.a tests (useWallet + settings):
- `useWallet.test.ts` — `tokenBalances` is populated from mocked `getInfo().tokenBalances`.
- `useWallet.test.ts` — `usdbBalance` returns `0n` when USDB not present.
- `useWallet.test.ts` — `getTransactionsForAsset('BTC')` excludes conversion-type entries never, and includes them always (swaps appear in both tabs — design.md §10.5).
- `useWallet.test.ts` — `getTransactionsForAsset('USDB')` excludes pure BTC entries and includes USDB + conversion entries.
- `settingsService.test.ts` — `getActiveAsset()` defaults to `'BTC'` when unset.
- `settingsService.test.ts` — `setActiveAsset('USDB')` persists across getter calls.

T12.b tests (AssetTabBar):
- Renders tab labels from i18n.
- Active tab has `BRAND_COLOR` background and `#1a1a2e` text; inactive has transparent fill and `primaryTextColor` text.
- Tapping inactive tab fires `onChange` with the new asset.
- Tapping active tab is a no-op (idempotent).

T12.c tests (HomeScreen integration):
- Renders `AssetTabBar` with BTC active by default.
- Clicking USDB tab calls `settingsService.setActiveAsset('USDB')`.
- BTC active → balance card shows sats, transactions list is BTC-only + swap entries.
- USDB active with `usdbBalance > 0` → balance card shows USDB amount + fiat, Send/Receive/Swap all visible.
- USDB active with `usdbBalance === 0n` and no history → zero-state empty view with single Swap CTA (no Send / Receive buttons).
- Quick Actions pass `asset=USDB` route param when active tab is USDB.
- Swap Quick Action passes `direction=BTC_TO_USDB` when BTC active, `direction=USDB_TO_BTC` when USDB active.
- Tab selection persists after screen re-mount (simulated via re-render with new key).

Manual QA (on iOS + Android):
1. Fresh install → BTC tab active, identical to today's Home.
2. Switch to USDB tab → balance card changes, transactions filter, Quick Actions update.
3. Switch back to BTC → everything reverts.
4. Close and reopen app → last-active tab is restored.
5. Zero-USDB state → only the Swap CTA is shown, tapping it opens Swap screen BTC→USDB.
6. After a completed BTC→USDB swap, Home switches active tab to USDB so the new balance is visible (design.md §11 nav note).
7. Existing BTC send/receive flows: no regressions.

---

## T12b — Send/Receive Screens: Asset Parameter Handling

**Description**  
Extend the existing `app/wallet/send.tsx` and `app/wallet/receive.tsx` to accept an optional `asset=BTC|USDB` route param (see design.md §11). When `asset=USDB`:

- The internal `[Lightning | On-chain]` tabs render the On-chain tab as disabled with `opacity: 0.4` and show a banner: `"USDB transfers stay on Spark. [Swap to BTC →]"`.
- The Lightning destination parser accepts Spark addresses/invoices with matching USDB `tokenIdentifier`. Bolt11 produces an inline error with a "Switch to BTC" action that flips the Home active asset and navigates back.
- The amount input is denominated in USDB (2 display decimals), using `TokenMetadata.decimals` for internal math.

Full USDB send composition (build-a-USDB-invoice from Receive, address book interop, contact autocomplete) is **out of scope** for this task. Task focus is on **asset-aware gating and parse-error messaging** — enough to make the Home USDB-tab entry points (T12) safe and discoverable without leading users into impossible states. Full USDB composition lands as its own epic (see T16 decision).

**Depends on:** T02 (token config), T03 (i18n), T12.c (Home sends the asset param)

**Effort:** M

**Files touched**
- `app/wallet/send.tsx`
- `app/wallet/receive.tsx`
- `src/services/breezSparkService.ts` — `parsePaymentRequest` may need to surface `tokenIdentifier` from Spark invoices (verify 0.13.1 API)

**Acceptance criteria**

Unit tests:
- `send.test.tsx` — with `asset=USDB`, on-chain tab is visibly disabled.
- `send.test.tsx` — with `asset=USDB`, tapping on-chain tab shows swap-to-btc banner.
- `send.test.tsx` — with `asset=USDB`, pasting a bolt11 shows inline error with switch-to-btc action.
- `send.test.tsx` — with `asset=USDB`, pasting a valid USDB Spark invoice parses successfully and accepts an amount in USDB units.
- `send.test.tsx` — with `asset=BTC` or undefined, all existing behavior is preserved (regression guard).
- `receive.test.tsx` — with `asset=USDB`, on-chain tab disabled.
- `receive.test.tsx` — with `asset=USDB`, Lightning tab generates a Spark invoice with `tokenIdentifier` populated.

Manual QA:
1. Home USDB tab → Send → opens with on-chain disabled, banner visible.
2. Paste bolt11 → error message with "Switch to BTC" action.
3. Paste a USDB Spark invoice → accepts, shows preview in USDB.
4. Home USDB tab → Receive → generates a USDB invoice. QR scans correctly on another wallet.
5. Home BTC tab → Send/Receive → unchanged from today.

---

## T16 — DECISION: Scope of full USDB send/receive composition UI

**Description**  
A decision task, not an implementation. The current swap spec gates USDB send/receive entry points (T12b) but does NOT build a full USDB composition UI (amount entry, address book integration, QR generation polish, etc.). Decide whether to:

- **(a)** Expand the swap epic to include full USDB send/receive composition, adding T17–T19 tasks
- **(b)** Ship swap with minimal USDB gating (T12b as-is) and create a follow-up epic "USDB first-class support" to track full composition
- **(c)** Defer USDB send/receive entirely and only ship swap — in this case, T12b reduces to *hiding* Send/Receive buttons in the USDB Home tab instead of routing to asset-aware screens

Output is an updated requirements.md (FR-10 adjusted) and an updated tasks.md (either expanded or reduced). No code changes.

**Depends on:** T12.c (Home tab structure determined)

**Effort:** S

---

## T13 — Transaction History: Swap Entry Rendering

**Description**  
Update `TransactionHistoryScreen.tsx` (and any shared transaction list component) to detect swap/conversion payment entries and render them with the `swap-horizontal` icon and net direction label (`swap.history.btcToUsdb` / `swap.history.usdbToBtc`). Do not render the internal self-send and self-receive legs as separate entries. Swap entries are non-interactive in v1 (no detail view — flagged as future enhancement in design.md §12). Verify the exact `Payment` field used to identify swaps against the installed 0.13.1 types (the spec uses `paymentType === 'conversion'` as the assumed name — builder confirms at implementation).

**Depends on:** T03, T04, T11

**Effort:** M

**Files touched**
- `src/features/wallet/screens/TransactionHistoryScreen.tsx`
- Any shared transaction list / item component

**Acceptance criteria**

Unit tests (mock payment entries):
- `transactionHistory.test.tsx` — a payment identified as a conversion renders as a single entry with `swap-horizontal` icon.
- `transactionHistory.test.tsx` — internal self-payment legs are not rendered as separate entries.
- `transactionHistory.test.tsx` — BTC→USDB swap shows correct direction label.
- `transactionHistory.test.tsx` — USDB→BTC swap shows correct direction label.
- `transactionHistory.test.tsx` — tapping a swap entry is a no-op (no detail view in v1).

Manual QA (only verifiable after T11 lands + a real swap completes):
1. After a completed swap, exactly one entry appears in history.
2. The entry shows the swap-horizontal icon.
3. The entry shows the correct direction and net amounts.
4. Existing non-swap transactions are unaffected.
5. Tapping the swap entry does not open a detail view.

---

## T14 — Slippage Persistence + Custom bps Settings Row

**Description**  
Two parts:

(A) **Persistence service**: extend `settingsService` with `getSwapSettings()` / `updateSwapSettings()` for the `{ slippageBps: number }` object. `useSwap` reads on mount, writes on change. Default is 50 bps.

(B) **Settings UI for custom bps (US-7.2)**: add a "Swap" section to Wallet Settings (likely `src/features/wallet/screens/settings/SwapSettingsScreen.tsx` — mirror the structure of `SecuritySettingsScreen.tsx`). Contains a single numeric input "Custom slippage (bps)" bound to `swap_settings.slippageBps`. Validates range 1–1000. Adds a navigation entry in the Settings index screen.

This is the home of the custom-bps input — the Swap screen's Advanced section only exposes preset chips (0.1 / 0.5 / 1%), not a custom field.

**Depends on:** T03

**Effort:** M

**Files touched**
- `src/services/settingsService.ts` — add `getSwapSettings()` / `updateSwapSettings()`
- `src/hooks/useSwap.ts` — read/write slippage via settings service
- `src/features/wallet/screens/settings/SwapSettingsScreen.tsx` (new)
- `app/wallet/settings/swap.tsx` (new — expo-router entry)
- `src/features/wallet/screens/settings/SettingsScreen.tsx` (or whatever the settings index screen is) — add nav row to Swap settings

**Acceptance criteria**

Unit tests:
- `settingsService.test.ts` — `getSwapSettings()` returns `{ slippageBps: 50 }` when no value stored.
- `settingsService.test.ts` — `updateSwapSettings({ slippageBps: 100 })` persists and is returned by subsequent `getSwapSettings()`.
- `useSwap.test.ts` — `slippageBps` initialises from persisted settings value.
- `SwapSettingsScreen.test.tsx` — rejects values below 1 with inline error.
- `SwapSettingsScreen.test.tsx` — rejects values above 1000 with inline error.
- `SwapSettingsScreen.test.tsx` — persists value on save and navigates back.

Manual QA:
1. Set slippage to 1% via Advanced chips on the Swap screen.
2. Close and reopen the Swap screen — slippage still 1% (persisted).
3. Open Wallet Settings → Swap → enter custom value 75 → save.
4. Re-open Swap screen — chip display shows "Custom 0.75%" (or highlights none if outside presets); value 75 is used in `ConversionOptions`.
5. Try entering 0 or 1001 in Swap settings — validation error shown, not saved.

---

## T15 — End-to-End QA Pass and Accessibility Audit

**Description**  
Manual QA pass covering all 12 UX states on both iOS and Android. Accessibility audit: verify `accessibilityLabel`, `accessibilityRole`, and `accessibilityLiveRegion` on all interactive and dynamic elements. Fix any issues found. Update `design.md` if any implementation detail diverged from spec.

**Depends on:** T11, T12, T13, T14

**Effort:** M

**Files touched**
- Any component files requiring accessibility fixes
- `.kiro/specs/btc-usdb-swap/design.md` — update if needed

**Acceptance criteria**

Manual QA (all 12 states verified on iOS + Android):
1. Idle — limits loaded, Review disabled.
2. Typing — shimmer visible in receive card.
3. Quote Loaded — all rate/fee/slippage fields populated, Review enabled.
4. Quote Refreshing — background re-fetch fires after 10 s; flash on rate change.
5. Insufficient Balance — inline error, Review disabled.
6. Below-min / Above-max — inline error with limit value, Review disabled.
7. Review Modal — all fields shown, biometric prompt on Confirm.
8. Confirming — spinner + progress bar, no interaction possible.
9. Success — checkmark, amounts, Done navigates home.
10. Dust Residual — residual amount shown in note.
11. Refunded — both CTAs functional.
12. Network/Pool Error — Retry resets to Idle.

Accessibility:
- VoiceOver (iOS) and TalkBack (Android) announce all interactive elements correctly.
- Error messages are announced when they appear.
- Skeleton shimmer is announced as "Loading quote".
