import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@zaparc/payment_diagnostics_v1';
export const DIAGNOSTIC_MAX_ENTRIES = 30;
export const DIAGNOSTIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ReconciliationCode =
  | 'funds_reserved_until_expiry' | 'overdue_stuck_reconciliation'
  | 'settling_or_claimable' | 'funds_returned' | 'balance_sync_inconsistency'
  | 'failed_but_funds_still_reserved' | 'unknown';

export interface PaymentDiagnostic {
  paymentId: string;
  createdAt: string;
  events: Array<{ at: string; stage: string; detail?: string }>;
}

const SENSITIVE = /(seed|mnemonic|private.?key|preimage|proof|invoice|bolt11|lnurl|lightning.?address|recipient|pubkey|description|comment|api.?key|token)/i;

/** Keep only deterministic, non-sensitive support evidence. */
export function sanitizeDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || SENSITIVE.test(trimmed)) return undefined;
  return trimmed.slice(0, 240);
}

export function classifyReconciliation(input: {
  htlcStatus?: string;
  htlcExpiryMs?: number;
  paymentStatus?: string;
  synced?: boolean;
  pendingSendSats?: number;
  balanceBeforeSats?: number;
  balanceAfterSats?: number;
}): ReconciliationCode {
  const status = (input.htlcStatus || '').toLowerCase();
  if (status === 'waitingforpreimage' || status === 'waiting_for_preimage') {
    return input.htlcExpiryMs && input.htlcExpiryMs > Date.now()
      ? 'funds_reserved_until_expiry' : 'overdue_stuck_reconciliation';
  }
  if (status === 'preimageshared' || status === 'preimage_shared') return 'settling_or_claimable';
  if (status === 'returned') {
    return input.synced && !input.pendingSendSats
      ? 'funds_returned' : 'balance_sync_inconsistency';
  }
  if ((input.paymentStatus || '').toLowerCase() === 'failed' && input.pendingSendSats) {
    return 'failed_but_funds_still_reserved';
  }
  return 'unknown';
}

function prune(entries: PaymentDiagnostic[], now = Date.now()): PaymentDiagnostic[] {
  return entries.filter((entry) => now - Date.parse(entry.createdAt) <= DIAGNOSTIC_MAX_AGE_MS)
    .slice(-DIAGNOSTIC_MAX_ENTRIES);
}

export async function recordPaymentDiagnostic(paymentId: string, stage: string, detail?: unknown): Promise<void> {
  if (!paymentId) return;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const entries: PaymentDiagnostic[] = raw ? JSON.parse(raw) : [];
  const safeDetail = sanitizeDiagnosticValue(detail);
  const at = new Date().toISOString();
  const entry = entries.find((item) => item.paymentId === paymentId);
  if (entry) entry.events.push({ at, stage, ...(safeDetail ? { detail: safeDetail } : {}) });
  else entries.push({ paymentId, createdAt: at, events: [{ at, stage, ...(safeDetail ? { detail: safeDetail } : {}) }] });
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prune(entries)));
}

export async function getPaymentDiagnostic(paymentId: string): Promise<PaymentDiagnostic | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const entries: PaymentDiagnostic[] = raw ? JSON.parse(raw) : [];
  const retained = prune(entries);
  if (retained.length !== entries.length) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
  return retained.find((item) => item.paymentId === paymentId) || null;
}
