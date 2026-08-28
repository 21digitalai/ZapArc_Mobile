import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@zaparc/payment_diagnostics_v1';
const SDK_SUPPORT_LOG_STORAGE_KEY = '@zaparc/sdk_support_logs_v1';
export const DIAGNOSTIC_MAX_ENTRIES = 30;
export const DIAGNOSTIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The complete persisted journal stays deliberately small even with long error text. */
export const DIAGNOSTIC_MAX_BYTES = 12_000;
export const DIAGNOSTIC_LOG_RING_MAX_ENTRIES = 20;
export const SDK_SUPPORT_LOG_MAX_ENTRIES = 400;
export const SDK_SUPPORT_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SDK_SUPPORT_LOG_MAX_BYTES = 240_000;

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

export interface SuccessfulSyncSummary {
  completed: true;
  durationMs?: number;
  syncedAreas?: string[];
  transfersProcessed?: number;
  completedAt: string;
}

const sdkLogRing: SanitizedSdkLog[] = [];

export interface SdkSupportLogEntry {
  at: string;
  level: string;
  source: 'breez_logger';
  message: string;
  /** More complete on-device text. True secrets are still irreversibly removed. */
  detailedMessage?: string;
  fingerprint: string;
  redacted: boolean;
  code?: string;
  kind?: string;
}

let sdkSupportLogs: SdkSupportLogEntry[] = [];
let sdkSupportLogsLoaded = false;
let sdkSupportLogWriteQueue: Promise<void> = Promise.resolve();
let pendingSdkSupportLogs: SdkSupportLogEntry[] = [];
let sdkSupportLogFlushTimer: ReturnType<typeof setTimeout> | null = null;

export type ReconciliationCode =
  | 'funds_reserved_until_expiry' | 'overdue_stuck_reconciliation'
  | 'settling_or_claimable' | 'funds_returned' | 'return_reported_balance_unverified' | 'balance_sync_inconsistency'
  | 'failed_but_funds_still_reserved' | 'unknown';

export interface BreezHtlcDiagnosticSnapshot {
  paymentHash: string;
  preimage: '[redacted]' | null;
  /** Breez unix timestamp in seconds, encoded as a decimal string. */
  expiryTime: string;
  /** Original numeric SparkHtlcStatus value from Breez. */
  status: number;
}

export interface BreezPaymentDiagnosticSnapshot {
  id: string;
  /** Original numeric PaymentType value from Breez. */
  paymentType: number;
  /** Original numeric PaymentStatus value from Breez. */
  status: number;
  /** Breez U128 values are decimal strings to avoid JSON precision loss. */
  amount: string;
  fees: string;
  /** Breez unix timestamp in seconds, encoded as a decimal string. */
  timestamp: string;
  /** Original numeric PaymentMethod value from Breez. */
  method: number;
  details?: {
    tag: string;
    inner: Record<string, unknown>;
  };
  conversionDetails?: '[redacted]';
}

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
  schemaVersion: 2;
  generatedAt: string;
  app: { name: string; version: string; sdkVersion: string; platform: string };
  /** Sanitized snapshots retain Breez's original response field names and enum values. */
  breez: {
    getPaymentResponse: { payment: BreezPaymentDiagnosticSnapshot | null };
    getInfoResponse: {
      /** identityPubkey and tokenBalances are omitted as wallet-identifying/unrelated data. */
      balanceSats?: string;
      pendingSendSats?: string;
      pendingReceiveSats?: string;
    } | null;
    redactions: string[];
  };
  /** Everything in this block is ZapArc-authored metadata or interpretation. */
  zaparc: {
    reconciliation: ReconciliationCode;
    enumLabels: { paymentStatus?: string; paymentType?: string; paymentMethod?: string; htlcStatus?: string };
    sync: { attempted: boolean; succeeded: boolean; failure?: string };
    sourceFailures?: { payment?: string; paymentFallback?: string; wallet?: string };
    wallet: { balanceSats?: number; pendingSendSats?: number; pendingReceiveSats?: number; authoritative: boolean };
    timeline: PaymentDiagnostic['events'];
    relevantLogs: SanitizedSdkLogSummary[];
    syncSummary?: SuccessfulSyncSummary;
  };
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

