import { decryptStringBlob, encryptStringBlob } from '../backupEncryption';

describe('contacts backup encryption', () => {
  const password = 'CorrectHorseBattery9';
  const contactsJson = JSON.stringify([{ name: 'Alice', lightningAddress: 'alice@example.com' }]);

  it('uses a self-contained authenticated AES-GCM blob for contacts', async () => {
    const blob = await encryptStringBlob(contactsJson, password);

    expect(blob).toMatchObject({ format: 'aes-256-gcm' });
    expect(blob.salt).not.toBe(blob.iv);
    await expect(decryptStringBlob(blob, password)).resolves.toBe(contactsJson);
  });

  it('rejects a wrong password and authenticated-ciphertext tampering', async () => {
    const blob = await encryptStringBlob(contactsJson, password);
    const tampered = { ...blob, ciphertext: `${blob.ciphertext.slice(0, -2)}AA` };

    await expect(decryptStringBlob(blob, 'WrongPassword9')).rejects.toThrow();
    await expect(decryptStringBlob(tampered, password)).rejects.toThrow();
  });
});
