# ZapArc OpenSats Grant Roadmap

This roadmap frames a modest 3-6 month General Grant scope for ZapArc Mobile
and the companion browser extension. The goal is not a forever-funding request;
it is a focused push to turn existing proof-of-work into safer, clearer, public
FOSS infrastructure for self-custodial Bitcoin use.

## Grant Thesis

ZapArc helps Bitcoin users by making self-custodial Lightning payments,
recovery, and wallet security approachable across mobile and browser contexts.
OpenSats support would fund hardening, documentation, demos, and release
readiness so reviewers and contributors can evaluate the project openly.

## OpenSats Criteria Mapping

- Bitcoin impact: improves everyday self-custodial Bitcoin wallet UX.
- FOSS value: keeps implementation, docs, security model, and roadmap public.
- Feasibility: builds on an existing React Native app, Breez SDK Spark
  integration work, and a companion browser-extension codebase.
- Transparency: publishes alpha status, threat model, demo script, known
  limitations, and 90-day progress updates.
- Education: documents wallet architecture, custody boundaries, backup model,
  and demo/reproduction steps.

## Month 1: Public FOSS Cleanup

Deliverables:

- Rewrite public README around ZapArc rather than generic app skeleton copy.
- Publish security model and alpha disclaimer.
- Publish OpenSats demo package and capture checklist.
- Remove or clearly label stale docs that imply unrelated backend/skeleton
  functionality.
- Confirm license, setup commands, and contribution path are visible.

Evidence:

- README and docs are reviewable from the repository root.
- A reviewer can understand the project, status, and safety posture in minutes.

## Month 2: Mobile Wallet Hardening

Deliverables:

- Review wallet creation/import flow for seed display and storage mistakes.
- Review PIN, biometric unlock, lockout, and auto-lock behavior on iOS and
  Android.
- Harden backup/restore UX around backup-password implications.
- Add focused tests around wallet storage, mnemonic validation, backup
  encryption, and recovery error handling.
- Verify public demo flows avoid private data exposure.

Evidence:

- Test results and QA notes for seed, backup, restore, and unlock flows.
- Updated security documentation for any changed model.

## Month 3: Bitcoin And Stablecoin Payment Interoperability

Deliverables:

- Production-harden native BTC/USDB swaps and USDB send/receive flows on Spark.
- Add dollar withdrawals through Breez SDK cross-chain routes so users can pay
  supported external USDT/USDC addresses from BTC or USDB.
- Add stablecoin deposits that convert incoming USDT/USDC into BTC or USDB when
  Breez exposes a complete production-ready cross-chain receive flow.
- Support the funding use case explicitly: deposit dollars from a supported
  external chain and receive spendable sats without maintaining a custodial
  stablecoin account.
- Build clear quote, fee, slippage, expiry, pending, refund, and recovery states
  for every conversion path.
- Keep stablecoin capabilities self-custodial, feature-flagged, and routed
  through Breez SDK rather than integrating bridge providers directly.
- Document how the app initializes and uses Breez SDK Spark, including
  send/receive/sync flows, error modes, custody boundaries, and where each
  conversion occurs.
- Clearly distinguish shipped flows, upstream-dependent receive work, and
  prototype code so the roadmap does not promise unavailable network support.

Evidence:

- Reproducible tests and small-value mainnet QA for every enabled route.
- Developer docs that explain key services, feature flags, providers, custody
  boundaries, and failure recovery.
- A sanitized demo showing BTC/USDB funding an external dollar payment and,
  when supported upstream, an external stablecoin deposit funding BTC/USDB.
- Published evidence for any upstream-blocked route instead of simulated or
  overstated functionality.

## Month 4: Browser Extension Hardening

Deliverables:

- Review the companion extension repo as a separate trust boundary.
- Document extension permissions, signing/payment flow, and website interaction
  model.
- Align extension README/security docs with the mobile repo's custody language.
- Capture extension demo assets for the combined ZapArc narrative.

Evidence:

- Extension docs and demo asset linked from the mobile OpenSats package.
- Clear separation between mobile storage guarantees and extension risks.

## Month 5: QA And Release Readiness

Deliverables:

- Run fresh-device install tests on iOS and Android.
- Run upgrade-path tests from existing wallet state.
- Verify backup/restore on clean devices.
- Verify notification and Lightning Address configuration in a staging setup.
- Verify enabled BTC/USDB swaps, stablecoin withdrawals, deposit conversion,
  quote expiry, pending settlement, and refund/recovery behavior using
  controlled small-value mainnet transactions.
- Produce the final 2:30-3:00 public proof-of-work demo video.

Evidence:

- QA checklist with pass/fail status and unresolved blockers.
- Final public demo media under the documented asset paths.

## Month 6: Public Reporting And Grant Closeout

Deliverables:

- Publish a concise 90-day progress report.
- Publish follow-up issues for remaining security, QA, and release blockers.
- Update roadmap with what was completed, deferred, and learned.
- Prepare a release-candidate checklist if the app is ready for broader testing.

Evidence:

- Dated progress report.
- Public issue/ticket list for remaining work.
- Updated README/security docs matching the actual state.

## 90-Day Progress Reporting Plan

Every 30 days:

- Summarize shipped commits and docs.
- List completed QA/security checks.
- List unresolved blockers and why they remain.
- State whether the app is still alpha, beta-ready, or release-candidate ready.
- Include screenshots or demo clips only if they are sanitized.

At 90 days:

- Publish a grant progress report that maps work back to this roadmap.
- Include links to README, security docs, demo package, and QA evidence.
- Identify the next funding-independent milestones.

## Out Of Scope For This Grant

- Custody services or hosted wallets.
- Exchange licensing, KYC/AML operations, or centralized exchange brokerage.
- Claims of audited production security without an external audit.
- Generic token trading or speculative multi-asset expansion unrelated to
  Bitcoin payment utility.
- Native USDT/USDC wallet balances or in-wallet BTC/USDT and BTC/USDC pools
  unless the required Spark tokens and live liquidity actually exist.
- Closed-source security-through-obscurity rewrites.

## Risks

- Mobile wallet security is difficult; hardening may uncover release blockers.
- App-store review may require region, feature, or policy changes.
- Breez/Spark upstream behavior or APIs may change during implementation.
- Cross-chain stablecoin receive may remain unavailable until Breez exposes a
  complete production-ready receive path.
- Cross-chain routes are mainnet-only and require careful small-value testing,
  quote-expiry handling, and refund/recovery verification.
- Browser-extension risk may require more review than the mobile app.
- Public demos can accidentally leak sensitive state if capture discipline is
  weak.

## Mitigations

- Keep alpha disclaimers visible until security posture improves.
- Keep swap/multi-asset feature flags conservative for release builds.
- Treat USDB swaps, external stablecoin withdrawals, and inbound stablecoin
  funding as separate capabilities with separate release gates.
- Ship inbound USDT/USDC funding only after the SDK route is production-ready;
  publish the upstream blocker when it is not.
- Use throwaway wallets and sanitized devices for every public asset.
- Treat mobile and extension security reviews as separate workstreams.
- Publish progress and blockers instead of hiding uncertainty.