const SECRET_LOG_REDACTIONS: Array<[RegExp, string]> = [
  [/\b(seed|mnemonic|private_?key|preimage|proof)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted:secret]'],
  [/\b(authorization|auth(?:entication)?|bearer|api_?key|access_?token|refresh_?token|secret)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '$1=[redacted:credential]'],
  [/\b(?:bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted:credential]'],
];

/** Preserve SDK context while irreversibly removing material that can control funds or accounts. */
export function redactSdkLogSecrets(value: unknown): { message?: string; redacted: boolean } {
  if (typeof value !== 'string') return { redacted: false };
  const original = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!original) return { redacted: false };
  let message = original;
  for (const [pattern, replacement] of SECRET_LOG_REDACTIONS) message = message.replace(pattern, replacement);
  return { message: message.slice(0, 4_000), redacted: message !== original };
}

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

function pruneSdkSupportLogs(entries: SdkSupportLogEntry[], now = Date.now()): SdkSupportLogEntry[] {
  const cutoff = now - SDK_SUPPORT_LOG_MAX_AGE_MS;
  let kept = entries
    .filter((entry) => Number.isFinite(Date.parse(entry.at)) && Date.parse(entry.at) >= cutoff)
    .slice(-SDK_SUPPORT_LOG_MAX_ENTRIES);
  while (kept.length > 1 && JSON.stringify(kept).length > SDK_SUPPORT_LOG_MAX_BYTES) kept = kept.slice(1);
  return kept;
}

async function loadSdkSupportLogs(): Promise<void> {
  if (sdkSupportLogsLoaded) return;
  sdkSupportLogsLoaded = true;
  try {
    const stored = await AsyncStorage.getItem(SDK_SUPPORT_LOG_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed)) sdkSupportLogs = pruneSdkSupportLogs(parsed as SdkSupportLogEntry[]);
  } catch {
    sdkSupportLogs = [];
  }
}

/** Persist a bounded, sanitized Breez log history for explicit support export. */
export function recordSdkSupportLog(level: unknown, line: unknown): void {
  if (typeof line !== 'string') return;
  const safe = sanitizeSdkLogMessage(line);
  const detailed = redactSdkLogSecrets(line);
  if (!safe.message || !safe.fingerprint) return;
  const safeLevel = typeof level === 'string' && /^(trace|debug|info|warn|warning|error)$/i.test(level)
    ? level.toLowerCase()
    : 'info';
  const entry: SdkSupportLogEntry = {
    at: new Date().toISOString(),
    level: safeLevel,
    source: 'breez_logger',
    message: safe.message,
    ...(detailed.message ? { detailedMessage: detailed.message } : {}),
    fingerprint: safe.fingerprint,
    redacted: safe.redacted,
    ...(safe.code ? { code: safe.code } : {}),
    ...(safe.kind ? { kind: safe.kind } : {}),
  };
  pendingSdkSupportLogs.push(entry);
  if (sdkSupportLogFlushTimer) return;
  sdkSupportLogFlushTimer = setTimeout(() => { void flushSdkSupportLogs(); }, 500);
}

async function flushSdkSupportLogs(): Promise<void> {
  if (sdkSupportLogFlushTimer) clearTimeout(sdkSupportLogFlushTimer);
  sdkSupportLogFlushTimer = null;
  if (pendingSdkSupportLogs.length === 0) return sdkSupportLogWriteQueue;
  const pending = pendingSdkSupportLogs;
  pendingSdkSupportLogs = [];
  sdkSupportLogWriteQueue = sdkSupportLogWriteQueue.then(async () => {
    await loadSdkSupportLogs();
    sdkSupportLogs = pruneSdkSupportLogs([...sdkSupportLogs, ...pending]);
    await AsyncStorage.setItem(SDK_SUPPORT_LOG_STORAGE_KEY, JSON.stringify(sdkSupportLogs));
  }).catch(() => undefined);
  await sdkSupportLogWriteQueue;
}

