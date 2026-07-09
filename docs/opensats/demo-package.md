# ZapArc OpenSats Demo Package

This package gives OpenSats reviewers a short proof-of-work path for the
ZapArc mobile wallet and the companion browser extension narrative. It is
designed for a sub-3-minute review without exposing seeds, private keys,
credentials, or real balances.

## Reviewer Summary

ZapArc is a self-custodial Bitcoin wallet project with two surfaces:

- Mobile wallet: React Native/Expo app for creating or importing a wallet,
  receiving and sending Lightning payments, managing wallet security, and
  swapping between sats and USDB.
- Browser extension: companion ZapArc browser experience for bringing the same
  Bitcoin utility into desktop web workflows.

The mobile app already contains wallet onboarding, PIN unlock, local wallet
state, Lightning Address setup, receive/send flows, QR scanning, transaction
history, currency display, push-notification hooks, Google Drive backup flows,
and BTC/USDB swap screens backed by Breez SDK Spark integration code. The
BTC/USDB user-facing entry points are currently release-gated; present them as
prototype proof-of-work unless the feature flags are intentionally enabled for a
test build.

## Feature List For Grant Review

- Self-custody onboarding with create-wallet, import-wallet, and cloud-restore
  entry points.
- PIN and biometric wallet lock flows for everyday device security.
- Lightning receive flow with QR/invoice presentation.
- Lightning send flow with LNURL and Lightning Address routing support.
- Address book prompts after payments so recurring recipients can be saved.
- Transaction history with payment and swap rows.
- Lightning Address registration and notification subscription support.
- Google Drive backup and restore path for wallet recovery.
- BTC and USDB wallet tabs, asset picker sheets, and BTC-to-USDB / USDB-to-BTC
  swap review screens.
- Localized UI, currency conversion, theme controls, and wallet preferences.

## Three-Minute Demo Script

Target length: 2:30 to 3:00.

### 0:00-0:20 - Project framing

Say:

> ZapArc is a self-custodial Bitcoin wallet for mobile, paired with a browser
> extension for desktop web use. The goal is to make everyday Bitcoin payments,
> receiving, and wallet recovery approachable without taking custody away from
> the user.

Show:

- App launch or wallet welcome screen.
- Repo README/package metadata if recording a developer-facing demo.

### 0:20-0:55 - Wallet setup and custody

Show:

- Wallet welcome screen.
- Create/import/restore options.
- PIN or unlock screen if a demo wallet already exists.

Say:

> The mobile wallet starts with self-custody setup. A reviewer can see that the
> user creates or imports a wallet locally, protects it with a PIN, and can
> restore from an encrypted cloud backup when configured.

Safety:

- Use a throwaway demo wallet only.
- Do not show seed words, backup keys, OAuth secrets, or recovery files.

### 0:55-1:30 - Receive and identity

Show:

- Home wallet balance with demo/test amount hidden or negligible.
- Receive screen with QR/invoice.
- Lightning Address settings if available.

Say:

> The wallet focuses on practical Bitcoin utility: receive Lightning payments,
> present invoices as QR codes, and configure a Lightning Address for a simpler
> payment identity.

Safety:

- Blur or regenerate invoices before publishing if they encode any reusable
  account information.
- Keep balances at zero or test-only values.

### 1:30-2:05 - Send, scan, and contacts

Show:

- Send screen.
- QR scanner entry point.
- Address book prompt or settings surface.

Say:

> Sending supports paste, QR scanning, and Lightning Address style destinations.
> After a successful payment, ZapArc can prompt the user to save the recipient
> so repeat payments are less error-prone.

Safety:

- Do not broadcast a real payment during the public recording.
- Use mocked/test data where possible.

### 2:05-2:35 - BTC/USDB swap proof-of-work

Show:

- Asset tabs on Home if enabled in the test build.
- Swap screen if enabled in the test build.
- Quote/review modal if a test quote is available.

Say:

> ZapArc is also building multi-asset wallet UX around sats and USDB. The app
> includes asset tabs, balance-aware swap inputs, quote review, fee display, and
> result handling for BTC-to-USDB and USDB-to-BTC conversions.

