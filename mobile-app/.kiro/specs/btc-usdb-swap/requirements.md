# BTC ⇄ USDB Swap — Requirements

## Overview

Users can swap between Bitcoin (sats) and USDB (Breez USD stablecoin on Spark) directly within ZapArc. The swap is self-custodial, routed through the Flashnet AMM via the Breez SDK Spark `prepareSendPayment` + `ConversionOptions` primitive. No third-party custody or compliance layer is involved.

## Out of Scope (v1)

The following are explicitly excluded from this spec. Each has a placeholder entry in the design document's Future Enhancements section.

- **Stable Balance feature** — the auto-hold-as-USD mode is a separate Breez feature (`StableBalanceConfig` / `updateUserSettings`). Tracked as a future epic.
- **Non-USDB tokens** — the `SWAP_TOKENS` config supports multi-token, but v1 only wires up USDB.
- **Fiat-priced input on swap** — users enter amounts in sats or USDB; fiat display is read-only and derived via `satsToFiat`.
- **Dust sweep helper** — no UI for consolidating residual USDB dust into BTC. Backlog.
- **Swap transaction detail view** — history entries do not open a detail screen in v1. Tapping a swap entry is a no-op for now. Future enhancement.
- **Analytics / telemetry** — no event tracking for swap initiate / quote / confirm / complete / refund in v1. Can be added later under the existing analytics service.

---

## Functional Requirements

### FR-1 Home Screen Asset Tabs

The Home screen adds a new **asset-tab bar** above the balance card that lets the user switch between their BTC and USDB wallets. The active tab scopes balance, quick actions, and transaction list to the selected asset. This is a structural change that replaces the previous "secondary USDB row" idea — each asset gets its own full home view.

The tab styling reuses the existing LN/on-chain tab pattern from `app/wallet/send.tsx` and `app/wallet/receive.tsx` (inline `TouchableOpacity` pair, rounded pill container, active tab filled with `BRAND_COLOR`).

**US-1.1** As a user, I want asset tabs [BTC | USDB] on the Home screen below the header, so that I can see each wallet as its own self-contained view.

Acceptance criteria:
```
Given I am on the Home screen with a connected wallet
Then an asset-tab bar is visible below the header containing two tabs: "BTC" and "USDB"
And the BTC tab is active by default on first launch
And the active tab uses BRAND_COLOR fill with #1a1a2e text
And the inactive tab has transparent fill with primaryTextColor text
And the active asset persists across app sessions (via settingsService)

Given my USDB balance is 0 AND I have never swapped before
Then the USDB tab is still visible (always present, not hidden)
But tapping the USDB tab shows a zero-state with a "Swap to USDB" CTA instead of Send/Receive buttons

Given I tap the USDB tab
Then the balance card, quick actions, and transaction list all re-render for the USDB asset
And the transition is immediate (no network round-trip — filters are client-side)
```

**US-1.2** As a user, I want the Swap action button in the Quick Actions row to respect the active asset tab, so that swapping feels contextual rather than requiring me to pick a direction manually.

Acceptance criteria:
```
Given the active asset tab is BTC
When I tap the Swap quick action
Then the Swap screen opens with direction pre-set to BTC→USDB

Given the active asset tab is USDB
When I tap the Swap quick action
Then the Swap screen opens with direction pre-set to USDB→BTC

The direction can still be flipped inside the Swap screen via the flip button.
```

**US-1.3** As a user, I want the Send and Receive quick actions to also inherit the active asset, so that I'm sending/receiving the currency I'm currently looking at.

Acceptance criteria:
```
Given the active asset tab is BTC
When I tap Send or Receive
Then the screen opens in BTC mode (existing behavior, no change)

Given the active asset tab is USDB
When I tap Send or Receive
Then the screen opens with asset=USDB set as a route param
And the screen's internal LN/on-chain tab defaults to LN
And the on-chain tab is visibly disabled with tooltip text from swap.i18n (see FR-10)
```

---

### FR-2 Swap Screen Layout

**US-2.1** As a user, I want to see a "You pay" card (top), a direction-flip button (middle), and a "You receive" card (bottom), so that the swap direction is always visually clear.

