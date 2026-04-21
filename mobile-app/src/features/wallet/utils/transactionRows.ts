import type { Transaction } from '../types';

export type WalletAsset = 'BTC' | 'USDB';

export interface TransactionRow {
  id: string;
  transaction: Transaction;
  isSwap: boolean;
  swapDirection?: 'BTC_TO_USDB' | 'USDB_TO_BTC';
  // When isSwap: both sides of the conversion so the detail view can show
  // "paid X sats, received Y USDB" (or vice versa). Breez emits two Payment
  // records per conversion — buildTransactionRows pairs them here.
  btcSide?: Transaction;
  usdbSide?: Transaction;
  displayType: 'send' | 'receive';
  displayAmount: number;
  displayDescription?: string;
}

const SWAP_PAIR_WINDOW_MS = 2 * 60 * 1000;

function isConversion(tx: Transaction): boolean {
  if (tx.kind === 'swap') return true;
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

    // Preferred path: the SDK payment carries both sides via conversionDetails
    // so a single Transaction already has .kind==='swap' + .swap metadata.
    // Show the swap row under EITHER asset tab (BTC or USDB) so the user can
    // find it in both histories.
    if (tx.kind === 'swap' && tx.swap) {
      used.add(tx.id);
      const direction = tx.swap.direction;
      // In the BTC tab: "send" if user paid BTC (BTC→USDB), else "receive".
      // In the USDB tab: "receive" if user paid BTC (BTC→USDB), else "send".
      const displayType: 'send' | 'receive' = asset === 'BTC'
        ? (direction === 'BTC_TO_USDB' ? 'send' : 'receive')
        : (direction === 'BTC_TO_USDB' ? 'receive' : 'send');
      const displayAmount = asset === 'BTC'
        ? (direction === 'BTC_TO_USDB' ? tx.swap.fromAmount : tx.swap.toAmount)
        : (direction === 'BTC_TO_USDB' ? tx.swap.toAmount : tx.swap.fromAmount);
      // Synthesize virtual "sides" so the detail modal can show both legs
      // in a consistent shape, regardless of which tab the tap came from.
      const btcSide: Transaction = {
        ...tx,
        asset: 'BTC',
        amount: direction === 'BTC_TO_USDB' ? tx.swap.fromAmount : tx.swap.toAmount,
        type: direction === 'BTC_TO_USDB' ? 'send' : 'receive',
      };
      const usdbSide: Transaction = {
        ...tx,
        asset: 'USDB',
        amount: direction === 'BTC_TO_USDB' ? tx.swap.toAmount : tx.swap.fromAmount,
        type: direction === 'BTC_TO_USDB' ? 'receive' : 'send',
      };
      rows.push({
        id: `swap:${tx.id}`,
        transaction: tx,
        isSwap: true,
        swapDirection: direction,
        btcSide,
        usdbSide,
        displayType,
        displayAmount,
        displayDescription: direction === 'BTC_TO_USDB' ? 'BTC → USDB' : 'USDB → BTC',
      });
      continue;
    }

    // Legacy path: two separate Payment records (older SDK or manual
    // split). Pair them up by proximity in time + opposite assets.
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
          btcSide: btcTx,
          usdbSide: usdbTx,
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
