# ZapArc Mobile Security

ZapArc Mobile is alpha self-custodial wallet software. This document explains
the current security model for reviewers and contributors. It is not an audit
report and should not be treated as a claim that the wallet is safe for
meaningful funds.

## Alpha Threat Model

ZapArc currently focuses on these risks:

- Accidental seed loss by the user.
- Accidental seed exposure in screenshots, logs, demo media, or clipboard use.
- Local device compromise after the app is unlocked.
- Weak backup passwords for cloud-stored encrypted backups.
- Repeated PIN guessing on the same device.
- Confusion between mobile-wallet trust boundaries and browser-extension trust
  boundaries.
- Release-policy risk around exchange-like BTC/USDB swap UI.

ZapArc does not currently claim to defend against:

- A fully compromised or rooted/jailbroken device.
- Malware with screen, keyboard, clipboard, filesystem, or accessibility access.
- A malicious operating system, simulator image, or developer machine.
- Supply-chain compromise of dependencies or app-store distribution.
- Loss of both the recovery phrase and backup password.
- Protocol-level bugs in Breez SDK Spark or upstream Lightning/Spark services.

## Self-Custody Boundary

The mobile wallet is intended to be self-custodial:

- The app creates or imports a BIP39 mnemonic.
- The mnemonic is encrypted locally before storage.
- Wallet unlock uses the user's PIN and optional biometric-gated PIN retrieval.
- Google Drive backup files are encrypted before upload.

ZapArc's developers should not receive the user's seed phrase, PIN, backup
password, or private keys in normal operation.

Important limitations:

- A user who loses their recovery phrase and backup password may lose access to
  funds.
- If a user records, shares, screenshots, or pastes their seed into another
  system, self-custody protections no longer help.
- The browser extension is a separate surface and must be reviewed separately.

## Seed And Mnemonic Handling

Relevant code paths:

- `mobile-app/src/hooks/useWallet.ts`
- `mobile-app/src/services/storageService.ts`
- `mobile-app/src/services/crypto.ts`
- `mobile-app/src/features/wallet/screens/WalletCreationScreen.tsx`
- `mobile-app/src/features/wallet/screens/WalletImportScreen.tsx`
- `mobile-app/src/features/wallet/screens/settings/BackupScreen.tsx`

Current model:

- Wallet creation requires the generated mnemonic shown to the user to be
  passed into wallet creation; the hook rejects missing fallback mnemonic input.
- Imported mnemonics are normalized and validated before storage.
- Stored mnemonic payloads are encrypted with AES-256-GCM using a PIN-derived
  key and per-wallet random salt.
- Legacy decrypt paths remain in code for older wallet payload compatibility.
- Decrypted mnemonic values may be cached in memory during an unlocked session
  to avoid repeated key derivation.
- Backup/reveal screens require PIN access before showing seed material.

Operational rules:

- Do not add debug logs that print mnemonics, PINs, backup passwords, invoices,
  OAuth tokens, or decrypted backup contents.
- Do not capture seed reveal screens in public demos.
- Clear demo wallets between recordings when possible.

## PIN, Biometric, And Device Storage

Relevant code paths:

- `mobile-app/src/services/storageService.ts`
- `mobile-app/src/services/securityService.ts`
- `mobile-app/src/hooks/useWalletAuth.ts`
- `mobile-app/src/features/wallet/screens/settings/SecuritySettingsScreen.tsx`

Current model:

- Expo SecureStore is used for wallet state and sensitive local values.
- The wallet has lock/unlock state and last-activity timestamps.
- Auto-lock is enabled by default through the security service.
- PIN failures have lockout/backoff state.
- Optional biometric support stores a biometric-protected PIN entry using
  SecureStore options with device/passcode constraints.

Known limitations:

- JavaScript strings cannot be reliably zeroized after use.
- SecureStore protections depend on the platform, device settings, and OS
  security.
- Biometric unlock protects app access; it does not replace the recovery phrase
  or backup password.
- Clipboard use for seed backup remains a high-risk user action.

## Backup And Restore

Relevant code paths:

- `mobile-app/src/services/backupEncryption.ts`
- `mobile-app/src/services/googleDriveBackupService.ts`
- `mobile-app/src/features/wallet/screens/settings/GoogleDriveBackupScreen.tsx`

Current model:

- Backup files are encrypted before upload.
- Current backups use AES-256-GCM with PBKDF2-SHA256 and a per-backup salt.
- Backup password strength is checked before encryption.
- Google Drive is used as storage for encrypted backup files, not as a trusted
  custodian of plaintext seed material.
- Restore requires the backup password to decrypt the backup.

Password implications:

- ZapArc cannot recover a forgotten backup password.
- A weak backup password lowers the cost of offline guessing if an encrypted
  backup file is obtained.
- Users should store recovery phrases and backup passwords outside the device.

## Mobile And Extension Trust Boundaries

The mobile app and browser extension are separate codebases:

- Mobile repo: [github.com/21digitalai/ZapArc_Mobile](https://github.com/21digitalai/ZapArc_Mobile)
- Browser extension repo: [github.com/21digitalai/ZapArc](https://github.com/21digitalai/ZapArc)

Security review should treat them as separate applications:

- Mobile risks center on device storage, native permissions, wallet unlock,
  backups, and mobile payment UX.
- Extension risks center on browser APIs, websites, content scripts, extension
  permissions, and desktop signing/payment flows.
- A secure mobile app does not automatically make the extension secure, and the
  extension should not be assumed to inherit mobile storage protections.

## BTC/USDB And Release Policy

Relevant code path:

- `mobile-app/src/config/features.ts`

The repository contains BTC/USDB swap UX and Spark integration work. User-facing
swap and multi-asset entry points are disabled for normal release builds while
policy, review, and distribution constraints are unresolved.

Do not present disabled swap surfaces as production-ready exchange
functionality. For demos, label this work as prototype/hardening scope.

## Vulnerability Reporting

Please report suspected vulnerabilities privately.

Current contact:

- Project maintainer/operator: Bob, Telegram `@bob1337x`

Include:

- A short description of the issue.
- Affected platform and app version/commit.
- Reproduction steps.
- Whether funds, seeds, backup files, tokens, or account identifiers may be at
  risk.

Do not include real seed phrases, private keys, or live credentials in a report.

## Security Review Status

- External audit: not completed.
- Production readiness: not claimed.
- Recommended funds for testing: none or negligible test/disposable amounts.

Before a production release, ZapArc should complete:

- Focused review of seed handling and backup/restore flows.
- Dependency and supply-chain review.
- Native storage and biometric behavior review on iOS and Android.
- Threat-model review for the browser extension.
- End-to-end QA on fresh devices and upgrade paths.