Acceptance criteria:
```
Given I am on the Swap screen
Then a "You pay" card is rendered at the top with currency label and amount input
And a circular flip button is rendered between the two cards
And a "You receive" card is rendered below with currency label and read-only estimated amount
And tapping the flip button swaps the source and destination currencies
And the amount input is cleared on direction flip
```

**US-2.2** As a user, I want to see the exchange rate, estimated fee, and slippage tolerance below the cards, so that I understand the cost of the swap before confirming.

Acceptance criteria:
```
Given a quote has been loaded
Then the rate line shows "1 BTC = X USDB" (or inverse)
And the fee line shows the estimated fee in sats
And the slippage line shows the configured tolerance (default 0.5%)
```

---

### FR-3 Amount Entry and Quoting

**US-3.1** As a user, I want to type an amount in the source currency and see the destination amount update automatically, so that I know exactly what I will receive.

Acceptance criteria:
```
Given I am on the Swap screen in Idle state
When I type a valid amount
Then the screen transitions to Typing state
And the destination card shows a skeleton shimmer while the quote is loading
And quote fetch is debounced by 400 ms after the last keystroke
When the quote resolves
Then the screen transitions to Quote Loaded state
And the destination amount, rate, fee, and slippage are displayed
And the "Review Swap" button becomes enabled

Given I am in Quote Loaded, Quote Refreshing, Insufficient Balance, Below-min, or Above-max state
When I change the amount
Then the screen transitions back to Typing state and re-quotes after debounce
```

**US-3.2** As a user, I want the quote to refresh automatically after 10 seconds of inactivity, so that I am not acting on a stale price.

Acceptance criteria:
```
Given I am in Quote Loaded state and have not interacted for 10 seconds
When the background re-fetch completes
Then the screen transitions to Quote Refreshing state during the fetch
If the new rate differs from the previous rate by more than 0.1% absolute
Then the destination amount flashes once: green if the user receives MORE, amber if LESS
```

**US-3.2a** As a user, I want changing the slippage tolerance (in the Advanced section) to trigger a fresh quote, so that the displayed estimate matches my new tolerance.

Acceptance criteria:
```
Given I am in Quote Loaded state
When I change the slippage preset
Then the screen transitions back to Typing/Quote Loading and re-quotes with the new slippageBps
```

**US-3.3** As a user, I want a "Max" button on the source card, so that I can swap my full available balance without manual calculation.

Acceptance criteria:
```
Given direction is BTC→USDB AND btcBalanceSats > 500
When I tap Max
Then the amount is set to (btcBalanceSats - 500) sats
And a label reads "Max (keep 500 sats for fees)"

Given direction is BTC→USDB AND btcBalanceSats ≤ 500
Then the Max button is disabled
And a tooltip/helper reads "Not enough sats to swap (need more than 500)"

Given direction is USDB→BTC AND usdbBalance > 0
When I tap Max
Then the amount is set to 100% of USDB balance
And a dust disclosure note is shown: "A small USDB residual may remain for slippage protection"

Given direction is USDB→BTC AND usdbBalance == 0
Then the Max button is disabled
```

---

### FR-4 Conversion Limits

**US-4.1** As a user, I want to be informed when my entered amount is below the minimum or above the maximum swap limit, so that I do not attempt an invalid swap.

Acceptance criteria:
```
Given fetchConversionLimits() has returned min/max values
When I enter an amount below the minimum
Then an inline error appears below the source card referencing the minimum (with the correct unit: sats for BTC→USDB, USDB for USDB→BTC)
And the "Review Swap" button is disabled

When I enter an amount above the maximum
Then an inline error appears below the source card referencing the maximum (with the correct unit)
And the "Review Swap" button is disabled

Given fetchConversionLimits() fails on screen mount
Then a non-blocking banner displays "Limits unavailable — swap temporarily disabled. Retry."
And the Review button remains disabled regardless of amount
And a Retry action re-invokes fetchConversionLimits()
```

**US-4.2** As a user, I want to be informed when my entered amount exceeds my available balance, so that I do not attempt a swap I cannot fund.

