import { buildPaymentDiagnosticsExport, classifyReconciliation, recordPaymentDiagnostic, sanitizeDiagnosticValue } from '../paymentDiagnostics';

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
});
