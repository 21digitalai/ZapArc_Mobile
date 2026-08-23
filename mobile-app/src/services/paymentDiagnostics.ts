import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@zaparc/payment_diagnostics_v1';
export const DIAGNOSTIC_MAX_ENTRIES = 30;
export const DIAGNOSTIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The complete persisted journal stays deliberately small even with long error text. */
export const DIAGNOSTIC_MAX_BYTES = 12_000;
export const DIAGNOSTIC_LOG_RING_MAX_ENTRIES = 20;

export interface SanitizedSdkLog {
  at: string;
  level: string;
  /** A derived category, never a raw SDK log line. */
  event: 'sdk_connected' | 'sdk_disconnected' | 'wallet_sync' | 'payment_update' | 'htlc_update';
}

export interface SanitizedSdkLogSummary extends SanitizedSdkLog {
  count: number;
  lastAt: string;
}

const sdkLogRing: SanitizedSdkLog[] = [];

export type ReconciliationCode =
  | 'funds_reserved_until_expiry' | 'overdue_stuck_reconciliation'
  | 'settling_or_claimable' | 'funds_returned' | 'balance_sync_inconsistency'
  | 'failed_but_funds_still_reserved' | 'unknown';

export interface PaymentDiagnostic {
  paymentId: string;
  createdAt: string;
  events: Array<{
    at: string;
    stage: string;
    detail?: string;
    balanceSats?: number;
    pendingSendSats?: number;
    pendingReceiveSats?: number;
    htlcStatus?: string;
    htlcExpiryMs?: number;
  }>;
}

export interface PaymentDiagnosticsExport {
  schemaVersion: 1;
  generatedAt: string;
  reconciliation: ReconciliationCode;
  sync: { attempted: boolean; succeeded: boolean; failure?: string };
  /** Individual source failures keep partial exports honest and actionable. */
  sourceFailures?: { payment?: string; paymentFallback?: string; wallet?: string };
  app: { name: string; version: string; sdkVersion: string; platform: string };
  payment: { id: string; status?: string; direction?: string; amountSats?: number; feeSats?: number; timestamp?: number; paymentHash?: string; htlcStatus?: string; htlcExpiryMs?: number };
  wallet: { balanceSats?: number; pendingSendSats?: number; pendingReceiveSats?: number; authoritative: boolean };
  timeline: PaymentDiagnostic['events'];
  /** Repeated derived SDK categories are collapsed to keep exports readable. */
  relevantLogs: SanitizedSdkLogSummary[];
}

const SENSITIVE = /(seed|mnemonic|private.?key|preimage|proof|invoice|bolt11|lnurl|lightning.?address|recipient|pubkey|description|comment|api.?key|token)/i;

/** Keep only deterministic, non-sensitive support evidence. */
export function sanitizeDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || SENSITIVE.test(trimmed)) return undefined;
  return trimmed.slice(0, 240);
}

/**
 * SDK log lines can contain payment requests and wallet data. Keep only a
 * deterministic category from an explicitly safe operational vocabulary.
 */