Acceptance criteria:
```
Given I enter an amount greater than my available balance for the source currency
Then an inline error "Insufficient balance" appears below the source card
And the "Review Swap" button is disabled
```

---

### FR-5 Review and Confirmation

**US-5.1** As a user, I want to review the final swap details in a confirmation dialog before committing, so that I can verify the numbers before funds move.

Acceptance criteria:
```
Given I am in Quote Loaded state
When I tap "Review Swap"
Then a modal dialog opens showing:
  - Direction (e.g. "BTC → USDB")
  - You pay amount
  - You receive amount
  - Rate
  - Fee
  - Slippage tolerance
And a "Cancel" button and a "Confirm" button are present
When I tap Cancel
Then the dialog closes and I return to Quote Loaded state
```

**US-5.2** As a user, I want the confirmation to require biometric authentication (or PIN fallback), so that swaps are protected by the same security as sends.

Acceptance criteria:
```
Given I tap "Confirm" in the Review modal
Then the auth flow is triggered via useWalletAuth (same code path as Send)
And if biometric is enrolled, the OS biometric prompt appears
And if biometric is unavailable/unenrolled, the PIN entry screen appears (handled by useWalletAuth)

If auth succeeds
Then the swap execution begins and the screen transitions to Confirming state
If auth fails or is cancelled
Then the dialog remains open and an error message is shown
```

**US-5.3** As a user, I want double-tapping Confirm to not fire two swaps, so that I cannot accidentally duplicate the transaction.

Acceptance criteria:
```
Given I am in Reviewing state
When I tap Confirm twice in rapid succession (before state transitions)
Then only one biometric prompt / PIN entry is triggered
And only one executeSwap call is made
(Implementation note: Confirm button must be disabled once tapped until the transition completes)
```

---

### FR-6 Swap Execution

**US-6.1** As a user, I want to see a progress indicator while the swap is executing, so that I know the app is working and approximately how long to wait.

Acceptance criteria:
```
Given the swap is executing
Then a spinner is shown with copy "Swapping… (up to 30s)"
And a progress indicator bounded by the 30-second timeout is visible
And the Android hardware back button is blocked (with a Toast "Swap in progress — please wait")
And the iOS swipe-back gesture is disabled
If the swap does not complete within the SDK-enforced completion_timeout_secs (30s)
Then the SDK returns a timeout result and the screen transitions to Network/Pool Error state
(Note: we rely on the SDK's completion_timeout_secs rather than an outer Promise.race timer, to avoid UI-SDK state divergence where the SDK completes after UI gave up)
```

**US-6.1a** As a user, I want backgrounding the app during a swap to not corrupt its state, so that when I return the UI reflects reality.

Acceptance criteria:
```
Given the swap is in Confirming state
When I background the app
And later return to the foreground
Then useSwap calls syncWallet() and checks listPayments() for the in-flight conversionId
And if the payment completed while backgrounded, the screen transitions to Success/DustResidual/Refunded
And if the payment is still pending, Confirming state resumes with the remaining timeout
And if the payment failed, the screen transitions to Error
```

**US-6.2** As a user, I want to see a success screen when the swap completes, so that I have confirmation the funds moved.

Acceptance criteria:
```
Given the swap completes successfully
Then the screen transitions to Success state
And a checkmark icon is shown
And the final paid amount and received amount are displayed
And a "Done" button navigates back to Home
And the Home screen balance reflects the updated BTC and USDB balances
```

**US-6.3** As a user, I want to be informed of any USDB dust residual after a USDB→BTC swap, so that I understand why my USDB balance is not exactly zero.

Acceptance criteria:
```
Given direction was USDB→BTC
And the swap completed with a non-zero USDB residual
Then the screen shows the Dust Residual success variant
And the residual amount is displayed: "A small USDB residual (X USDB) remains for slippage protection"
And a "Done" button navigates back to Home
```

**US-6.4** As a user, I want to be informed if the swap was refunded due to slippage, so that I know my funds are safe and can retry.

