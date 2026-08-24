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
  source: 'breez_logger';
  /** A derived category; raw SDK log lines are never retained. */
  event: 'sdk_connected' | 'sdk_disconnected' | 'wallet_sync' | 'payment_update' | 'htlc_update';
  message?: string;
  code?: string;
  kind?: string;
  fingerprint: string;
  redacted: boolean;
}

export interface SanitizedSdkLogSummary extends Omit<SanitizedSdkLog, 'at'> {
  firstAt: string;
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
const LOG_REDACTIONS: Array<[RegExp, string]> = [
  [/\b(?:lnbc|lntb|lnbcrt)[0-9a-z]+\b/gi, '[redacted:invoice]'],
  [/\blnurl1[0-9a-z]+\b/gi, '[redacted:lnurl]'],
  [/\b(?:bc1|tb1|bcrt1)[0-9a-z]{20,}\b/gi, '[redacted:bitcoin-address]'],
  [/\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, '[redacted:bitcoin-address]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted:address]'],
  [/\b[0-9a-f]{64,}\b/gi, '[redacted:hex]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted:id]'],
  [/\b(seed|mnemonic|private_?key|preimage|proof|api_?key|token|invoice|bolt11|lnurl|recipient|pubkey)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'],
  [/(?:\/[A-Za-z0-9._-]+){3,}/g, '[redacted:path]'],
  [/\b[A-Za-z0-9+/_=-]{48,}\b/g, '[redacted:encoded]'],
];

/** Keep only deterministic, non-sensitive support evidence. */
export function sanitizeDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || SENSITIVE.test(trimmed)) return undefined;
  return trimmed.slice(0, 240);
}

function fingerprintLogLine(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `log-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Redact identifiers and secret-bearing values before retaining SDK text. */
export function sanitizeSdkLogMessage(value: unknown): { message?: string; fingerprint?: string; redacted: boolean; code?: string; kind?: string } {
  if (typeof value !== 'string') return { redacted: false };
  const original = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!original) return { redacted: false };
  let message = original;
  for (const [pattern, replacement] of LOG_REDACTIONS) message = message.replace(pattern, replacement);
  const redacted = message !== original;
  const code = message.match(/\bcode\s*[:=]\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\b/i)?.[1];
  const kind = message.match(/\bkind\s*[:=]\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\b/i)?.[1];
  return {
    message: message.slice(0, 500),
    fingerprint: fingerprintLogLine(original),
    redacted,
    ...(code ? { code } : {}),
    ...(kind ? { kind } : {}),
  };
}

/**
 * SDK log lines can contain payment requests and wallet data. Keep only a
 * deterministic category from an explicitly safe operational vocabulary.
 */
export function recordSanitizedSdkLog(level: unknown, line: unknown): void {
  if (typeof line !== 'string') return;
  const normalized = line.toLowerCase();
  let event: SanitizedSdkLog['event'] | undefined;
  if (/\bdisconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_disconnected';
  else if (/\bconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_connected';
  else if (/\bsync(?:ed|ing)?\b/.test(normalized)) event = 'wallet_sync';
  else if (/\bhtlc\b/.test(normalized)) event = 'htlc_update';
  else if (/\bpayment\b/.test(normalized)) event = 'payment_update';
  if (!event) return;
  const safe = sanitizeSdkLogMessage(line);
  if (!safe.fingerprint) return;
  sdkLogRing.push({
    at: new Date().toISOString(),
    level: typeof level === 'string' && /^(trace|debug|info|warn|warning|error)$/i.test(level) ? level.toLowerCase() : 'info',
    source: 'breez_logger',
    event,
    ...safe,
    fingerprint: safe.fingerprint,
  });
  if (sdkLogRing.length > DIAGNOSTIC_LOG_RING_MAX_ENTRIES) sdkLogRing.splice(0, sdkLogRing.length - DIAGNOSTIC_LOG_RING_MAX_ENTRIES);
}

export function getSanitizedSdkLogs(): SanitizedSdkLog[] {
  return sdkLogRing.map((entry) => ({ ...entry }));
}

/**
 * Raw Breez lines are intentionally never retained. Collapse identical safe
 * messages so a retry loop does not produce dozens of duplicate rows.
 */
export function summarizeSanitizedSdkLogs(logs = getSanitizedSdkLogs()): SanitizedSdkLogSummary[] {
  const summaries = new Map<string, SanitizedSdkLogSummary>();
  for (const log of logs) {
    const key = `${log.level}:${log.event}:${log.fingerprint}`;
    const existing = summaries.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = log.at;
    } else {
      const { at, ...safeLog } = log;
      summaries.set(key, { ...safeLog, firstAt: at, count: 1, lastAt: at });
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
