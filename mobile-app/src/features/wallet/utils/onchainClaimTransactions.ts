import type { DepositInfo } from '../../../services/breezSparkService';
import { getDepositClaimErrorInfo } from '../../../services/breezSparkService';
import type { Transaction } from '../types';

export type OnchainClaimState = 'confirming' | 'claiming' | 'retrying' | 'too-small';

const PROVISIONAL_CLAIM_PREFIX = 'onchain-deposit:';
const MISSING_DEPOSIT_GRACE_MS = 5 * 60 * 1000;

export function isProvisionalOnchainClaim(transaction: Transaction): boolean {
  return transaction.isProvisionalClaim === true
    || transaction.id.startsWith(PROVISIONAL_CLAIM_PREFIX);
}

function getClaimKey(transaction: Transaction): string | null {
  if (
    transaction.type !== 'receive'
    || transaction.method !== 'onchain'
    || !transaction.txid
  ) {
    return null;
  }
  return transaction.onchainVout === undefined
    ? transaction.txid
    : `${transaction.txid}:${transaction.onchainVout}`;
}

function provisionalTransaction(
  deposit: DepositInfo,
  previous: Transaction | undefined,
  now: number,
): Transaction {
  const claimInfo = deposit.claimError
    ? getDepositClaimErrorInfo(deposit.claimError, deposit.amountSats)
    : null;
  const claimState: OnchainClaimState = !deposit.isMature
    ? 'confirming'
    : claimInfo?.terminal
      ? 'too-small'
      : claimInfo
        ? 'retrying'
        : 'claiming';
  const statusDetails = !deposit.isMature
    ? 'Waiting for Bitcoin network confirmations. Claiming will start automatically.'
    : claimInfo?.message || 'Claiming this confirmed deposit now.';

  return {
    id: `${PROVISIONAL_CLAIM_PREFIX}${deposit.txid}:${deposit.vout}`,
    type: 'receive',
    amount: deposit.amountSats,
    status: claimState === 'too-small' ? 'failed' : 'pending',
    timestamp: previous?.timestamp || now,
    method: 'onchain',
    txid: deposit.txid,
    onchainVout: deposit.vout,
    onchainClaimState: claimState,
    onchainConfirmations: deposit.confirmations,
    onchainRequiredConfirmations: deposit.requiredConfirmations,
    isProvisionalClaim: true,
    claimLastSeenAt: now,
    failureReason: statusDetails,
    paymentType: 'deposit',
    asset: 'BTC',
    kind: 'payment',
  };
}

/**
 * Merge SDK payments with deposits that do not have a Payment record yet.
 * The SDK payment always wins. This makes a provisional `txid:vout` row get
 * replaced by Breez's full transaction atomically, without a duplicate.
 */
export function mergeOnchainClaimTransactions(
  sdkTransactions: Transaction[],
  deposits: DepositInfo[],
  previousTransactions: Transaction[],
  now = Date.now(),
): Transaction[] {
  const seenRealClaimKeys = new Set<string>();
  const seenRealClaimTxids = new Set<string>();
  const realClaimsWithoutVout = new Set<string>();

  const dedupedSdkTransactions = sdkTransactions.filter((transaction) => {
    const key = getClaimKey(transaction);
    if (!key) return true;
    const txid = transaction.txid as string;
    const hasVout = transaction.onchainVout !== undefined;
    if (
      seenRealClaimKeys.has(key)
      || realClaimsWithoutVout.has(txid)
      || (!hasVout && seenRealClaimTxids.has(txid))
    ) {
      return false;
    }
    seenRealClaimKeys.add(key);
    seenRealClaimTxids.add(txid);
    if (!hasVout) realClaimsWithoutVout.add(txid);
    return true;
  });

  const previousProvisional = new Map(
    previousTransactions
      .filter(isProvisionalOnchainClaim)
      .map((transaction) => [transaction.id, transaction]),
  );

  const currentProvisional = deposits
    .filter((deposit) => (
      !realClaimsWithoutVout.has(deposit.txid)
      && !seenRealClaimKeys.has(`${deposit.txid}:${deposit.vout}`)
    ))
    .map((deposit) => {
      const id = `${PROVISIONAL_CLAIM_PREFIX}${deposit.txid}:${deposit.vout}`;
      return provisionalTransaction(deposit, previousProvisional.get(id), now);
    });
  const currentIds = new Set(currentProvisional.map((transaction) => transaction.id));

  // listUnclaimedDeposits can briefly clear before listPayments exposes the
  // claimed payment. Keep the previous row for a short grace period so the
  // history never flickers empty between those two SDK views.
  const graceRows = Array.from(previousProvisional.values()).filter((transaction) => {
    if (currentIds.has(transaction.id)) return false;
    if (
      transaction.txid
      && (
        realClaimsWithoutVout.has(transaction.txid)
        || seenRealClaimKeys.has(`${transaction.txid}:${transaction.onchainVout}`)
      )
    ) {
      return false;
    }
    return now - (transaction.claimLastSeenAt || transaction.timestamp) <= MISSING_DEPOSIT_GRACE_MS;
  });

  return [...dedupedSdkTransactions, ...currentProvisional, ...graceRows]
    .sort((left, right) => right.timestamp - left.timestamp);
}
