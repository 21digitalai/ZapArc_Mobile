import { sanitizeImportedContact } from '../contactService';

describe('contact backup import sanitization', () => {
  it('normalizes valid contacts and removes unsupported fields', () => {
    expect(sanitizeImportedContact({
      id: 'remote-id',
      name: '  Alice  ',
      lightningAddress: ' Alice@Example.com ',
      sparkAddress: ' sp1abcd1234 ',
      preferredAsset: 'BTC',
      notes: '  trusted friend ',
      createdAt: 123,
      unexpected: 'never persisted',
    })).toEqual({
      name: 'Alice',
      lightningAddress: 'Alice@Example.com',
      sparkAddress: 'sp1abcd1234',
      preferredAsset: 'BTC',
      notes: 'trusted friend',
      createdAt: 123,
    });
  });

  it('rejects invalid contact payloads before they reach local storage', () => {
    expect(sanitizeImportedContact({ name: 'Bad', lightningAddress: 'not-an-address' })).toBeNull();
    expect(sanitizeImportedContact({ name: 'Bad', lightningAddress: 'bad@example.com', notes: 'x'.repeat(501) })).toBeNull();
    expect(sanitizeImportedContact(null)).toBeNull();
  });
});
