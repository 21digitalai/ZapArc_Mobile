export type OnchainReceiveStatus = 'claimed' | 'too-small' | 'failed';

export interface RecentOnchainReceive {
  key: string;
  txid: string;
  vout: number;
  amountSats: number;
  status: OnchainReceiveStatus;
  timestamp: number;
  failureReason?: string;
}

export const RECENT_ONCHAIN_RECEIVES_KEY = '@zap_arc/recent_onchain_receives_v2';
export const LEGACY_FAILED_CLAIMS_KEY = '@zap_arc/recent_failed_onchain_claims_v1';
export const MAX_RECENT_ONCHAIN_RECEIVES = 5;

function isTerminalReceive(value: unknown): value is RecentOnchainReceive {
  if (!value || typeof value !== 'object') return false;
  const receive = value as Partial<RecentOnchainReceive>;
  return typeof receive.txid === 'string'
    && receive.txid.length > 0
    && Number.isInteger(receive.vout)
    && typeof receive.amountSats === 'number'
    && Number.isFinite(receive.amountSats)
    && (receive.status === 'claimed' || receive.status === 'too-small' || receive.status === 'failed')
    && typeof receive.timestamp === 'number'
    && Number.isFinite(receive.timestamp);
}

export function normalizeRecentOnchainReceives(value: unknown): RecentOnchainReceive[] {
  if (!Array.isArray(value)) return [];

  const unique = new Map<string, RecentOnchainReceive>();
  value.forEach((item) => {
    if (!isTerminalReceive(item)) return;
    const receive = { ...item, key: `${item.txid}:${item.vout}` };
    const existing = unique.get(receive.key);
    if (!existing || receive.timestamp > existing.timestamp) unique.set(receive.key, receive);
  });

  return Array.from(unique.values())
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_RECENT_ONCHAIN_RECEIVES);
}

export function upsertRecentOnchainReceive(
  existing: RecentOnchainReceive[],
  receive: RecentOnchainReceive,
): RecentOnchainReceive[] {
  return normalizeRecentOnchainReceives([receive, ...existing]);
}
