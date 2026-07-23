jest.mock('react-native', () => ({
  NativeModules: {
    ZapArcMediaStore: { savePngToZapArcAlbum: jest.fn() },
  },
  Platform: { OS: 'android' },
}));

import { QR_GALLERY_ALBUM_NAME, QR_PNG_MIME_TYPE, saveQrToAndroidGallery } from '../saveQrToDevice';

const mediaStore = jest.requireMock('react-native').NativeModules.ZapArcMediaStore;

describe('saveQrToAndroidGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mediaStore.savePngToZapArcAlbum.mockResolvedValue('content://media/external/images/media/1');
  });

  it('inserts the first named PNG into the ZapArc gallery without a directory picker or gallery read', async () => {
    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-lightning-qr-1.png'))
      .resolves.toEqual({ status: 'saved', fileName: 'zaparc-lightning-qr-1.png', uri: 'content://media/external/images/media/1' });

    expect(mediaStore.savePngToZapArcAlbum).toHaveBeenCalledWith('file:///tmp/qr.png', 'zaparc-lightning-qr-1.png');
  });

  it('reuses the MediaStore ZapArc target for later PNGs', async () => {
    mediaStore.savePngToZapArcAlbum.mockResolvedValue('content://media/external/images/media/2');

    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .resolves.toEqual({ status: 'saved', fileName: 'zaparc-onchain-qr-1.png', uri: 'content://media/external/images/media/2' });

    expect(mediaStore.savePngToZapArcAlbum).toHaveBeenCalledWith('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png');
  });

  it('surfaces gallery write failures', async () => {
    mediaStore.savePngToZapArcAlbum.mockRejectedValue(new Error('gallery write failed'));
    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .rejects.toThrow('gallery write failed');
  });

  it('keeps PNG metadata explicit at the adapter boundary', () => {
    expect(QR_PNG_MIME_TYPE).toBe('image/png');
  });
});