Acceptance criteria:
```
Given the SDK returns a slippage auto-refund
Then the screen transitions to Refunded state
And the title reads the swap.refunded.title i18n key
And the body explains the price moved beyond the tolerance
And a "Try again at current rate" CTA pre-fills the Swap screen with the latest quote
And an "Increase slippage tolerance" CTA opens the Advanced slippage settings
```

---

### FR-7 Slippage Settings

**US-7.1** As a user, I want to pick slippage tolerance via preset chips on the Swap screen, so that I can balance speed vs. price protection for the current swap.

Acceptance criteria:
```
Given I open the Advanced slippage section on the Swap screen (hidden by default behind a toggle)
Then I see three preset chips: 0.1%, 0.5%, 1%
And the currently active preset is highlighted with BRAND_COLOR
And selecting a chip persists the value to settings AND re-quotes with the new slippageBps
The default is 50 bps (0.5%)
```

**US-7.2** As a power user, I want to set a custom basis-points value for slippage in Wallet Settings → Swap, so that I can fine-tune beyond the presets.

Acceptance criteria:
```
Given I open Wallet Settings → Swap
Then I see a numeric input field labeled "Custom slippage (bps)"
And the field shows my current slippageBps value
When I enter a value between 1 and 1000 and save
Then the value persists and is used on the next Swap screen visit
When I enter a value outside 1–1000
Then an inline validation error appears and the value is not saved
```

---

### FR-8 Transaction History

**US-8.1** As a user, I want completed swaps to appear as a single entry in transaction history, so that the history is not cluttered with the internal self-payment legs.

Acceptance criteria:
```
Given a swap has completed
When I view transaction history
Then exactly one entry appears for the swap
And the entry uses the swap-horizontal icon
And the entry shows the net direction and amounts
```

---

### FR-9 Per-Asset Balance Card and Transaction List

Each asset tab renders its own balance card + transaction list. This replaces the previous "secondary USDB row" design.

**US-9.1** As a user on the BTC tab, I want the balance card to behave exactly as it does today — respecting my configured `displayCurrency` setting — so that my BTC workflow is not disrupted.

Acceptance criteria:
```
Given the BTC tab is active
Then the balance card renders via the existing useCurrency.format() pipeline (zero change)
And the primary/secondary values follow the user's current displayCurrency setting (sats / USD / EUR), configurable in Wallet Settings → Currency
And there is NO tap-to-cycle gesture on the Home balance card (that pattern only exists on Send/Receive inputs where unit conversion matters)
And the transaction list is filtered to entries where tokenIdentifier === undefined
And swap entries that touch BTC appear in this list with a swap-horizontal icon
```

**US-9.2** As a user on the USDB tab, I want the balance card to show USDB primary with my preferred fiat as a secondary line, using the same `displayCurrency` setting I configured for BTC, so that both tabs feel consistent.

Acceptance criteria:
```
Given the USDB tab is active AND usdbBalance > 0
Then the balance card shows the USDB amount as the primary number (e.g. "6.48 USDB"), formatted to 2 display decimals
And the secondary line shows the fiat equivalent using the user's configured displayCurrency:
  - displayCurrency === 'usd'   → "≈ $6.48"   (USDB ≈ USD 1:1)
  - displayCurrency === 'eur'   → "≈ €6.02"   (USDB → USD → EUR via existing rates pipeline)
  - displayCurrency === 'sats'  → "≈ 9,900 sats"  (USDB → BTC equivalent via AMM rate, falls back to cached rate if offline)
And there is NO tap-to-cycle gesture on this balance card either (consistent with BTC tab)
And the transaction list is filtered to entries where tokenIdentifier === <USDB identifier> OR paymentType === 'conversion'
And swap entries appear with a swap-horizontal icon showing the USDB side prominently

Given the USDB tab is active AND usdbBalance === 0 AND no prior swap/receive history
Then the balance card shows "0 USDB" with a helper line below: "Swap sats to USDB to get started"
And the Quick Actions row shows only the Swap button (Send and Receive are suppressed)
And the transaction list shows an empty state

Given the USDB tab is active AND wallet is loading
Then the balance card shows a skeleton placeholder until the first getInfo() resolves
```

