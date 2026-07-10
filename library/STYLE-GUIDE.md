# ZapArc Mobile — Style Guide

> Single source of truth for reusable UI patterns in this repo.
> Builder: read this before UI work and update when introducing new reusable components.

---

## Stack

- **Framework:** React Native (Expo Router)
- **Styling:** React Native `StyleSheet` + theme helpers
- **Theme:** Light and dark modes via `ThemeContext`

---

## Tokens

| Token | Value |
|---|---|
| Primary | `BRAND_COLOR` |
| Primary text (active tab on brand bg) | `#1a1a2e` |
| Surface muted | `rgba(255,255,255,0.08)` |
| Text color | `getPrimaryTextColor(themeMode)` |
| App background | `getAppBackgroundColor(themeMode)` |
| Card background | `getCardBackgroundColor(themeMode)` |
| Border/divider | `getBorderColor(themeMode)` |
| Status bar | `getStatusBarStyle(themeMode)` |
| Android navigation bar | `getNavigationBarColor(themeMode)` |

## Theme Rules

- `ThemeContext` is the app-wide source for `themeMode`, Paper theme tokens, and theme switching.
- Theme selection is persisted through `settingsService.updateUserSettings({ theme })`.
- Use `getGradientColors(themeMode)` for wallet and settings gradient screens.
- Use `getAppBackgroundColor(themeMode)` for solid-background screens and root surfaces.
- Use `getCardBackgroundColor(themeMode)` plus `getBorderColor(themeMode)` for cards, rows, modals, and sheet separation.
- Status bar and Android navigation bar chrome are controlled by `AppThemeSystem`; do not hardcode a light status bar in screens.
- Dark mode should keep ZapArc's navy/gold brand feel, with visible borders and section separation instead of a flat black surface.

---

## Components

### Asset tabs

`AssetTabBar` (`src/features/wallet/components/AssetTabBar.tsx`)
- Reuses Send screen tab styling verbatim.
- Container style mirrors `send.tsx`: `tabContainer`.
- Button style mirrors `send.tsx`: `tabButton` + active modifier `tabButtonActive`.
- Active tab visuals:
  - background: `BRAND_COLOR`
  - text: `#1a1a2e`
- Inactive tab visuals:
  - background: transparent
  - text: `primaryTextColor`

### Send screen tab styles (source reference)

`app/wallet/send.tsx`
- `tabContainer`
- `tabButton`
- `tabButtonActive`
- `tabText`


### Home screen asset routing

`src/features/wallet/screens/HomeScreen.tsx`
- Uses `AssetTabBar` under the header and persists selected asset via `settingsService.getActiveAsset()/setActiveAsset()`.
- Quick actions are asset-aware: `Send`, `Receive`, `Scan`, `History`, and `Swap` routes include `asset` context.
- `Swap` route derives its initial direction from the incoming `asset` param (`BTC` → `BTC_TO_USDB`, `USDB` → `USDB_TO_BTC`) and only falls back to a raw `direction` param for backward compatibility.
- USDB tab adds a leading `Swap` quick action and a zero-state card with single CTA `Swap sats → USDB` when `usdbBalance === 0` and no USDB history.


### Swap terminal states

`src/features/wallet/components/SwapResultView.tsx`
- Terminal-state component for swap flows: `success`, `dustResidual`, `refunded`, `error`.
- `dustResidual` must display residual in **USDB units** (not fiat).
- `refunded` variant keeps two CTAs visible together: retry + increase slippage.

### Swap amount input card

`src/features/wallet/components/SwapAmountCard.tsx`
- Reusable amount-entry card for swap flows with plain text currency label (no dropdown).
- Loading state uses animated opacity pulse skeleton rows (no `ActivityIndicator`).
- Max control supports disabled state with helper tooltip text.

### Swap screen integration shell

`src/features/wallet/screens/SwapScreen.tsx`
- Compose swap flow from shared parts: `SwapAmountCard` (pay/receive), `SwapRateLine`, `SwapReviewModal`, and `SwapResultView`.
- Keep connectivity status visible with inline top banners for offline and limits-unavailable states.
- During `confirming`, block navigation gestures/back and show a dedicated confirming state block instead of actionable CTAs.

### Swap accessibility contract

- Loading quote placeholders must be exposed as `progressbar` with `accessibilityLabel="Loading quote"` and `accessibilityLiveRegion="polite"`.
- Dynamic error text (inline rate errors, auth errors, connectivity banners) must use live region announcements.
- Terminal result containers should expose state semantics:
  - success/refunded: explicit accessibility labels (for example `Swap completed`, `Swap refunded`)
  - failure: `accessibilityRole="alert"`

### Send screen currency picker

`app/wallet/send.tsx`
- The visible currency badge opens a centered modal picker instead of cycling currencies on tap.
- Reuse a single `showCurrencyPicker` state path for both Lightning and on-chain amount rows so the selector behaves the same in both tabs.
- The picker lists `sats`, `USD`, and `EUR`, shows a checkmark on the active option, and persists the selection through `setDisplayCurrency`.
- Keep the selector disabled for fixed-asset USDB sends.

### Transaction detail custom note row

`src/features/wallet/screens/TransactionHistoryScreen.tsx`
- Sender-authored comments saved after send are loaded from `AsyncStorage` with the `payment_note_<paymentId>` key when a transaction detail modal opens.
- Transaction detail modals must render invoice `Description` and user `Note` as separate rows when both exist.
