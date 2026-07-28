jest.mock('../backupEncryption', () => ({
  decryptStringBlob: jest.fn(),
  validateBackupStructure: jest.fn(() => true),
  isEncryptionAvailable: jest.fn(() => true),
}));

import { decryptStringBlob } from '../backupEncryption';
import { googleDriveBackupService } from '../googleDriveBackupService';

const mockedDecrypt = decryptStringBlob as jest.MockedFunction<typeof decryptStringBlob>;

describe('Google Drive contacts-only sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (googleDriveBackupService as unknown as { getValidAccessToken: jest.Mock }).getValidAccessToken = jest.fn().mockResolvedValue('token');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 3, contacts: { ciphertext: 'blob' } }) }) as jest.Mock;
  });

  it('keeps wrong-password and authenticated-but-corrupt contacts failures distinct', async () => {
    mockedDecrypt.mockRejectedValueOnce(new Error('auth failed'));
    await expect(googleDriveBackupService.restoreContacts('backup', 'wrong')).resolves.toEqual({ success: false, error: 'contacts_wrong_password' });

    mockedDecrypt.mockResolvedValueOnce('{not-json');
    await expect(googleDriveBackupService.restoreContacts('backup', 'right')).resolves.toEqual({ success: false, error: 'contacts_corrupt' });
  });

  it('does not treat a legacy seed-only backup as an error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ version: 3 }) });
    await expect(googleDriveBackupService.restoreContacts('backup', 'password')).resolves.toEqual({ success: true, contacts: [] });
  });

  it('returns only sanitized cloud contacts that can be merged by Sync', async () => {
    mockedDecrypt.mockResolvedValueOnce(JSON.stringify([
      { name: 'Alice', lightningAddress: ' alice@example.com ', createdAt: 10 },
      { name: '', address: 'not-a-contact' },
    ]));

    await expect(googleDriveBackupService.restoreContacts('backup', 'password')).resolves.toMatchObject({
      success: false,
      error: 'contacts_corrupt',
    });

    mockedDecrypt.mockResolvedValueOnce(JSON.stringify([
      { name: 'Alice', lightningAddress: ' alice@example.com ', createdAt: 10 },
    ]));
    await expect(googleDriveBackupService.restoreContacts('backup', 'password')).resolves.toMatchObject({
      success: true,
      contacts: [{ name: 'Alice', lightningAddress: 'alice@example.com', id: 'backup-0', createdAt: 10, updatedAt: 10 }],
    });
  });

  it.each([
    ['offline fetch failure', () => Promise.reject(new Error('Network request failed')), 'Network request failed'],
    ['non-OK fetch response', () => Promise.resolve({ ok: false, status: 503 }), 'Failed to download backup'],
  ])('returns a useful error for %s', async (_label, fetchResult, expectedError) => {
    (global.fetch as jest.Mock).mockImplementationOnce(fetchResult);

    await expect(googleDriveBackupService.restoreContacts('backup', 'password')).resolves.toEqual({
      success: false,
      error: expectedError,
    });
  });
});