Implementation note: a new helper `usdbToFiat(usdbAmount, displayCurrency)` lives in `useCurrency` (or `src/utils/currency.ts`). For `'usd'` it's identity (USDB ≈ USD 1:1). For `'eur'` it routes through the existing BTC/fiat rates pipeline using the USD leg. For `'sats'` it uses the current AMM rate from `resolveSwapTokens()` cache. The 1:1 USDB→USD assumption is documented inline and revisited if Breez ever publishes a non-par USDB.

**US-9.3** As a user, I want swap transactions to appear in **both** asset tabs' history (not duplicated internally, but shown from each asset's perspective), so that each wallet's record is complete.

Acceptance criteria:
```
Given a completed BTC→USDB swap
When I view the BTC tab's history
Then the entry shows "Swap · BTC → USDB" with the sats leg prominent ("−10,000 sats") and the USDB leg as a secondary line

When I view the USDB tab's history
Then the same logical entry shows "Swap · BTC → USDB" with the USDB leg prominent ("+6.48 USDB") and the sats leg as a secondary line

The entry originates from a single Payment in listPayments() — the two tabs present the same underlying record with different emphasis.
```

---

### FR-10 Send/Receive Asset Awareness

When the user lands on Send or Receive from the USDB tab, those screens need to route through Spark-native payment methods (not bolt11, not on-chain L1) because USDB only exists on Spark.

**US-10.1** As a user, I want the on-chain tab on the Send/Receive screens to be disabled when I'm sending/receiving USDB, with a tooltip explaining why, so that I don't waste time trying an impossible operation.

Acceptance criteria:
```
Given I open Send or Receive with asset=USDB route param
Then the internal tab bar still shows [Lightning | On-chain] (existing UI)
But the "On-chain" tab is visibly disabled (grey, reduced opacity ~0.4)
And tapping it shows an inline message: "USDB transfers stay on Spark. Swap to BTC to send on-chain."
And the message includes a "Swap to BTC" link that navigates to the Swap screen pre-set to USDB→BTC

Given asset is undefined or 'BTC' (default)
Then both tabs behave exactly as today (no change to existing BTC send/receive flows)
```

**US-10.2** As a user on the Send screen with asset=USDB, I want helpful parse errors when I paste a bolt11 invoice, so that I understand why it doesn't work and can switch currencies easily.

Acceptance criteria:
```
Given asset=USDB AND I paste a bolt11 invoice into the Lightning destination field
When parsing resolves
Then an inline error appears: "Bolt11 invoices are for Bitcoin. Switch to the BTC tab or paste a Spark invoice."
And a "Switch to BTC" action link switches the Home asset tab to BTC and closes this screen
And the Send button stays disabled

Given asset=USDB AND I paste a valid Spark address/invoice with matching tokenIdentifier
Then parsing succeeds and the flow proceeds as normal (amount input, preview, confirm)
```

**US-10.3** As a user on the Receive screen with asset=USDB, I want to generate a Spark invoice/address for USDB specifically, so that I can share a payment request with someone who wants to pay me in USDB.

Acceptance criteria:
```
Given asset=USDB AND I am on the Lightning tab of Receive
Then the generated invoice/address embeds tokenIdentifier=<USDB>
And the QR code encodes a Spark invoice (not bolt11)
And the copy-to-clipboard string is the Spark invoice payload
And amount input is in USDB (2 display decimals) not sats
```

Note: Full USDB send/receive UI is a broader feature beyond this swap spec. For v1 we deliver the **asset routing and on-chain gating** (US-10.1) so that entering Send/Receive from the USDB tab behaves correctly. The actual USDB send/receive composition (US-10.2 / US-10.3 detail) may be scoped into a follow-up epic — see task T16 for scope decision.

---

## Non-Functional Requirements

### NFR-1 Performance

- `fetchConversionLimits()` must be called once on screen mount; result cached for the session.
- Quote re-fetch (FR-3.2) must complete within 3 seconds on a typical mobile connection.
- The Confirming state must enforce a hard 30-second timeout; the UI must not hang indefinitely.
- Swap screen initial render (Idle state) must complete within 300 ms of navigation.

