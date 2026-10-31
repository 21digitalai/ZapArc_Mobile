import type { LnurlWithdrawClaim, LnurlWithdrawResult } from './breezSparkService';

export type ReceiveClaimFixtureScenario = 'completed' | 'pending' | 'expired' | 'taken' | 'rejected';

export type ReceiveClaimFixture = {
  claim: LnurlWithdrawClaim;
  claimResult: LnurlWithdrawResult;
  paymentStatus: 'completed' | 'pending' | 'failed';
};

const FIXTURE_PREFIX = 'zaparc-dev-receive-claim:';
const FIXTURE_AMOUNT_SATS = 21;

function fixtureScenario(input: string): ReceiveClaimFixtureScenario | null {
  if (!__DEV__ || !input.startsWith(FIXTURE_PREFIX)) return null;
  const scenario = input.slice(FIXTURE_PREFIX.length) as ReceiveClaimFixtureScenario;
  return ['completed', 'pending', 'expired', 'taken', 'rejected'].includes(scenario) ? scenario : null;
}

/**
 * Controlled development-only fixtures exercise ReceiveClaimScreen without a
 * provider request. Production builds never recognize this private URI scheme.
 */
export function getReceiveClaimFixture(input: string): ReceiveClaimFixture | null {
  const scenario = fixtureScenario(input);
  if (!scenario) return null;

  const claim: LnurlWithdrawClaim = {
    request: {} as LnurlWithdrawClaim['request'],
    minSats: FIXTURE_AMOUNT_SATS,
    maxSats: FIXTURE_AMOUNT_SATS,
    description: 'Development receive-claim fixture',
  };

  if (scenario === 'expired' || scenario === 'taken' || scenario === 'rejected') {
    return {
      claim,
      claimResult: { status: 'pending', paymentId: `dev-fixture-${scenario}` },
      paymentStatus: 'failed',
    };
  }

  return {
    claim,
    claimResult: { status: scenario === 'completed' ? 'completed' : 'pending', paymentId: `dev-fixture-${scenario}` },
    paymentStatus: scenario === 'completed' ? 'completed' : 'pending',
  };
}
