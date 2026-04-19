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
- Quick actions are asset-aware: `Send`, `Receive`, `Scan`, and `History` routes include `asset` param.
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
