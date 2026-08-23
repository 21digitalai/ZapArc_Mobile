import {
  customMinutesToExpirySecs,
  INVOICE_EXPIRY_PRESETS,
  isInvoiceExpiryPreset,
  MAX_INVOICE_EXPIRY_SECS,
  normalizeInvoiceExpirySecs,
} from '../invoiceExpiry';

describe('invoice expiry settings', () => {
  it('exposes exactly the approved presets', () => {
    expect(INVOICE_EXPIRY_PRESETS).toEqual([3600, 21600, 86400, 604800]);
    expect(isInvoiceExpiryPreset(86400)).toBe(true);
    expect(isInvoiceExpiryPreset(120)).toBe(false);
  });

  it('converts valid custom minutes and rejects values outside one hour through seven days', () => {
    expect(customMinutesToExpirySecs('1')).toBeNull();
    expect(customMinutesToExpirySecs('59')).toBeNull();
    expect(customMinutesToExpirySecs('60')).toBe(3600);
    expect(customMinutesToExpirySecs('90')).toBe(5400);
    expect(customMinutesToExpirySecs(String(MAX_INVOICE_EXPIRY_SECS / 60))).toBe(MAX_INVOICE_EXPIRY_SECS);
    expect(customMinutesToExpirySecs('0')).toBeNull();
    expect(customMinutesToExpirySecs('10081')).toBeNull();
    expect(customMinutesToExpirySecs('not-a-number')).toBeNull();
  });

  it('normalizes legacy short settings to the new one-hour minimum', () => {
    expect(normalizeInvoiceExpirySecs(900)).toBe(3600);
    expect(normalizeInvoiceExpirySecs(3600)).toBe(3600);
    expect(normalizeInvoiceExpirySecs(undefined)).toBe(86400);
  });
});
