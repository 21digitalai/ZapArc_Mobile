import {
  MAX_RECENT_ONCHAIN_RECEIVES,
  normalizeRecentOnchainReceives,
  upsertRecentOnchainReceive,
} from '../recentOnchainReceives';

const receive = (txid: string, vout: number, timestamp: number, status: 'claimed' | 'too-small' | 'failed' = 'claimed') => ({
  key: `ignored:${vout}`,
  txid,
  vout,
  amountSats: 1234,
  status,
  timestamp,
});

describe('recent on-chain receives', () => {
  it('keeps the five newest terminal receives, newest first', () => {
    const entries = Array.from({ length: 6 }, (_, index) => receive(`tx-${index}`, 0, index));
    expect(normalizeRecentOnchainReceives(entries).map((item) => item.txid)).toEqual([
      'tx-5', 'tx-4', 'tx-3', 'tx-2', 'tx-1',
    ]);
    expect(normalizeRecentOnchainReceives(entries)).toHaveLength(MAX_RECENT_ONCHAIN_RECEIVES);
  });

  it('deduplicates by txid:vout and retains the newer terminal state', () => {
    const history = normalizeRecentOnchainReceives([
      receive('same', 1, 10, 'failed'),
      receive('same', 1, 20, 'claimed'),
    ]);
    expect(history).toEqual([expect.objectContaining({ key: 'same:1', status: 'claimed', timestamp: 20 })]);
  });

  it('upserts a terminal receive without losing prior failed-claim history', () => {
    const history = upsertRecentOnchainReceive(
      [receive('legacy-failure', 0, 10, 'failed')],
      receive('new-claim', 0, 20, 'claimed'),
    );
    expect(history.map((item) => item.txid)).toEqual(['new-claim', 'legacy-failure']);
  });
});
