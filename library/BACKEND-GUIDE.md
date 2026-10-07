# ZapArc Mobile — Service and Integration Guide

This is the project rubric for non-UI code in `mobile-app`: wallet and payment services, native SDK adapters, storage, backup, authentication, network integrations, and related configuration. ZapArc Mobile is a React Native client; this guide does not imply that the repository owns a server API or database. Use the Nexus engineering standards alongside this guide. The separate ZapArc browser extension has its own repository and rules.

## Ownership and boundaries

- Keep screens and hooks focused on user interaction and state presentation. Put wallet, payment, persistence, security, and provider behavior behind focused modules in `mobile-app/src/services/` or a feature-owned service when that boundary is clearer.
- Reuse the existing service for a domain instead of adding another adapter to a screen. In particular, `breezSparkService.ts` owns the Breez Spark SDK boundary; `storageService.ts`, `settingsService.ts`, and `securityService.ts` own their respective storage and lock settings; `backupEncryption.ts` owns backup cryptography. Inspect current callers before changing these contracts.
- Model amounts and units explicitly. Do not mix sats, token base units, and fiat display values or use floating-point arithmetic for spendable-balance decisions. Preserve fee-inclusive and insufficient-funds behavior when changing payment estimates.
- Keep native package declarations, generated bindings, and development/production binaries aligned. An SDK or other native dependency change requires a fresh native build and runtime check; a Metro JS reload cannot add a missing native symbol.

## Wallet and data safety

- Never log or send seed phrases, private keys, PINs, backup passwords, tokens, or decrypted backup contents. Error reports and diagnostics must be safe to share without exposing wallet material.
- Treat wallet identity as a scope boundary for cached records, comments, contacts, backups, and settings. Verify that switching or restoring a wallet cannot surface another wallet's data.
- Preserve compatibility with previously created encrypted backups. New fields and formats need explicit version/compatibility behavior and tests for both current and supported legacy data; never silently overwrite or discard a user's only recovery path.
- Keep biometric access opt-in and separate from PIN unlock. Changes to credential storage or wallet unlock must test both paths, cancellation/error paths, and PIN rotation.
- Do not uninstall an existing wallet app, clear app data, or migrate wallet storage as a routine QA step. Use a disposable wallet for destructive or funded-flow tests.

## Integration behavior

- Validate untrusted inputs at the service boundary: payment requests, addresses, amounts, provider responses, backup payloads, and persisted values. Return or throw typed, actionable errors rather than treating malformed input as a successful no-op.
- Preserve the distinction between transient network errors and terminal payment failures. Retries must be bounded and safe for the operation; payment submission must not be repeated merely because a response was lost. Where the SDK offers an idempotency key or status lookup, use it and test the uncertain-result path.
- Keep offline/cache data qualified by freshness and source. Never present a stale balance as a confirmed spendable balance, and do not allow stale estimates to authorize a send.
- Keep public OAuth client identifiers separate from secrets. Production configuration must come from committed public config or the approved secret source as appropriate; do not rely on a developer's gitignored `.env` for a production-required value.
- Changes to native SDK/config plugins, permissions, or generated projects must be verified in a matching Android/iOS build, not only TypeScript or Jest. For Android runtime work, inspect `AndroidRuntime` logcat after launch.

## Verification and review

- Add focused tests for calculations, wallet scoping, compatibility, validation, and failure paths. For service changes, run the relevant focused suite and TypeScript check; run lint for touched files and report unrelated baseline warnings separately.
- For payment, backup, or auth changes, use a disposable fixture/device to verify the visible runtime flow before claiming end-to-end acceptance. Do not equate a passing mock test with a successful payment or recoverable backup.
- In the handoff, name the service contract changed, exact units and security boundaries involved, test results, native build/runtime evidence, and any remaining acceptance gap. Oracle independently reviews the same evidence and current source before approval.

For general code structure, errors, tests, credentials, and file organization, follow `nexus/docs/engineering/CODE_PRINCIPLES.md` and `FILE_PRINCIPLES.md` from the active Nexus workspace. This guide adds ZapArc Mobile-specific boundaries; it does not relax those standards.
