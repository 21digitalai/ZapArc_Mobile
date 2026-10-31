import { getReceiveClaimFixture } from '../receiveClaimFixture';

describe('development receive-claim fixtures', () => {
  it('keeps arbitrary and production LNURL input on the native path', () => {
    expect(getReceiveClaimFixture('lnurl1realproviderinput')).toBeNull();
    expect(getReceiveClaimFixture('zaparc-dev-receive-claim:unknown')).toBeNull();
  });

  it('provides deterministic terminal and pending state fixtures', () => {
    expect(getReceiveClaimFixture('zaparc-dev-receive-claim:completed')).toMatchObject({
      claimResult: { status: 'completed', paymentId: 'dev-fixture-completed' },
      paymentStatus: 'completed',
    });
    expect(getReceiveClaimFixture('zaparc-dev-receive-claim:expired')).toMatchObject({
      claimResult: { status: 'pending', paymentId: 'dev-fixture-expired' },
      paymentStatus: 'failed',
    });
  });
});
