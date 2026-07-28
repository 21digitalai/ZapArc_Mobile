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
});
