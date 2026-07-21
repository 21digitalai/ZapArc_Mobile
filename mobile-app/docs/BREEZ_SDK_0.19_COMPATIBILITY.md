# Breez SDK Spark 0.19 compatibility

ZapArc Mobile pins `@breeztech/breez-sdk-spark-react-native` to `0.19.0`.

## Existing wallet initialization

The wallet continues to use the SDK's built-in mnemonic connection:

- `BreezSDK.connect({ config, seed, storageDir })`
- the existing local storage directory and session behavior
- no external signer, signing-only signer, or Turnkey configuration

The 0.19 type surface retains this connection path, so the current Bitcoin and
Lightning wallet initialization does not require an integration change.

## New 0.19 APIs intentionally not adopted

Version 0.19 adds client-side signed transfer/LNURL package APIs and expands
session-store and Turnkey signer options. ZapArc does not use them because the
app's current wallet flow signs through the SDK's built-in mnemonic path.

This upgrade does not enable external signing, Turnkey, token transfers,
stablecoin UI, or swap UI. `SWAP_FEATURE_ENABLED` and
`MULTI_ASSET_UI_ENABLED` remain `false`.

## Verification baseline

- dependency and lockfile resolve to exactly `0.19.0`
- `npm run type-check` passes
- Breez send, receive, and on-chain service tests pass
- Android release compilation remains required before release
