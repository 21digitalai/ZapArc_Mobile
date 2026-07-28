import type { DepositInfo } from '../../../../services/breezSparkService';
import type { Transaction } from '../../types';
import { mergeOnchainClaimTransactions } from '../onchainClaimTransactions';

const deposit = (overrides: Partial<DepositInfo> = {}): DepositInfo => ({
  txid: 'deposit-tx',
  vout: 1,
  amountSats: 25_000,
  isMature: false,
  confirmations: 1,
  requiredConfirmations: 3,
  ...overrides,
});

describe('mergeOnchainClaimTransactions', () => {
  it('adds an immature deposit as a stable confirming transaction', () => {
    const [transaction] = mergeOnchainClaimTransactions([], [deposit()], [], 1_000);

    expect(transaction).toMatchObject({
      id: 'onchain-deposit:deposit-tx:1',
      type: 'receive',
      method: 'onchain',
      txid: 'deposit-tx',
      onchainVout: 1,
      onchainClaimState: 'confirming',
      onchainConfirmations: 1,
      onchainRequiredConfirmations: 3,
      status: 'pending',
      timestamp: 1_000,
    });
  });

  it('preserves the first-seen timestamp while claim state advances', () => {
    const [confirming] = mergeOnchainClaimTransactions([], [deposit()], [], 1_000);
    const [claiming] = mergeOnchainClaimTransactions(
      [],
      [deposit({ isMature: true })],
      [confirming],
      2_000,
    );

    expect(claiming).toMatchObject({
      id: confirming.id,
      timestamp: 1_000,
      onchainClaimState: 'claiming',
    });
  });

  it('replaces the provisional row with the full Breez payment by txid', () => {
    const [provisional] = mergeOnchainClaimTransactions([], [deposit()], [], 1_000);
    const completed: Transaction = {
      id: 'breez-payment-id',
      type: 'receive',
      amount: 24_200,
      feeSats: 800,
      status: 'completed',
      timestamp: 3_000,
      method: 'onchain',
      txid: 'deposit-tx',
      onchainVout: 1,
    };

    const merged = mergeOnchainClaimTransactions(
      [completed],
      [deposit({ isMature: true })],
      [provisional],
      3_000,
    );

    expect(merged).toEqual([completed]);
  });

  it('deduplicates repeated Breez claim payments for the same txid:vout', () => {
    const first: Transaction = {
      id: 'first',
      type: 'receive',
      amount: 25_000,
      status: 'completed',
      timestamp: 3_000,
      method: 'onchain',
      txid: 'deposit-tx',
      onchainVout: 1,
    };
    const duplicate = { ...first, id: 'duplicate', timestamp: 2_000 };

    expect(mergeOnchainClaimTransactions([first, duplicate], [], [], 3_000))
      .toEqual([first]);
  });

  it('keeps distinct outputs from the same Bitcoin transaction', () => {
    const first: Transaction = {
      id: 'first',
      type: 'receive',
      amount: 25_000,
      status: 'completed',
      timestamp: 3_000,
      method: 'onchain',
      txid: 'shared-tx',
      onchainVout: 1,
    };
    const second = { ...first, id: 'second', onchainVout: 2 };

    expect(mergeOnchainClaimTransactions([first, second], [], [], 3_000))
      .toEqual([first, second]);
  });
});