export async function buildSdkSupportLogsExport(input: {
  paymentId: string;
  paymentTimestampMs?: number;
  app: { name: string; version: string; sdkVersion: string; platform: string };
}): Promise<string> {
  await flushSdkSupportLogs();
  await loadSdkSupportLogs();
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const paymentLogs = input.paymentTimestampMs
    ? sdkSupportLogs.filter((entry) => Math.abs(Date.parse(entry.at) - input.paymentTimestampMs!) <= windowMs)
    : [];
  const recentLogs = sdkSupportLogs.filter((entry) => Date.parse(entry.at) >= now - windowMs);
  const toSanitizedEntry = ({ detailedMessage: _detailedMessage, ...entry }: SdkSupportLogEntry) => entry;
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    app: input.app,
    correlation: {
      paymentId: input.paymentId,
      paymentTimestamp: input.paymentTimestampMs ? new Date(input.paymentTimestampMs).toISOString() : null,
      windowMinutes: 15,
    },
    retention: { maxAgeDays: 7, maxEntries: SDK_SUPPORT_LOG_MAX_ENTRIES, sanitized: true },
    redactions: ['invoices', 'LNURLs', 'addresses', 'payment hashes', 'UUIDs', 'pubkeys', 'tokens and API keys', 'filesystem paths', 'long encoded values'],
    paymentWindowAvailable: paymentLogs.length > 0,
    paymentWindowLogs: paymentLogs.map(toSanitizedEntry),
    recentWindowLogs: recentLogs.map(toSanitizedEntry),
  }, null, 2);
}

export async function buildDetailedSdkSupportLogsExport(input: {
  paymentId: string;
  paymentTimestampMs?: number;
  app: { name: string; version: string; sdkVersion: string; platform: string };
}): Promise<string> {
  await flushSdkSupportLogs();
  await loadSdkSupportLogs();
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const toDetailedEntry = ({ detailedMessage, message, ...entry }: SdkSupportLogEntry) => ({
    ...entry,
    message: detailedMessage || message,
  });
  const paymentLogs = input.paymentTimestampMs
    ? sdkSupportLogs.filter((entry) => Math.abs(Date.parse(entry.at) - input.paymentTimestampMs!) <= windowMs).map(toDetailedEntry)
    : [];
  const recentLogs = sdkSupportLogs.filter((entry) => Date.parse(entry.at) >= now - windowMs).map(toDetailedEntry);
  return JSON.stringify({
    schemaVersion: 1,
    exportType: 'detailed-sdk-support-logs',
    generatedAt: new Date(now).toISOString(),
    warning: 'Contains sensitive wallet and payment metadata. Share only with a trusted support recipient.',
    app: input.app,
    correlation: {
      paymentId: input.paymentId,
      paymentTimestamp: input.paymentTimestampMs ? new Date(input.paymentTimestampMs).toISOString() : null,
      windowMinutes: 15,
    },
    retention: { maxAgeDays: 7, maxEntries: SDK_SUPPORT_LOG_MAX_ENTRIES, sanitized: false, secretsAlwaysRedacted: true },
    mandatoryRedactions: ['seed and mnemonic material', 'private keys', 'preimages and proofs', 'API keys and authentication credentials'],
    paymentWindowAvailable: paymentLogs.length > 0,
    paymentWindowLogs: paymentLogs,
    recentWindowLogs: recentLogs,
  }, null, 2);
}

/**
 * SDK log lines can contain payment requests and wallet data. Keep only a
 * deterministic category from an explicitly safe operational vocabulary.
 */
