# T15 QA Evidence Log

Updated: 2026-04-20 (Europe/Sofia)

## Scope
- Ticket: #765 (Swap: E2E QA + a11y audit)
- Platforms: iOS simulator, Android emulator
- Acceptance source: `.kiro/specs/btc-usdb-swap/tasks.md` (T15)

## Automated Verification (completed)
- `npm run type-check` ✅
- Targeted swap suites ✅
  - `src/features/wallet/screens/__tests__/SwapScreen.integration.test.tsx`
  - `src/features/wallet/components/__tests__/SwapResultView.test.tsx`
  - `src/features/wallet/components/__tests__/SwapRateLine.test.tsx`
  - `src/features/wallet/components/__tests__/SwapReviewModal.test.tsx`
  - `src/features/wallet/components/__tests__/SwapAmountCard.test.tsx`
- Android runtime smoke ✅
  - launch via `adb shell monkey`
  - `adb logcat -d -s AndroidRuntime` shows no app crash signal
- iOS runtime smoke ✅
  - simulator build/install succeeds
  - screenshot capture succeeds

## T15 12-state matrix (evidence status)
1. Idle — **covered by integration tests**
2. Typing — **covered by integration tests**
3. Quote Loaded — **covered by integration tests**
4. Quote Refreshing — **covered by integration tests**
5. Insufficient Balance — **covered by integration tests**
6. Below-min / Above-max — **covered by integration tests**
7. Review Modal — **covered by integration tests**
8. Confirming — **covered by integration tests**
9. Success — **covered by component/integration tests**
10. Dust Residual — **covered by result view tests**
11. Refunded — **covered by result view tests**
12. Network/Pool Error — **covered by integration tests**

## Accessibility matrix (remaining manual pass)
Required by T15:
- VoiceOver (iOS) and TalkBack (Android) announcements
- Dynamic error announcements
- "Loading quote" shimmer announcement

Current status:
- Accessibility properties were implemented and test expectations were updated in prior commits.
- TalkBack is enabled on Android emulator and app runtime is stable, but spoken announcement capture is not exposed via our current CLI-only automation path.
- VoiceOver spoken output capture is likewise not available from the current simulator automation surface.
- **Manual AT walkthrough evidence is still pending** (explicit per-state VoiceOver/TalkBack readout capture).

## 2026-04-20 run update
- Re-validated acceptance source and current evidence coverage.
- Confirmed this is now a tooling/procedure gap, not an implementation gap:
  - we can verify labels/roles/live regions in code/tests,
  - we can verify runtime stability on both platforms,
  - but we cannot produce authoritative spoken-output transcripts via the current non-interactive cron toolchain.
- Action needed: overseer decision on close criteria for T15
  1) accept automation-backed a11y evidence + oracle review, or
  2) require a manual human AT pass on device/simulator with operator-supplied evidence.

## Next
- Run explicit manual VoiceOver + TalkBack per-state checklist and append pass/fail evidence here.
- On completion, link this file in ticket #765 completion note and hand off to oracle.