### 2:35-3:00 - Browser extension and next milestone

Show:

- Browser extension repo/app screen separately, if available.
- Roadmap or grant paragraph.

Say:

> The mobile app is the self-custodial base. The browser extension extends the
> same ZapArc wallet concept into desktop web contexts. OpenSats support would
> fund hardening, public demos, security review, and release polish across both
> surfaces.

## Screenshot Checklist

Store captures under `assets/opensats-demo/screenshots/`.

Recommended filenames:

- `01-wallet-welcome.png` - create/import/restore entry points.
- `02-wallet-home-btc.png` - BTC balance tab with no real balance exposed.
- `03-wallet-receive.png` - receive QR/invoice with test-only invoice.
- `04-wallet-send.png` - send form with placeholder/test destination.
- `05-lightning-address.png` - Lightning Address settings or claim flow.
- `06-wallet-security.png` - PIN/biometric/security settings.
- `07-wallet-backup.png` - Google Drive backup/restore screen without account
  identifiers.
- `08-swap-btc-usdb.png` - swap entry screen with safe demo amount.
- `09-swap-review.png` - quote review modal if test quote is available.
- `10-browser-extension.png` - companion browser extension screen from the
  separate ZapArc repo.

## Screen-Recording Checklist

Store raw clips under `assets/opensats-demo/video/raw/` and edited exports under
`assets/opensats-demo/video/exports/`.

Before recording:

- Use a fresh simulator/emulator profile or a throwaway physical-device wallet.
- Disable notification previews from personal apps.
- Set wallet balance visibility to hidden unless showing test funds.
- Remove real Google accounts, OAuth identifiers, email addresses, and API keys.
- Confirm no seed phrase, mnemonic, private key, recovery code, or real invoice
  will appear in the clip.

Suggested clips:

- `01-mobile-onboarding.mp4` - launch, create/import/restore entry points.
- `02-mobile-receive-send.mp4` - home, receive, send, scan entry points.
- `03-mobile-swap.mp4` - asset tabs and swap review.
- `04-extension-companion.mp4` - desktop/browser companion narrative.
- `zaparc-opensats-demo.mp4` - final edited 2:30-3:00 video.

## Regenerating Assets

### Mobile screenshots

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the mobile dev server:

   ```bash
   npm run dev:mobile
   ```

3. Open the iOS simulator or Android emulator.

4. Navigate through the checklist screens.

5. Save screenshots into `assets/opensats-demo/screenshots/` using the
   recommended filenames.

### Mobile screen recording

1. Start the app with `npm run dev:mobile`.
2. Use iOS Simulator screen recording, Android Emulator screen recording, or a
   device recorder.
3. Record only the checklist flows.
4. Trim dead time and transitions.
5. Export the final video as `assets/opensats-demo/video/exports/zaparc-opensats-demo.mp4`.

### Browser extension capture

1. Open the companion extension repo at `/Users/bvg/Repositories/ZapArc`.
2. Follow that repo's local run instructions.
3. Capture one screen that shows the extension as the desktop companion surface.
4. Save the screenshot as `assets/opensats-demo/screenshots/10-browser-extension.png`.

## Known Limitations To State Honestly

- Public demo media is not committed yet; this document defines the capture
  script, asset paths, and safety checklist.
- The browser extension is maintained in a separate repository and should be
  captured separately.
- Swap behavior depends on Breez SDK Spark availability, configured tokens, and
  test liquidity. The public release flags currently hide user-facing swap and
  multi-asset entry points; if a live quote or enabled test build is unavailable,
  show code/screens from a controlled test build and describe the dependency
  instead of fabricating a successful conversion.
- Push notification and Lightning Address flows depend on platform permissions
  and backend/webhook configuration.
- Google Drive backup and restore require OAuth setup; public recordings should
  avoid showing personal account identifiers.

## Asset Paths

- Demo script and capture instructions:
  `docs/opensats/demo-package.md`
- Screenshot destination:
  `assets/opensats-demo/screenshots/`
- Raw video destination:
  `assets/opensats-demo/video/raw/`
- Edited video destination:
  `assets/opensats-demo/video/exports/`
