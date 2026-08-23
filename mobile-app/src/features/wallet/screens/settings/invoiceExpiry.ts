export const MIN_INVOICE_EXPIRY_SECS = 60 * 60;
export const MAX_INVOICE_EXPIRY_SECS = 7 * 24 * 60 * 60;
export const INVOICE_EXPIRY_PRESETS = [MIN_INVOICE_EXPIRY_SECS, 21600, 86400, MAX_INVOICE_EXPIRY_SECS] as const;

export function customMinutesToExpirySecs(value: string): number | null {
  const seconds = Math.round(Number(value) * 60);
  if (!Number.isFinite(seconds) || seconds < MIN_INVOICE_EXPIRY_SECS || seconds > MAX_INVOICE_EXPIRY_SECS) {
    return null;
  }
  return seconds;
}

export function isInvoiceExpiryPreset(seconds: number): boolean {
  return INVOICE_EXPIRY_PRESETS.includes(seconds as typeof INVOICE_EXPIRY_PRESETS[number]);
}

export function normalizeInvoiceExpirySecs(seconds: number | undefined): number {
  if (!Number.isFinite(seconds)) return 86400;
  return Math.min(MAX_INVOICE_EXPIRY_SECS, Math.max(MIN_INVOICE_EXPIRY_SECS, Math.round(seconds as number)));
}
