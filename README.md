# ZapArc Mobile

ZapArc Mobile is an alpha self-custodial Bitcoin wallet built with React
Native, Expo, and Breez SDK Spark. The mobile app is the phone-native half of
ZapArc: a wallet for creating or importing keys, receiving and sending sats,
protecting local access with PIN/biometric flows, and preparing recovery paths
that keep the user in control.

The companion browser extension lives in a separate repository:
[github.com/21digitalai/ZapArc](https://github.com/21digitalai/ZapArc).

## Status

ZapArc Mobile is alpha/prototype software.

- It has not completed an external security audit.
- It should not be used with meaningful funds.
- Some exchange-like BTC/USDB surfaces are present in code but disabled for
  normal release builds until review, policy, and distribution questions are
  resolved.
- Demo recordings and screenshots should use throwaway wallets, test funds, and
  sanitized device/account state.

## Why It Matters

ZapArc is aimed at practical Bitcoin utility:

- Make self-custodial Lightning wallet setup easier for mobile users.
- Give users a clearer path to backups, wallet recovery, and local security.
- Provide a mobile base that can pair conceptually with browser-based Bitcoin
  workflows.
- Keep the project FOSS-friendly and inspectable for grant reviewers,
  contributors, and users.

## Current Features

- Create a new wallet from a generated BIP39 mnemonic.
- Import an existing wallet from a recovery phrase.
- Store wallet seed material encrypted with a user PIN.
- Unlock with PIN and optional biometric-gated PIN retrieval.
- Auto-lock and lockout/backoff flows for repeated PIN failures.
- Receive Lightning payments with invoice/QR flows.
- Send Lightning payments, including LNURL/Lightning Address routing where
  supported.
- QR scanner entry points for payment flows.
- Transaction history and wallet balance refresh.
- Google Drive encrypted backup/restore flow for seed backups.
- Lightning Address registration and push-notification subscription plumbing.
- Local settings for language, theme, display currency, security, and wallet
  preferences.
- BTC/USDB swap UX and Spark integration code behind release feature flags.

## OpenSats Readiness Docs

- Demo package: [docs/opensats/demo-package.md](docs/opensats/demo-package.md)
- Security model: [SECURITY.md](SECURITY.md)
- Grant roadmap: [docs/opensats/roadmap.md](docs/opensats/roadmap.md)

## Repository Layout

```text
.
├── mobile-app/                    # Expo React Native wallet app
│   ├── app/                       # Expo Router routes
│   │   └── wallet/                # Wallet screens and settings routes
│   └── src/
│       ├── features/wallet/       # Wallet screens, components, types
│       ├── hooks/                 # Wallet/auth/settings hooks
│       ├── services/              # Storage, Breez/Spark, backup, notifications
│       ├── utils/                 # Mnemonic, currency, deep-link helpers
│       └── config/                # Runtime feature flags and app config
├── notifications-handler/         # Firebase notification webhook service
├── assets/opensats-demo/          # Demo screenshot/video destinations
├── docs/                          # Development and OpenSats docs
├── app-store/                     # Store listing/support/privacy materials
└── library/                       # Project implementation guides
```

## Requirements

- Node.js 18+
- npm
- Xcode and CocoaPods for iOS simulator builds
- Android Studio and an Android emulator for Android builds
- Expo tooling through the mobile app dependencies

For local native setup details, see
[docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

## Setup

Install root and mobile dependencies:

```bash
npm install
```

Run the Expo app:

```bash
npm run dev:mobile
```

Or run from the mobile app directory:

```bash
cd mobile-app
npm start
```

Common mobile commands:

```bash
cd mobile-app
npm run ios
npm run android
npm test
```

Root shortcuts:

```bash
npm run setup
npm run dev
npm test
npm run clean
```

## Notification Handler

The notification webhook service is separate from the mobile runtime:

```bash
cd notifications-handler
npm install
npm test
```

See [notifications-handler/README.md](notifications-handler/README.md) and
[notifications-handler/SETUP_GUIDE.md](notifications-handler/SETUP_GUIDE.md).

## Architecture Notes

### Wallet Storage

Wallet metadata and encrypted seed material are stored through Expo
SecureStore. Seed phrases are encrypted with PIN-derived AES-256-GCM payloads
in `mobile-app/src/services/crypto.ts` and managed by
`mobile-app/src/services/storageService.ts`.

### Backup And Restore

Cloud backup code lives in `mobile-app/src/services/googleDriveBackupService.ts`
and `mobile-app/src/services/backupEncryption.ts`. Backups use a separate
backup password with AES-256-GCM and PBKDF2-SHA256. Google Drive is used as a
user-controlled storage destination for encrypted backup files.

### Lightning / Spark

Breez SDK Spark integration code lives primarily in
`mobile-app/src/services/breezSparkService.ts`. Wallet hooks and screens call
that service for balance, receive, send, sync, and swap-related operations.

### Release Feature Flags

User-facing BTC/USDB swap and multi-asset UI entry points are gated in
`mobile-app/src/config/features.ts`. Keep those flags conservative for public
release builds until legal/review scope is clear.

## Safety And Responsible Use

This repository is public-facing proof-of-work, not a production security
claim. Treat it as alpha software:

- Use only test funds or small disposable amounts during development.
- Never commit seeds, private keys, OAuth secrets, API keys, or real invoices.
- Do not publish screenshots or video that reveal seed words, backup passwords,
  personal Google accounts, wallet identifiers, or real balances.
- Report security issues privately before opening a public issue.

For the detailed threat model and reporting contact, see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
