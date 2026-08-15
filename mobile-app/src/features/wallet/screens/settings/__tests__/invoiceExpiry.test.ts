import {
  customMinutesToExpirySecs,
  INVOICE_EXPIRY_PRESETS,
  isInvoiceExpiryPreset,
  MAX_INVOICE_EXPIRY_SECS,
} from '../invoiceExpiry';

describe('invoice expiry settings', () => {
  it('exposes exactly the approved presets', () => {
    expect(INVOICE_EXPIRY_PRESETS).toEqual([900, 3600, 21600, 86400, 604800]);
    expect(isInvoiceExpiryPreset(86400)).toBe(true);
    expect(isInvoiceExpiryPreset(120)).toBe(false);
  });

  it('converts valid custom minutes and rejects values outside one minute through seven days', () => {
    expect(customMinutesToExpirySecs('1')).toBe(60);
    expect(customMinutesToExpirySecs('90')).toBe(5400);
    expect(customMinutesToExpirySecs(String(MAX_INVOICE_EXPIRY_SECS / 60))).toBe(MAX_INVOICE_EXPIRY_SECS);
    expect(customMinutesToExpirySecs('0')).toBeNull();
    expect(customMinutesToExpirySecs('10081')).toBeNull();
    expect(customMinutesToExpirySecs('not-a-number')).toBeNull();
  });
});
