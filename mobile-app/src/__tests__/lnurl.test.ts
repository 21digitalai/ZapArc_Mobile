// Unit tests for LNURL utilities
// Tests Lightning address validation and LNURL extraction

import {
  isLightningAddress,
  parseLightningAddress,
  convertToLnurlEndpoint,
  isValidLnurlFormat,
  isValidLnurlOrAddress,
  extractLnurl,
} from '../utils/lnurl';

// =============================================================================
// Lightning Address Tests
// =============================================================================

describe('Lightning Address Utilities', () => {
  describe('isLightningAddress', () => {
    it('should return true for valid Lightning addresses', () => {
      expect(isLightningAddress('user@example.com')).toBe(true);
      expect(isLightningAddress('satoshi@bitcoin.org')).toBe(true);
      expect(isLightningAddress('test.user@ln.domain.io')).toBe(true);
      expect(isLightningAddress('user-name@subdomain.example.com')).toBe(true);
      expect(isLightningAddress('user_123@wallet.com')).toBe(true);
    });

    it('should return false for invalid Lightning addresses', () => {
      // No @
      expect(isLightningAddress('userexample.com')).toBe(false);
      // No domain
      expect(isLightningAddress('user@')).toBe(false);
      // No username
      expect(isLightningAddress('@example.com')).toBe(false);
      // No TLD
      expect(isLightningAddress('user@localhost')).toBe(false);
      // Multiple @
      expect(isLightningAddress('user@foo@bar.com')).toBe(false);
      // LNURL (starts with lnurl)
      expect(isLightningAddress('lnurl1abc@example.com')).toBe(false);
      // Invalid characters
      expect(isLightningAddress('user name@example.com')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isLightningAddress('')).toBe(false);
      expect(isLightningAddress('   ')).toBe(false);
      expect(isLightningAddress('  user@example.com  ')).toBe(true);
    });
  });

  describe('parseLightningAddress', () => {
    it('should parse valid Lightning addresses', () => {
      const result = parseLightningAddress('user@example.com');
      expect(result).toEqual({ username: 'user', domain: 'example.com' });
    });

    it('should return null for invalid addresses', () => {
      expect(parseLightningAddress('invalid')).toBeNull();
      expect(parseLightningAddress('user@')).toBeNull();
      expect(parseLightningAddress('')).toBeNull();
    });
  });

  describe('convertToLnurlEndpoint', () => {
    it('should convert Lightning address to LNURL endpoint', () => {
      expect(convertToLnurlEndpoint('user@example.com')).toBe(
        'https://example.com/.well-known/lnurlp/user'
      );
      expect(convertToLnurlEndpoint('satoshi@bitcoin.org')).toBe(
        'https://bitcoin.org/.well-known/lnurlp/satoshi'
      );
    });

    it('should return LNURL unchanged', () => {
      const lnurl = 'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcen';
      expect(convertToLnurlEndpoint(lnurl)).toBe(lnurl);
    });

    it('should handle whitespace', () => {
      expect(convertToLnurlEndpoint('  user@example.com  ')).toBe(
        'https://example.com/.well-known/lnurlp/user'
      );
    });
  });
});

// =============================================================================
// LNURL Validation Tests
// =============================================================================

describe('LNURL Validation', () => {
  describe('isValidLnurlFormat', () => {
    it('should return true for valid LNURL strings', () => {
      // Valid bech32 encoded LNURLs
      expect(
        isValidLnurlFormat('lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcen')
      ).toBe(true);
      expect(
        isValidLnurlFormat('LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCEN')
      ).toBe(true);
    });

    it('should return false for invalid LNURL strings', () => {
      // Too short
      expect(isValidLnurlFormat('lnurl1abc')).toBe(false);
      // Doesn't start with lnurl
      expect(isValidLnurlFormat('abc123')).toBe(false);
      // Empty
      expect(isValidLnurlFormat('')).toBe(false);
    });
  });

  describe('isValidLnurlOrAddress', () => {
    it('should return true for valid LNURL or Lightning address', () => {
      expect(isValidLnurlOrAddress('user@example.com')).toBe(true);
      expect(
        isValidLnurlOrAddress('lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcen')
      ).toBe(true);
    });

    it('should return false for invalid input', () => {
      expect(isValidLnurlOrAddress('invalid')).toBe(false);
      expect(isValidLnurlOrAddress('')).toBe(false);
    });
  });
});

// =============================================================================
// LNURL Extraction Tests
// =============================================================================

describe('extractLnurl', () => {
  it('should extract Lightning address from input', () => {
    expect(extractLnurl('user@example.com')).toBe('user@example.com');
    expect(extractLnurl('  user@example.com  ')).toBe('user@example.com');
  });

  it('should extract LNURL from input', () => {
    const lnurl = 'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcen';
    expect(extractLnurl(lnurl)).toBe(lnurl);
    expect(extractLnurl(lnurl.toUpperCase())).toBe(lnurl);
  });

  it('should handle lightning: URI scheme', () => {
    expect(extractLnurl('lightning:user@example.com')).toBe('user@example.com');
    expect(extractLnurl('LIGHTNING:user@example.com')).toBe('user@example.com');
  });

  it('should return null for invalid input', () => {
    expect(extractLnurl('invalid')).toBeNull();
    expect(extractLnurl('')).toBeNull();
    expect(extractLnurl('http://example.com')).toBeNull();
  });
});
