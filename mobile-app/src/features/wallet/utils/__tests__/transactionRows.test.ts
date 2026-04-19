import { buildTransactionRows } from '../transactionRows';
import type { Transaction } from '../../types';

const base = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx',
  type: 'send',
  amount: 100,
  timestamp: 1000,
  status: 'completed',
  ...overrides,
});

describe('buildTransactionRows', () => {
  it('collapses conversion legs into one swap row', () => {
    const rows = buildTransactionRows([
      base({ id: 'btc-send', type: 'send', amount: 2000, paymentType: 'conversion', asset: 'BTC', timestamp: 1000 }),
      base({ id: 'usdb-recv', type: 'receive', amount: 2, paymentType: 'conversion', asset: 'USDB', timestamp: 1300 }),
    ], 'BTC');

    expect(rows).toHaveLength(1);
    expect(rows[0].isSwap).toBe(true);
    expect(rows[0].swapDirection).toBe('BTC_TO_USDB');
    expect(rows[0].displayType).toBe('send');
  });

  it('keeps direct usdb transfers for USDB tab', () => {
    const rows = buildTransactionRows([
      base({ id: 'usdb-send', type: 'send', amount: 3, paymentType: 'spark', asset: 'USDB' }),
    ], 'USDB');

    expect(rows).toHaveLength(1);
    expect(rows[0].isSwap).toBe(false);
  });
});