### NFR-2 Internationalisation

- Every user-facing string must be referenced via `t('swap.xxx')` i18n keys.
- No hardcoded English strings in component JSX or error messages.
- All keys must be present in both `en` and `bg` translation objects in `src/services/i18nService.ts`.
- Numeric amounts must use locale-aware formatting via existing `format()` / `satsToFiat()` utilities.

### NFR-3 Accessibility

- All interactive elements must have `accessibilityLabel` and `accessibilityRole` props.
- The flip button must have `accessibilityLabel={t('swap.flipDirection')}`.
- Error messages must be announced via `accessibilityLiveRegion="polite"`.
- Minimum touch target: 48×48 dp (Material) / 44×44 pt (iOS HIG). Paper defaults satisfy Button; verify for the custom flip button, slippage chips, and Max button.
- The skeleton shimmer must have `accessibilityLabel={t('swap.loadingQuote')}`. Use `accessibilityRole="progressbar"` on iOS; on Android fall back to `accessibilityState={{ busy: true }}` since `progressbar` is iOS-only in React Native.
- T15 QA must exercise both VoiceOver (iOS) and TalkBack (Android) across all 12 UX states.

### NFR-4 Security

- Swap confirmation must pass through `useWalletAuth` biometric/PIN gate — same code path as Send.
- The swap amount and destination address must not be logged to console in production builds.
- The self-payment receive address is ephemeral; it must not be stored or reused across swap sessions.

### NFR-5 Error Handling

- All SDK errors must be surfaced through `extractSdkErrorMessage()` from `src/services/breezSparkService.ts`. This helper is responsible for returning a localized, user-safe string — it must not return raw SDK exception strings.
- Network errors (no connectivity) must show the Network/Pool Error state with a Retry CTA.
- Slippage auto-refund must be detected and render the Refunded state — not the generic error state. The exact SDK signalling (error variant vs. successful payment with refund flag) is unresolved and must be confirmed with Breez devs before T04 (tracked as task T02a).
- Timeout relies on the SDK's `completion_timeout_secs: 30`. No outer Promise.race timer — the SDK returns a timeout result that we map to Network/Pool Error. This prevents UI-SDK state divergence.
- All errors must be logged via the existing error handling service for diagnostics.
- Fee displayed on the Swap screen and Review modal is the total `ConversionEstimate.fee` returned by the SDK, not a breakdown. Users see one fee line; internal composition (Spark + Flashnet + conversion overhead) is not surfaced.

### NFR-6 SDK Version

- This feature requires `@breeztech/breez-sdk-spark-react-native` ≥ 0.13.1.
- The SDK upgrade (kanban #679) is a hard blocker; no swap feature code should be merged before that task lands.

### NFR-7 Offline & Connectivity

- On Swap screen mount, `NetInfo.isConnected` is checked. If offline, the screen enters a "No connection" state that replaces the cards with a Retry CTA. The Swap flow does not start until online.
- If connection drops between Quote Loaded and Confirming, the quote stays visible with a banner "Connection lost — swap may fail". User can still tap Review; the execution error path handles SDK failure.
- If connection drops DURING Confirming, the Promise completes (timeout or error). Backgrounding recovery (US-6.1a) reconciles via `syncWallet` on next resume.

### NFR-8 Auto-Lock Interaction

- While the Swap screen is mounted in any non-terminal state (Idle through Confirming), the existing auto-lock timer behaves normally.
- If auto-lock fires on the Swap screen: the wallet lock overlay appears, user re-authenticates, and the Swap screen remounts to Idle (previous amount is discarded).
- If auto-lock fires during Confirming: the lock overlay is suppressed until the swap resolves or times out, then the lock engages. This prevents mid-swap UI teardown.

### NFR-9 Formatting

- Sats: thousands-separated per locale (EN: comma, BG: space). Reuse existing `format()` utility.
- USDB: formatted per `TokenMetadata.decimals` (from SDK, not hardcoded). Display precision is 2 decimals; internal precision can be more.
- Fiat equivalents on the Swap screen are read-only and reuse `satsToFiat()` from `src/utils/currency.ts`.
