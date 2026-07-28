import { mergeImportedContacts, sanitizeImportedContact } from '../contactService';
import { loadContacts, saveContacts } from '../contactStorage';

jest.mock('../contactStorage', () => ({
  loadContacts: jest.fn(),
  saveContacts: jest.fn(),
}));

jest.mock('../../../../services/crypto', () => ({
  generateUUID: jest.fn(() => 'generated-contact-id'),
}));

const mockedLoadContacts = loadContacts as jest.MockedFunction<typeof loadContacts>;
const mockedSaveContacts = saveContacts as jest.MockedFunction<typeof saveContacts>;

describe('contact backup import sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
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

  it('merges only new normalized addresses and is idempotent across repeated syncs', async () => {
    const stored = [{
      id: 'local-alice', name: 'Local Alice', lightningAddress: 'alice@example.com', createdAt: 1, updatedAt: 1,
    }];
    mockedLoadContacts.mockResolvedValue(stored);

    const incoming = [
      { id: 'cloud-alice', name: 'Cloud Alice', lightningAddress: ' ALICE@EXAMPLE.COM ', createdAt: 2, updatedAt: 2 },
      { id: 'cloud-bob', name: 'Bob', lightningAddress: 'bob@example.com', createdAt: 3, updatedAt: 3 },
    ];

    await expect(mergeImportedContacts(incoming)).resolves.toEqual({ added: 1, skipped: 1 });
    await expect(mergeImportedContacts(incoming)).resolves.toEqual({ added: 0, skipped: 2 });
    expect(mockedSaveContacts).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(2);
    expect(stored[1]).toMatchObject({ id: 'generated-contact-id', name: 'Bob', lightningAddress: 'bob@example.com' });
  });

  it('skips malformed cloud contacts without writing a no-op merge', async () => {
    mockedLoadContacts.mockResolvedValue([]);

    await expect(mergeImportedContacts([
      { id: 'bad', name: 'Bad', lightningAddress: 'not-an-address', createdAt: 1, updatedAt: 1 },
    ])).resolves.toEqual({ added: 0, skipped: 1 });
    expect(mockedSaveContacts).not.toHaveBeenCalled();
  });
});
