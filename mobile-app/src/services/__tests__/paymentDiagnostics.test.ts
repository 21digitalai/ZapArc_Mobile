import { buildDetailedSdkSupportLogsExport, buildPaymentDiagnosticsExport, buildSdkSupportLogsExport, classifyReconciliation, DIAGNOSTIC_LOG_RING_MAX_ENTRIES, DIAGNOSTIC_MAX_AGE_MS, DIAGNOSTIC_MAX_BYTES, DIAGNOSTIC_MAX_ENTRIES, getRelevantSdkLogSummaries, getSanitizedSdkLogs, prunePaymentDiagnostics, recordPaymentDiagnostic, recordSanitizedSdkLog, recordSdkSupportLog, redactSdkLogSecrets, sanitizeDiagnosticValue, sanitizeSdkLogMessage, summarizeSanitizedSdkLogs, summarizeSuccessfulSync } from '../paymentDiagnostics';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, next: string) => { values.set(key, next); }),
  };
});

describe('payment diagnostics privacy and reconciliation', () => {
  const exportInput = (paymentId: string, overrides: Record<string, unknown> = {}) => ({
    paymentId,
    breez: {
      getPaymentResponse: { payment: null },
      getInfoResponse: null,
      redactions: [],
    },
    zaparc: {
      reconciliation: 'unknown' as const,
      enumLabels: {},
      sync: { attempted: false, succeeded: false },
      wallet: { authoritative: false },
      ...overrides,
    },
  });
  it('redacts sensitive values while retaining short generic SDK details', () => {
    expect(sanitizeDiagnosticValue('network timeout')).toBe('network timeout');
    expect(sanitizeDiagnosticValue('lnbc1secretinvoice')).toBeUndefined();
    expect(sanitizeDiagnosticValue('seed phrase leaked')).toBeUndefined();
  });

  it('retains actionable SDK error text while redacting wallet identifiers and secrets', () => {
    const invoice = `lnbc${'1'.repeat(80)}`;
    const hash = 'a'.repeat(64);
    const safe = sanitizeSdkLogMessage(`wallet sync failed code=Timeout invoice=${invoice} payment_hash=${hash} /private/wallet/data/file`);
    expect(safe).toMatchObject({ code: 'Timeout', redacted: true });
    expect(safe.message).toContain('wallet sync failed');
    expect(safe.message).toContain('invoice=[redacted]');
    expect(safe.message).toContain('[redacted:hex]');
    expect(safe.message).toContain('[redacted:path]');
    expect(safe.fingerprint).toMatch(/^log-[0-9a-f]{8}$/);
    expect(safe.message).not.toContain(invoice);
    expect(safe.message).not.toContain(hash);
  });

  it('exports bounded sanitized SDK support logs for the payment and recent windows', async () => {
    const now = Date.now();
    recordSdkSupportLog('info', `send payment invoice=lnbc${'1'.repeat(80)} started`);
    recordSdkSupportLog('error', `wallet sync failed code=DeadlineExceeded payment_hash=${'a'.repeat(64)}`);
    const payload = JSON.parse(await buildSdkSupportLogsExport({
      paymentId: 'payment-support',
      paymentTimestampMs: now,
      app: { name: 'ZapArc Mobile', version: 'test', sdkVersion: 'test', platform: 'ios' },
    }));
    expect(payload.paymentWindowAvailable).toBe(true);
    expect(payload.paymentWindowLogs).toHaveLength(2);
    expect(payload.recentWindowLogs).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toContain('lnbc1111');
    expect(JSON.stringify(payload)).not.toContain('a'.repeat(64));
    expect(payload.paymentWindowLogs[1]).toMatchObject({ level: 'error', code: 'DeadlineExceeded', redacted: true });
  });

  it('exports detailed SDK context only after retaining irreversible secret redactions', async () => {
    const now = Date.now();
    const invoice = `lnbc${'1'.repeat(80)}`;
    const hash = 'b'.repeat(64);
    recordSdkSupportLog('error', `send failed invoice=${invoice} payment_hash=${hash} preimage=deadbeef api_key=topsecret`);
    const payload = JSON.parse(await buildDetailedSdkSupportLogsExport({
      paymentId: 'payment-detailed',
      paymentTimestampMs: now,
      app: { name: 'ZapArc Mobile', version: 'test', sdkVersion: 'test', platform: 'ios' },
    }));
    const serialized = JSON.stringify(payload);
    expect(payload.exportType).toBe('detailed-sdk-support-logs');
    expect(serialized).toContain(invoice);
    expect(serialized).toContain(hash);
    expect(serialized).not.toContain('deadbeef');
    expect(serialized).not.toContain('topsecret');
    expect(serialized).toContain('[redacted:secret]');
    expect(serialized).toContain('[redacted:credential]');
  });

  it('always removes fund-control and authentication secrets from detailed logs', () => {
    const result = redactSdkLogSecrets('seed=alpha preimage=beta Authorization: Bearer abc.def private_key=gamma');
    expect(result.redacted).toBe(true);
    expect(result.message).not.toContain('alpha');
    expect(result.message).not.toContain('beta');
    expect(result.message).not.toContain('abc.def');
    expect(result.message).not.toContain('gamma');
  });

  it('keeps structured Breez error evidence in the exported log summary', () => {
    recordSanitizedSdkLog('error', 'wallet sync failed kind=Connectivity code=DeadlineExceeded');
    recordSanitizedSdkLog('error', 'wallet sync failed kind=Connectivity code=DeadlineExceeded');
    const summary = summarizeSanitizedSdkLogs().at(-1);
    expect(summary).toMatchObject({
      source: 'breez_logger',
      level: 'error',
      event: 'wallet_sync',
      kind: 'Connectivity',
      code: 'DeadlineExceeded',
      message: 'wallet sync failed kind=Connectivity code=DeadlineExceeded',
      count: 2,
      redacted: false,
    });
    expect(summary?.firstAt).toBeTruthy();
    expect(summary?.lastAt).toBeTruthy();
  });

  it('does not retain routine successful-sync internals in the bounded ring', () => {
    const before = getSanitizedSdkLogs().length;
    recordSanitizedSdkLog('info', 'Sync trigger changed: internal mutex details');
    recordSanitizedSdkLog('info', 'emit(Synced) completed in 5ms');
    expect(getSanitizedSdkLogs()).toHaveLength(before);
  });

  it('classifies returned funds only with synced, cleared pending evidence', () => {
    expect(classifyReconciliation({ htlcStatus: 'Returned', synced: true, pendingSendSats: 0 }))
      .toBe('return_reported_balance_unverified');
    expect(classifyReconciliation({ htlcStatus: 'Returned', synced: false, pendingSendSats: 0 }))
      .toBe('return_reported_balance_unverified');
    expect(classifyReconciliation({ htlcStatus: 'Returned', synced: true, pendingSendSats: 0, balanceBeforeSats: 100, balanceAfterSats: 100 }))
      .toBe('funds_returned');
  });

  it('flags a Returned HTLC with a reduced post-send balance for reconciliation', () => {
    expect(classifyReconciliation({
      htlcStatus: 'Returned', synced: true, pendingSendSats: 0, balanceBeforeSats: 100, balanceAfterSats: 90,
    })).toBe('balance_sync_inconsistency');
  });

  it('keeps a bounded derived SDK log ring and never retains sensitive raw lines', async () => {
    recordSanitizedSdkLog('info', 'wallet sync completed');
    recordSanitizedSdkLog('error', 'payment failed: lnbc1secretinvoice');
    for (let index = 0; index < DIAGNOSTIC_LOG_RING_MAX_ENTRIES + 3; index += 1) recordSanitizedSdkLog('debug', 'payment update');
    const logs = getSanitizedSdkLogs();
    expect(logs).toHaveLength(DIAGNOSTIC_LOG_RING_MAX_ENTRIES);
    expect(logs.every((entry) => entry.event === 'payment_update')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('lnbc1secretinvoice');
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('logs')));
    expect(payload.zaparc.relevantLogs).toEqual([]);
  });

  it('keeps detailed warnings and errors while reducing successful sync chatter to one summary', () => {
    const logs = [
      { at: '2026-08-24T08:58:16.188Z', level: 'info', source: 'breez_logger' as const, event: 'wallet_sync' as const, message: 'Sync trigger changed: internal details', fingerprint: 'log-1', redacted: false },
      { at: '2026-08-24T08:58:17.036Z', level: 'info', source: 'breez_logger' as const, event: 'wallet_sync' as const, message: 'Syncing payments to storage, offset = 254, transfers = 1', fingerprint: 'log-2', redacted: false },
      { at: '2026-08-24T08:58:19.754Z', level: 'info', source: 'breez_logger' as const, event: 'wallet_sync' as const, message: 'sync_wallet_internal: Wallet sync completed in 2.397600676s: InternalSyncedEvent { wallet: true, wallet_state: true, deposits: true, lnurl_metadata: true, storage_incoming: None }', fingerprint: 'log-3', redacted: false },
      { at: '2026-08-24T08:58:20.000Z', level: 'error', source: 'breez_logger' as const, event: 'wallet_sync' as const, message: 'wallet sync failed code=DeadlineExceeded', code: 'DeadlineExceeded', fingerprint: 'log-4', redacted: false },
    ];

    expect(summarizeSuccessfulSync(logs)).toEqual({
      completed: true,
      durationMs: 2398,
      syncedAreas: ['wallet', 'wallet_state', 'deposits', 'lnurl_metadata'],
      transfersProcessed: 1,
      completedAt: '2026-08-24T08:58:19.754Z',
    });
    expect(getRelevantSdkLogSummaries(logs)).toEqual([
      expect.objectContaining({ level: 'error', message: 'wallet sync failed code=DeadlineExceeded', count: 1 }),
    ]);
  });

  it('keeps failed payments reserved while pending balance remains', () => {
    expect(classifyReconciliation({ paymentStatus: 'failed', pendingSendSats: 1 }))
      .toBe('failed_but_funds_still_reserved');
  });

  it('classifies numeric Spark HTLC statuses from the installed RN SDK', () => {
    expect(classifyReconciliation({ htlcStatus: '0', htlcExpiryMs: Date.now() + 60_000 }))
      .toBe('funds_reserved_until_expiry');
    expect(classifyReconciliation({ htlcStatus: '1' })).toBe('settling_or_claimable');
    expect(classifyReconciliation({ htlcStatus: '2', synced: true, pendingSendSats: 0 }))
      .toBe('return_reported_balance_unverified');
  });

  it('exports only the allowlisted payment, wallet, and lifecycle fields', async () => {
    await recordPaymentDiagnostic('payment-1', 'submit_failed', 'lnbc1privateinvoice');
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('payment-1', {
      sync: { attempted: true, succeeded: false, failure: 'sync unavailable' },
      wallet: { balanceSats: 100, pendingSendSats: 42, authoritative: false },
    })));
    expect(payload).toMatchObject({ schemaVersion: 2, app: { name: 'ZapArc Mobile' }, breez: { getPaymentResponse: { payment: null } } });
    expect(JSON.stringify(payload)).not.toContain('lnbc1privateinvoice');
    expect(payload.zaparc.timeline[0]).not.toHaveProperty('detail');
  });

  it('retains separate partial-export source failures without sensitive values', async () => {
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('payment-2', {
      sync: { attempted: true, succeeded: false, failure: 'sync unavailable' },
      sourceFailures: { payment: 'lookup unavailable', paymentFallback: 'not found' },
    })));
    expect(payload.zaparc.sourceFailures).toEqual({ payment: 'lookup unavailable', paymentFallback: 'not found' });
  });

  it('redacts sensitive text embedded in an otherwise generic SDK error', () => {
    expect(sanitizeDiagnosticValue('network timeout; seed phrase follows')).toBeUndefined();
    expect(sanitizeDiagnosticValue('retry failed: preimage=secret')).toBeUndefined();
  });

  it('evicts retained diagnostics by age, count, and serialized size', () => {
    const now = Date.now();
    const old = { paymentId: 'old', createdAt: new Date(now - DIAGNOSTIC_MAX_AGE_MS - 1).toISOString(), events: [] };
    const many = Array.from({ length: DIAGNOSTIC_MAX_ENTRIES + 4 }, (_, index) => ({
      paymentId: `payment-${index}`,
      createdAt: new Date(now - index).toISOString(),
      events: [{ at: new Date(now).toISOString(), stage: 'event', detail: 'x'.repeat(240) }],
    }));
    const retained = prunePaymentDiagnostics([old, ...many], now);
    expect(retained).toHaveLength(DIAGNOSTIC_MAX_ENTRIES);
    expect(retained.some((entry) => entry.paymentId === 'old')).toBe(false);

    const oversized = Array.from({ length: 3 }, (_, index) => ({
      paymentId: `large-${index}`,
      createdAt: new Date(now).toISOString(),
      events: Array.from({ length: 20 }, () => ({ at: new Date(now).toISOString(), stage: 'event', detail: 'x'.repeat(240) })),
    }));
    expect(JSON.stringify(prunePaymentDiagnostics(oversized, now)).length).toBeLessThanOrEqual(DIAGNOSTIC_MAX_BYTES);
  });

  it('stores only allowlisted lifecycle snapshots and HTLC transition fields', async () => {
    await recordPaymentDiagnostic('payment-snapshot', 'event_pending', {
      balanceSats: 100,
      pendingSendSats: 42,
      htlcStatus: '0',
      htlcExpiryMs: 123,
      detail: 'raw invoice lnbc1should-not-export',
      preimage: 'never persisted',
    });
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('payment-snapshot', {
      sync: { attempted: true, succeeded: false },
    })));
    expect(payload.zaparc.timeline[0]).toMatchObject({ balanceSats: 100, pendingSendSats: 42, htlcStatus: '0', htlcExpiryMs: 123 });
    expect(JSON.stringify(payload)).not.toContain('lnbc1should-not-export');
    expect(JSON.stringify(payload)).not.toContain('preimage');
  });

  it('keeps an allowlisted full send and event timeline', async () => {
    await recordPaymentDiagnostic('payment-timeline', 'pre_send_snapshot', { balanceSats: 100, pendingSendSats: 0 });
    await recordPaymentDiagnostic('payment-timeline', 'prepare_succeeded');
    await recordPaymentDiagnostic('payment-timeline', 'submitted_pending', { htlcStatus: '0', htlcExpiryMs: 123 });
    await recordPaymentDiagnostic('payment-timeline', 'event_failed', { htlcStatus: '2', balanceSats: 100, pendingSendSats: 0 });
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('payment-timeline', { reconciliation: 'funds_returned', sync: { attempted: true, succeeded: true }, wallet: { balanceSats: 100, authoritative: true } })));
    expect(payload.zaparc.timeline.map((event: { stage: string }) => event.stage)).toEqual([
      'pre_send_snapshot', 'prepare_succeeded', 'submitted_pending', 'event_failed',
    ]);
    expect(JSON.stringify(payload)).not.toContain('preimage');
  });

  it('omits duplicate export snapshots from the copied timeline', async () => {
    await recordPaymentDiagnostic('payment-compact', 'event_pending');
    await recordPaymentDiagnostic('payment-compact', 'export_reconciled', {
      balanceSats: 100, pendingSendSats: 0, htlcStatus: '2',
    });
    const payload = JSON.parse(await buildPaymentDiagnosticsExport(exportInput('payment-compact', {
      reconciliation: 'funds_returned',
      sync: { attempted: true, succeeded: true },
      wallet: { balanceSats: 100, pendingSendSats: 0, authoritative: true },
    })));
    expect(payload.zaparc.timeline.map((event: { stage: string }) => event.stage)).toEqual(['event_pending']);
  });
});
