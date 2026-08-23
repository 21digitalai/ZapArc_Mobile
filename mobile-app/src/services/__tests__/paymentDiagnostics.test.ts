import { classifyReconciliation, sanitizeDiagnosticValue } from '../paymentDiagnostics';

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
});
