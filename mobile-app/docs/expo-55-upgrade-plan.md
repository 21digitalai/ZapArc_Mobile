# Expo 55 Major Upgrade Plan (Security High Remediation)

## Context
- Ticket: #677 (child of #675)
- Current production audit (`npm audit --omit=dev --json`): `high=18`, `moderate=2`, `critical=0`
- Most high vulnerabilities are in Expo 52 transitive chain (`@expo/cli`, `@expo/config*`, `@expo/plist`, `tar`, `cacache`).
- `npm audit` fix path points to `expo@55.0.15` (major upgrade).

## Goal
Upgrade from Expo 52 to Expo 55 in a controlled way that removes the Expo-chain high vulnerabilities without bundling unrelated feature work.

## Scope
- In scope:
  - Expo SDK major upgrade path to 55
  - Required React Native/React alignment for Expo 55
  - Re-alignment of Expo packages used in app (`expo-auth-session`, `expo-notifications`, `expo-dev-client`)
  - Build + runtime validation on Android
  - Post-upgrade security audit evidence
- Out of scope:
  - New product features
  - Refactors unrelated to upgrade compatibility

## Execution Phases

### Phase 1: Baseline + branch isolation
1. Create dedicated upgrade branch.
2. Capture baseline evidence:
   - `npm ls expo`
   - `npm audit --omit=dev --json` (store summary in ticket note)
   - `npm run type-check`
3. Freeze non-upgrade changes for this branch.

### Phase 2: Expo 55 migration
1. Follow Expo official SDK upgrade guide for 52 → 53 → 54 → 55 compatibility deltas.
2. Update core packages:
   - `expo`
   - `react`
   - `react-native`
   - `expo-dev-client`
   - `expo-auth-session`
   - `expo-notifications`
3. Regenerate lockfile and resolve peer dependency conflicts.
4. Run `npx expo install --check` and reconcile mismatches.

### Phase 3: Code and config compatibility
1. Update `app.json`/plugin config for SDK 55 requirements.
2. Resolve API/deprecation breakages in app code.
3. Rebuild native projects if required (`expo prebuild` only if needed by current workflow).

### Phase 4: Validation gates (must pass)
1. `npm run type-check`
2. `npm run lint` (if configured)
3. Android build path:
   - build/install debug app
   - launch app
   - check runtime crashes: `adb logcat -d -s AndroidRuntime | tail -30`
4. Smoke test critical flows:
   - app launch
   - auth flow
   - notifications permission/registration path
5. Security re-check:
   - `npm audit --omit=dev --json`
   - attach before/after high/critical summary to ticket note

## Exit Criteria
- Expo 55 upgrade committed and pushed in isolated diff.
- Type-check passes.
- Android runtime crash check is clean for launch flow.
- `npm audit --omit=dev` shows reduction/removal of Expo-chain high vulnerabilities (or explicit residual risk with owner).

## Risks and Mitigations
- Risk: broad dependency churn causes regressions.
  - Mitigation: isolate upgrade branch + strict validation gates.
- Risk: native/runtime break after compile success.
  - Mitigation: mandatory Android runtime logcat check.
- Risk: unresolved transitive findings remain.
  - Mitigation: document exact residual package path and create follow-up ticket with owner.

## Recommended Follow-up Ticket Split
1. Builder implementation ticket: execute Phase 1–4.
2. Oracle review ticket: verify remote diff scope + rerun audit and runtime checks.
3. If residual vulnerabilities remain: child ticket per unresolved dependency chain.
