import type { Transaction } from '../types';

export type WalletAsset = 'BTC' | 'USDB';

export interface TransactionRow {
  id: string;
  transaction: Transaction;
  isSwap: boolean;
  swapDirection?: 'BTC_TO_USDB' | 'USDB_TO_BTC';
  displayType: 'send' | 'receive';
  displayAmount: number;
  displayDescription?: string;
}

const SWAP_PAIR_WINDOW_MS = 2 * 60 * 1000;

function isConversion(tx: Transaction): boolean {
  return String(tx.paymentType || '').toLowerCase() === 'conversion';
}

function txAsset(tx: Transaction): WalletAsset {
  return tx.asset === 'USDB' ? 'USDB' : 'BTC';
}

function defaultInclude(tx: Transaction, asset: WalletAsset): boolean {
  if (asset === 'BTC') return txAsset(tx) === 'BTC';
  const paymentType = String(tx.paymentType || '').toLowerCase();
  return txAsset(tx) === 'USDB' || paymentType === 'spark';
}

export function buildTransactionRows(transactions: Transaction[], asset: WalletAsset): TransactionRow[] {
  const rows: TransactionRow[] = [];
  const used = new Set<string>();

  for (let i = 0; i < transactions.length; i += 1) {
    const tx = transactions[i];
    if (used.has(tx.id)) continue;

    if (isConversion(tx)) {
      let pair: Transaction | undefined;
      for (let j = i + 1; j < transactions.length; j += 1) {
        const other = transactions[j];
        if (used.has(other.id) || !isConversion(other)) continue;
        if (txAsset(other) === txAsset(tx)) continue;
        if (Math.abs((other.timestamp || 0) - (tx.timestamp || 0)) > SWAP_PAIR_WINDOW_MS) continue;
        pair = other;
        break;
      }

      if (pair) {
        used.add(tx.id);
        used.add(pair.id);

        const btcTx = txAsset(tx) === 'BTC' ? tx : pair;
        const usdbTx = txAsset(tx) === 'USDB' ? tx : pair;

        const direction = btcTx.type === 'send' ? 'BTC_TO_USDB' : 'USDB_TO_BTC';
        const displayTx = asset === 'BTC' ? btcTx : usdbTx;
        const displayType = direction === 'BTC_TO_USDB'
          ? (asset === 'BTC' ? 'send' : 'receive')
          : (asset === 'BTC' ? 'receive' : 'send');

        rows.push({
          id: `swap:${btcTx.id}:${usdbTx.id}`,
          transaction: displayTx,
          isSwap: true,
          swapDirection: direction,
          displayType,
          displayAmount: displayTx.amount,
          displayDescription: direction === 'BTC_TO_USDB' ? 'BTC → USDB' : 'USDB → BTC',
        });
        continue;
      }
    }

    if (!defaultInclude(tx, asset)) continue;

    rows.push({
      id: tx.id,
      transaction: tx,
      isSwap: false,
      displayType: tx.type,
      displayAmount: tx.amount,
      displayDescription: tx.description,
    });
  }

  return rows;
}
