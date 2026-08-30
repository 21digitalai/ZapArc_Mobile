# Breez SDK Spark 0.22 compatibility

ZapArc Mobile pins `@breeztech/breez-sdk-spark-react-native` exactly to
`0.22.3`.

## Wallet integration

- Wallet creation and recovery use the SDK mnemonic seed and the existing
  per-wallet storage directory.
- Send, receive, payment history, LNURL, HTLC, token-balance and conversion
  paths use the generated 0.22 request, response, enum and error types.
- `getInfo({ ensureSynced: true })` is authoritative for settled BTC balance.
  Because 0.22 does not expose pending totals there, ZapArc derives pending
  send/receive sats from the freshly synced typed payment list. Token base
  units are explicitly excluded from those BTC totals.
- Payment diagnostics capture a fresh native payment and wallet snapshot,
  sanitize sensitive fields, and never export invoices, preimages, seeds,
  private keys or wallet identity.

## Token conversion surface

The BTC/USDB conversion UI is enabled and uses Breez's typed Spark-invoice,
conversion-options, prepare-send and send-payment flow. Other previously
cancelled cross-chain stablecoin UI remains disabled. Runtime guards remain
only where data originates outside the generated SDK contract or must support
older persisted app data.

## Release verification baseline

- dependency and lockfile resolve exactly to `0.22.3`
- `npm run type-check` passes
- payment diagnostics, send/receive, LNURL, HTLC, on-chain and conversion tests pass
- Android release compilation and iOS pod/build validation are required before release