export function recordSanitizedSdkLog(level: unknown, line: unknown): void {
  if (typeof line !== 'string') return;
  const safeLevel = typeof level === 'string' && /^(trace|debug|info|warn|warning|error)$/i.test(level) ? level.toLowerCase() : 'info';
  const normalized = line.toLowerCase();
  let event: SanitizedSdkLog['event'] | undefined;
  if (/\bdisconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_disconnected';
  else if (/\bconnect(?:ed|ing)?\b/.test(normalized)) event = 'sdk_connected';
  else if (/\bsync(?:ed|ing)?\b/.test(normalized)) event = 'wallet_sync';
  else if (/\bhtlc\b/.test(normalized)) event = 'htlc_update';
  else if (/\bpayment\b/.test(normalized)) event = 'payment_update';
  if (!event) return;
  // Do not let high-volume Breez internals evict actionable evidence from the
  // bounded ring. Keep only the info rows needed to build `syncSummary`.
  if (safeLevel === 'info' && event === 'wallet_sync'
    && !/wallet sync completed in|\btransfers\s*=\s*\d+\b/i.test(line)) return;
  const safe = sanitizeSdkLogMessage(line);
  if (!safe.fingerprint) return;
  sdkLogRing.push({
    at: new Date().toISOString(),
    level: safeLevel,
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

/**
 * Convert verbose successful Breez sync internals into one compact snapshot.
 * Warning/error rows remain untouched in `relevantLogs`; trace/debug/info rows
 * are intentionally excluded from copied diagnostics.
 */
export function summarizeSuccessfulSync(logs = getSanitizedSdkLogs()): SuccessfulSyncSummary | undefined {
  let completedAt: string | undefined;
  let durationMs: number | undefined;
  let transfersProcessed = 0;
  let sawTransferCount = false;
  const syncedAreas = new Set<string>();

  for (const log of logs) {
    if (log.level !== 'info' || log.event !== 'wallet_sync' || !log.message) continue;

    const transferMatch = log.message.match(/\btransfers\s*=\s*(\d+)\b/i);
    if (transferMatch) {
      transfersProcessed += Number(transferMatch[1]);
      sawTransferCount = true;
    }

    const completionMatch = log.message.match(/wallet sync completed in\s+([\d.]+)(ms|s)\b/i);
    if (!completionMatch) continue;
    completedAt = log.at;
    const value = Number(completionMatch[1]);
    durationMs = Math.round(completionMatch[2].toLowerCase() === 's' ? value * 1000 : value);

    const details = log.message.match(/InternalSyncedEvent\s*\{([^}]+)\}/i)?.[1] || '';
    for (const match of details.matchAll(/\b([a-z_]+)\s*:\s*true\b/gi)) syncedAreas.add(match[1]);
  }

  if (!completedAt) return undefined;
  return {
    completed: true,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(syncedAreas.size ? { syncedAreas: [...syncedAreas] } : {}),
    ...(sawTransferCount ? { transfersProcessed } : {}),
    completedAt,
  };
}

export function getRelevantSdkLogSummaries(logs = getSanitizedSdkLogs()): SanitizedSdkLogSummary[] {
  return summarizeSanitizedSdkLogs(logs.filter((log) => log.level === 'warn' || log.level === 'warning' || log.level === 'error'));
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
    const hasBalanceEvidence = input.balanceBeforeSats !== undefined && input.balanceAfterSats !== undefined;
    const balanceReduced = input.balanceBeforeSats !== undefined && input.balanceAfterSats !== undefined
      && input.balanceAfterSats < input.balanceBeforeSats;
    if (!hasBalanceEvidence) return 'return_reported_balance_unverified';
    return input.synced && !input.pendingSendSats && !balanceReduced ? 'funds_returned' : 'balance_sync_inconsistency';
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
export async function buildPaymentDiagnosticsExport(input: Omit<PaymentDiagnosticsExport, 'schemaVersion' | 'generatedAt' | 'app' | 'zaparc'> & {
  paymentId: string;
  app?: PaymentDiagnosticsExport['app'];
  zaparc: Omit<PaymentDiagnosticsExport['zaparc'], 'timeline' | 'relevantLogs' | 'syncSummary'>;
}): Promise<string> {
  const journal = await getPaymentDiagnostic(input.paymentId);
  // The export event repeats the top-level sync/wallet/HTLC snapshot and adds
  // no historical evidence, so keep it persisted but omit it from copied JSON.
  const timeline = (journal?.events || []).filter((event) => !event.stage.startsWith('export_'));
  const logs = getSanitizedSdkLogs();
  const syncSummary = summarizeSuccessfulSync(logs);
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    app: input.app || { name: 'ZapArc Mobile', version: 'unknown', sdkVersion: 'unknown', platform: 'unknown' },
    breez: input.breez,
    zaparc: {
      ...input.zaparc,
      timeline,
      ...(syncSummary ? { syncSummary } : {}),
      relevantLogs: getRelevantSdkLogSummaries(logs),
    },
  } satisfies PaymentDiagnosticsExport, null, 2);
}
