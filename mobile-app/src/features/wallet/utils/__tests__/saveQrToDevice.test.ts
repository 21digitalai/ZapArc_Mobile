jest.mock('expo-file-system', () => ({
  __esModule: true,
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: jest.fn(),
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
  },
}));

import { QR_PNG_MIME_TYPE, saveQrToAndroidDirectory } from '../saveQrToDevice';

const fileSystem = jest.requireMock('expo-file-system');
const mockRequestDirectoryPermissionsAsync = fileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync as jest.Mock;
const mockReadAsStringAsync = fileSystem.readAsStringAsync as jest.Mock;
const mockCreateFileAsync = fileSystem.StorageAccessFramework.createFileAsync as jest.Mock;
const mockWriteAsStringAsync = fileSystem.StorageAccessFramework.writeAsStringAsync as jest.Mock;

describe('saveQrToAndroidDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestDirectoryPermissionsAsync.mockResolvedValue({ granted: true, directoryUri: 'content://downloads' });
    mockReadAsStringAsync.mockResolvedValue('iVBORw0KGgo=');
    mockCreateFileAsync.mockResolvedValue('content://downloads/zaparc-lightning-qr-1.png');
    mockWriteAsStringAsync.mockResolvedValue(undefined);
  });

  it('writes the captured PNG to the user-selected directory with PNG metadata', async () => {
    await expect(saveQrToAndroidDirectory('file:///tmp/qr.png', 'zaparc-lightning-qr-1.png'))
      .resolves.toEqual({ status: 'saved', fileName: 'zaparc-lightning-qr-1.png', uri: 'content://downloads/zaparc-lightning-qr-1.png' });

    expect(mockCreateFileAsync).toHaveBeenCalledWith('content://downloads', 'zaparc-lightning-qr-1.png', QR_PNG_MIME_TYPE);
    expect(mockWriteAsStringAsync).toHaveBeenCalledWith('content://downloads/zaparc-lightning-qr-1.png', 'iVBORw0KGgo=', { encoding: 'base64' });
  });

  it('treats closing the picker as cancellation without reading or writing', async () => {
    mockRequestDirectoryPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(saveQrToAndroidDirectory('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .resolves.toEqual({ status: 'cancelled' });
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
    expect(mockCreateFileAsync).not.toHaveBeenCalled();
    expect(mockWriteAsStringAsync).not.toHaveBeenCalled();
  });

  it('surfaces write failures to the caller', async () => {
    mockWriteAsStringAsync.mockRejectedValue(new Error('write failed'));
    await expect(saveQrToAndroidDirectory('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .rejects.toThrow('write failed');
  });
});
