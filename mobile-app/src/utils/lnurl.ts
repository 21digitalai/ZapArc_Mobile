// LNURL utilities for Lightning Network operations
// Handles LNURL parsing, validation, and Lightning address conversion

// =============================================================================
// Types
// =============================================================================

export interface LnurlPayData {
  callback: string;
  maxSendable: number; // in millisatoshis
  minSendable: number; // in millisatoshis
  metadata: string;
  tag: string;
  commentAllowed?: number;
}

export interface LnurlPayResponse {
  pr: string; // bolt11 invoice
  successAction?: {
    tag: string;
    message?: string;
    url?: string;
  };
}

export interface ParsedLnurl {
  type: 'pay' | 'withdraw' | 'auth' | 'unknown';
  data?: LnurlPayData;
  error?: string;
}

// =============================================================================
// Lightning Address Utilities
// =============================================================================

/**
 * Converts Lightning address to LNURL endpoint URL, or returns input unchanged if already LNURL.
 * Lightning address format: user@domain → https://domain/.well-known/lnurlp/user
 *
 * @param input - Lightning address (user@domain) or LNURL string
 * @returns LNURL endpoint URL or original input
 */
export function convertToLnurlEndpoint(input: string): string {
  const trimmed = input.trim();

  // Lightning address format: user@domain (but not if it starts with lnurl)
  if (trimmed.includes('@') && !trimmed.toLowerCase().startsWith('lnurl')) {
    const parts = trimmed.split('@');
    if (parts.length === 2) {
      const [username, domain] = parts;
      if (username && domain && domain.includes('.')) {
        return `https://${domain}/.well-known/lnurlp/${username}`;
      }
    }
  }

  return trimmed;
}

/**
 * Validates if input is a valid Lightning address format.
 *
 * @param input - String to validate
 * @returns true if valid Lightning address format (user@domain.tld)
 */
export function isLightningAddress(input: string): boolean {
  const trimmed = input.trim();

  // Must contain @ but not start with lnurl
  if (!trimmed.includes('@') || trimmed.toLowerCase().startsWith('lnurl')) {
    return false;
  }

  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [username, domain] = parts;

  // Username must be non-empty and alphanumeric (with dots, dashes, underscores)
  if (!username || !/^[a-zA-Z0-9._-]+$/.test(username)) {
    return false;
  }

  // Domain must contain at least one dot and be valid
  if (!domain || !domain.includes('.') || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
    return false;
  }

  return true;
}

/**
 * Validates if a Lightning Address resolves correctly by fetching its LNURL pay endpoint.
 * This checks if the address actually exists and can receive payments.
 *
 * @param address - Lightning address (user@domain.tld)
 * @returns Object with isValid flag and optional error message
 */
export async function validateLightningAddressResolves(
  address: string
): Promise<{ isValid: boolean; error?: string }> {
  if (!isLightningAddress(address)) {
    return { isValid: false, error: 'Invalid Lightning Address format' };
  }

  const [username, domain] = address.trim().split('@');
  const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;

  try {
    const controller = new AbortController();
    const timeoutId = global.setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(lnurlEndpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    global.clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return { isValid: false, error: 'Lightning Address not found' };
      }
      return { isValid: false, error: `Server error: ${response.status}` };
    }

    const data = await response.json();

    // Verify it's a pay request
    if (data.tag !== 'payRequest') {
      return { isValid: false, error: 'Address does not support payments' };
    }

    // Verify required fields exist
    if (!data.callback || !data.minSendable || !data.maxSendable) {
      return { isValid: false, error: 'Invalid LNURL pay response' };
    }

    return { isValid: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { isValid: false, error: 'Request timed out - check the domain' };
      }
      if (error.message.includes('Network request failed')) {
        return { isValid: false, error: 'Domain not found - check the address' };
      }
    }
    return { isValid: false, error: 'Failed to verify address' };
  }
}

/**
 * Parse Lightning address into components
 *
 * @param address - Lightning address (user@domain)
 * @returns Object with username and domain, or null if invalid
 */
export function parseLightningAddress(
  address: string
): { username: string; domain: string } | null {
  if (!isLightningAddress(address)) {
    return null;
  }

  const [username, domain] = address.trim().split('@');
  return { username, domain };
}

// =============================================================================
// LNURL Validation
// =============================================================================

/**
 * Validate LNURL format (bech32 encoded string starting with 'lnurl')
 *
 * @param lnurl - LNURL string to validate
 * @returns true if valid LNURL format
 */
export function isValidLnurlFormat(lnurl: string): boolean {
  try {
    const trimmed = lnurl.trim().toLowerCase();

    // LNURL should start with 'lnurl'
    if (!trimmed.startsWith('lnurl')) {
      return false;
    }

    // Basic length check (LNURL should be reasonably long)
    if (trimmed.length < 20) {
      return false;
    }

    // Check for valid bech32 characters (alphanumeric, excluding 1, b, i, o)
    // After 'lnurl1' prefix, the rest should be valid bech32
    const afterPrefix = trimmed.substring(6); // After 'lnurl1'
    if (!/^[023456789acdefghjklmnpqrstuvwxyz]+$/.test(afterPrefix)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if input is a valid LNURL or Lightning address
 *
 * @param input - String to validate
 * @returns true if valid LNURL or Lightning address
 */
export function isValidLnurlOrAddress(input: string): boolean {
  return isValidLnurlFormat(input) || isLightningAddress(input);
}

// =============================================================================
// LNURL Extraction
// =============================================================================

/**
 * Extract LNURL or Lightning address from various formats
 * Handles: lightning: URIs, direct LNURL, Lightning addresses, etc.
 *
 * @param input - Input string (QR code content, URI, etc.)
 * @returns Extracted LNURL/address or null if not found
 */
export function extractLnurl(input: string): string | null {
  try {
    let cleaned = input.trim();

    // Handle lightning: URI scheme
    if (cleaned.toLowerCase().startsWith('lightning:')) {
      cleaned = cleaned.substring(10);
    }

    // Handle LNURL: URI scheme
    if (cleaned.toLowerCase().startsWith('lnurl:')) {
      cleaned = cleaned.substring(6);
    }

    // Handle Lightning address (user@domain)
    if (isLightningAddress(cleaned)) {
      return cleaned;
    }

    // Handle direct LNURL (case insensitive)
    if (cleaned.toLowerCase().startsWith('lnurl')) {
      return cleaned.toLowerCase();
    }

    return null;
  } catch {
    return null;
  }
}