export function recordSanitizedSdkLog(level: unknown, line: unknown): void {
  if (typeof line !== 'string' || SENSITIVE.test(line)) return;
  const normalized = line.toLowerCase();
  let event: SanitizedSdkLog['event'] | undefined;
  if (/\bdisconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_disconnected';
  else if (/\bconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_connected';
  else if (/\bsync(?:ed|ing)?\b/.test(normalized)) event = 'wallet_sync';
  else if (/\bhtlc\b/.test(normalized)) event = 'htlc_update';
  else if (/\bpayment\b/.test(normalized)) event = 'payment_update';
  if (!event) return;
  sdkLogRing.push({
    at: new Date().toISOString(),
    level: typeof level === 'string' && /^(trace|debug|info|warn|warning|error)$/i.test(level) ? level.toLowerCase() : 'info',
    event,
  });
  if (sdkLogRing.length > DIAGNOSTIC_LOG_RING_MAX_ENTRIES) sdkLogRing.splice(0, sdkLogRing.length - DIAGNOSTIC_LOG_RING_MAX_ENTRIES);
}

export function getSanitizedSdkLogs(): SanitizedSdkLog[] {
  return sdkLogRing.map((entry) => ({ ...entry }));
}

/**
 * Raw Breez lines are intentionally never retained. Collapse the safe derived
 * categories so a retry loop does not produce dozens of identical rows.
 */
export function summarizeSanitizedSdkLogs(logs = getSanitizedSdkLogs()): SanitizedSdkLogSummary[] {
  const summaries = new Map<string, SanitizedSdkLogSummary>();
  for (const log of logs) {
    const key = `${log.level}:${log.event}`;
    const existing = summaries.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = log.at;
    } else {
      summaries.set(key, { ...log, count: 1, lastAt: log.at });
    }
  }
  return [...summaries.values()];
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
  const rawStatus = input.htlcStatus || '';
  const status = rawStatus.toLowerCase();
  // SparkHtlcStatus is a numeric enum in the installed RN SDK.
  const waitingForPreimage = status === 'waitingforpreimage' || status === 'waiting_for_preimage' || rawStatus === '0';
  const preimageShared = status === 'preimageshared' || status === 'preimage_shared' || rawStatus === '1';
  const returned = status === 'returned' || rawStatus === '2';
  if (waitingForPreimage) {
    return input.htlcExpiryMs && input.htlcExpiryMs > Date.now()
      ? 'funds_reserved_until_expiry' : 'overdue_stuck_reconciliation';
  }
  if (preimageShared) return 'settling_or_claimable';
  if (returned) {
    const balanceReduced = input.balanceBeforeSats !== undefined && input.balanceAfterSats !== undefined
      && input.balanceAfterSats < input.balanceBeforeSats;
    return input.synced && !input.pendingSendSats && !balanceReduced
      ? 'funds_returned' : 'balance_sync_inconsistency';
  }
  if ((input.paymentStatus || '').toLowerCase() === 'failed' && input.pendingSendSats) {
    return 'failed_but_funds_still_reserved';
  }
  return 'unknown';
}

export function prunePaymentDiagnostics(entries: PaymentDiagnostic[], now = Date.now()): PaymentDiagnostic[] {
  const retained = entries.filter((entry) => now - Date.parse(entry.createdAt) <= DIAGNOSTIC_MAX_AGE_MS)
    .slice(-DIAGNOSTIC_MAX_ENTRIES)
    .map((entry) => ({ ...entry, events: entry.events.slice(-20) }));
  while (JSON.stringify(retained).length > DIAGNOSTIC_MAX_BYTES) {
    const oldestWithEvents = retained.find((entry) => entry.events.length > 1);
    if (oldestWithEvents) oldestWithEvents.events.shift();
    else if (retained.length > 1) retained.shift();
    else break;
  }
  return retained;
}

export async function recordPaymentDiagnostic(paymentId: string, stage: string, detail?: unknown): Promise<void> {
  if (!paymentId) return;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const entries: PaymentDiagnostic[] = raw ? JSON.parse(raw) : [];
  const at = new Date().toISOString();
  const input = detail && typeof detail === 'object' ? detail as Record<string, unknown> : { detail };
  const safeDetail = sanitizeDiagnosticValue(input.detail);
  const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const safeHtlcStatus = typeof input.htlcStatus === 'string' && /^(0|1|2|WaitingForPreimage|PreimageShared|Returned)$/.test(input.htlcStatus)
    ? input.htlcStatus : undefined;
  const event = {
    at,
    stage,
    ...(safeDetail ? { detail: safeDetail } : {}),
    ...(finite(input.balanceSats) !== undefined ? { balanceSats: finite(input.balanceSats) } : {}),
    ...(finite(input.pendingSendSats) !== undefined ? { pendingSendSats: finite(input.pendingSendSats) } : {}),
    ...(finite(input.pendingReceiveSats) !== undefined ? { pendingReceiveSats: finite(input.pendingReceiveSats) } : {}),
    ...(safeHtlcStatus ? { htlcStatus: safeHtlcStatus } : {}),
    ...(finite(input.htlcExpiryMs) !== undefined ? { htlcExpiryMs: finite(input.htlcExpiryMs) } : {}),
  };
  const entry = entries.find((item) => item.paymentId === paymentId);
  if (entry) entry.events.push(event);
  else entries.push({ paymentId, createdAt: at, events: [event] });
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prunePaymentDiagnostics(entries)));
}

export async function getPaymentDiagnostic(paymentId: string): Promise<PaymentDiagnostic | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const entries: PaymentDiagnostic[] = raw ? JSON.parse(raw) : [];
  const retained = prunePaymentDiagnostics(entries);
  if (retained.length !== entries.length) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
  return retained.find((item) => item.paymentId === paymentId) || null;
}

/** Return one allowlisted historical balance snapshot for reconciliation only. */
export async function getPaymentDiagnosticBalance(paymentId: string, stage: string): Promise<number | undefined> {
  const journal = await getPaymentDiagnostic(paymentId);
  const event = journal?.events.find((candidate) => candidate.stage === stage);
  return event?.balanceSats;
}

/** Build a deliberately small, user-reviewable support payload. */
export async function buildPaymentDiagnosticsExport(input: Omit<PaymentDiagnosticsExport, 'schemaVersion' | 'generatedAt' | 'timeline' | 'relevantLogs' | 'app'> & { app?: PaymentDiagnosticsExport['app'] }): Promise<string> {
  const journal = await getPaymentDiagnostic(input.payment.id);
  // The export event repeats the top-level sync/wallet/HTLC snapshot and adds
  // no historical evidence, so keep it persisted but omit it from copied JSON.
  const timeline = (journal?.events || []).filter((event) => !event.stage.startsWith('export_'));
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...input,
    app: input.app || { name: 'ZapArc Mobile', version: 'unknown', sdkVersion: 'unknown', platform: 'unknown' },
    timeline,
    relevantLogs: summarizeSanitizedSdkLogs(),
  } satisfies PaymentDiagnosticsExport, null, 2);
}
