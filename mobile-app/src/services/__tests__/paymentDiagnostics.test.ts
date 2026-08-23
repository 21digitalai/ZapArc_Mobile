import { buildPaymentDiagnosticsExport, classifyReconciliation, DIAGNOSTIC_MAX_AGE_MS, DIAGNOSTIC_MAX_BYTES, DIAGNOSTIC_MAX_ENTRIES, prunePaymentDiagnostics, recordPaymentDiagnostic, sanitizeDiagnosticValue } from '../paymentDiagnostics';

jest.mock('@react-native-async-storage/async-storage', () => {
  let value: string | null = null;
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async (_key: string, next: string) => { value = next; }),
  };
});

describe('payment diagnostics privacy and reconciliation', () => {
  it('redacts sensitive values while retaining short generic SDK details', () => {
    expect(sanitizeDiagnosticValue('network timeout')).toBe('network timeout');
    expect(sanitizeDiagnosticValue('lnbc1secretinvoice')).toBeUndefined();
    expect(sanitizeDiagnosticValue('seed phrase leaked')).toBeUndefined();
  });

  it('classifies returned funds only with synced, cleared pending evidence', () => {
    expect(classifyReconciliation({ htlcStatus: 'Returned', synced: true, pendingSendSats: 0 }))
      .toBe('funds_returned');
    expect(classifyReconciliation({ htlcStatus: 'Returned', synced: false, pendingSendSats: 0 }))
      .toBe('balance_sync_inconsistency');
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
      .toBe('funds_returned');
  });

  it('exports only the allowlisted payment, wallet, and lifecycle fields', async () => {
    await recordPaymentDiagnostic('payment-1', 'submit_failed', 'lnbc1privateinvoice');
    const payload = JSON.parse(await buildPaymentDiagnosticsExport({
      reconciliation: 'unknown',
      sync: { attempted: true, succeeded: false, failure: 'sync unavailable' },
      payment: { id: 'payment-1', status: 'failed', direction: 'send', amountSats: 42 },
      wallet: { balanceSats: 100, pendingSendSats: 42, authoritative: false },
    }));
    expect(payload).toMatchObject({ schemaVersion: 1, payment: { id: 'payment-1' } });
    expect(JSON.stringify(payload)).not.toContain('lnbc1privateinvoice');
    expect(payload.timeline[0]).not.toHaveProperty('detail');
  });

  it('retains separate partial-export source failures without sensitive values', async () => {
    const payload = JSON.parse(await buildPaymentDiagnosticsExport({
      reconciliation: 'unknown',
      sync: { attempted: true, succeeded: false, failure: 'sync unavailable' },
      sourceFailures: { payment: 'lookup unavailable', paymentFallback: 'not found' },
      payment: { id: 'payment-2' },
      wallet: { authoritative: false },
    }));
    expect(payload.sourceFailures).toEqual({ payment: 'lookup unavailable', paymentFallback: 'not found' });
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
    const payload = JSON.parse(await buildPaymentDiagnosticsExport({
      reconciliation: 'unknown', sync: { attempted: true, succeeded: false }, payment: { id: 'payment-snapshot' }, wallet: { authoritative: false },
    }));
    expect(payload.timeline[0]).toMatchObject({ balanceSats: 100, pendingSendSats: 42, htlcStatus: '0', htlcExpiryMs: 123 });
    expect(JSON.stringify(payload)).not.toContain('lnbc1should-not-export');
    expect(JSON.stringify(payload)).not.toContain('preimage');
  });
});
