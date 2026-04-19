# BTC ⇄ USDB spike results (ticket #679)

## Run timestamp
- 2026-04-19 (EEST)

## Current result
- Spike harness code has been implemented and wired behind a hidden `__DEV__` long-press on the Home wallet selector.
- Full empirical run is still pending because the new emulator image does not have an initialized/funded wallet state for a real Spark send/refund path.

## What is implemented
1. `src/devtools/swapSpike.ts`
   - Attempts USDB identifier discovery via `getInfo`, `fetchConversionLimits`, `getTokenIssuer`.
   - Attempts self-receive + `prepareSendPayment` with 1 bps slippage + `sendPayment` with resolved/thrown shape logging.
2. Hidden trigger in `HomeScreen`
   - Long-press wallet selector (dev build only) runs the spike and surfaces status via snackbar.
3. Dev-only SDK handle export
   - `getRawSdkInstanceForDevtools()` in `breezSparkService`.

## Pending empirical outputs
- Concrete USDB token identifier value from live SDK data.
- Which branch is correct in production behavior:
  - thrown error variant, or
  - resolved payment payload with refund marker.
- Updated `design.md` §5.3 with only the empirically correct branch.

## Next run plan
1. Use a connected dev wallet with sufficient sats.
2. Trigger spike from Home (long-press wallet selector).
3. Copy console output into this file.
4. Update `design.md` §5.3 to remove the incorrect branch.
