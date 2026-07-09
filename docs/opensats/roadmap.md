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

## Month 3: Breez/Spark Integration Documentation

Deliverables:

- Document how the app initializes and uses Breez SDK Spark.
- Document receive/send/sync flows and error modes.
- Document current BTC/USDB prototype status and release gating.
- Clarify what is user-facing in release builds versus present as prototype
  code.

Evidence:

- Developer docs that explain key services and feature flags.
- Demo notes that do not overstate disabled swap functionality.

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
- Large speculative token expansion beyond documented Bitcoin/Spark work.
- Closed-source security-through-obscurity rewrites.

## Risks

- Mobile wallet security is difficult; hardening may uncover release blockers.
- App-store review may require region, feature, or policy changes.
- Breez/Spark upstream behavior or APIs may change during implementation.
- Browser-extension risk may require more review than the mobile app.
- Public demos can accidentally leak sensitive state if capture discipline is
  weak.

## Mitigations

- Keep alpha disclaimers visible until security posture improves.
- Keep swap/multi-asset feature flags conservative for release builds.
- Use throwaway wallets and sanitized devices for every public asset.
- Treat mobile and extension security reviews as separate workstreams.
- Publish progress and blockers instead of hiding uncertainty.
