jest.mock('expo-file-system', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn(),
}));
jest.mock('expo-media-library', () => ({
  getAlbumAsync: jest.fn(),
  createAssetAsync: jest.fn(),
  addAssetsToAlbumAsync: jest.fn(),
  createAlbumAsync: jest.fn(),
}));

import { QR_GALLERY_ALBUM_NAME, QR_PNG_MIME_TYPE, saveQrToAndroidGallery } from '../saveQrToDevice';

const fileSystem = jest.requireMock('expo-file-system');
const mediaLibrary = jest.requireMock('expo-media-library');

describe('saveQrToAndroidGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mediaLibrary.getAlbumAsync.mockResolvedValue(null);
    mediaLibrary.createAlbumAsync.mockResolvedValue({ id: 'zaparc-album' });
  });

  it('creates the ZapArc gallery album with the first named PNG without a directory picker', async () => {
    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-lightning-qr-1.png'))
      .resolves.toEqual({ status: 'saved', fileName: 'zaparc-lightning-qr-1.png', uri: 'file:///cache/zaparc-lightning-qr-1.png' });

    expect(fileSystem.copyAsync).toHaveBeenCalledWith({ from: 'file:///tmp/qr.png', to: 'file:///cache/zaparc-lightning-qr-1.png' });
    expect(mediaLibrary.createAlbumAsync).toHaveBeenCalledWith(QR_GALLERY_ALBUM_NAME, undefined, false, 'file:///cache/zaparc-lightning-qr-1.png');
    expect(mediaLibrary.createAssetAsync).not.toHaveBeenCalled();
  });

  it('adds later PNGs to the existing ZapArc album without copying a second gallery asset', async () => {
    const album = { id: 'zaparc-album' };
    const asset = { id: 'asset-1', uri: 'file:///gallery/zaparc-onchain-qr-1.png', filename: 'zaparc-onchain-qr-1.png', mediaType: 'photo' };
    mediaLibrary.getAlbumAsync.mockResolvedValue(album);
    mediaLibrary.createAssetAsync.mockResolvedValue(asset);

    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .resolves.toEqual({ status: 'saved', fileName: 'zaparc-onchain-qr-1.png', uri: asset.uri });

    expect(mediaLibrary.createAssetAsync).toHaveBeenCalledWith('file:///cache/zaparc-onchain-qr-1.png');
    expect(mediaLibrary.addAssetsToAlbumAsync).toHaveBeenCalledWith(asset, album, false);
  });

  it('surfaces gallery write failures', async () => {
    mediaLibrary.getAlbumAsync.mockRejectedValue(new Error('gallery write failed'));
    await expect(saveQrToAndroidGallery('file:///tmp/qr.png', 'zaparc-onchain-qr-1.png'))
      .rejects.toThrow('gallery write failed');
  });

  it('keeps PNG metadata explicit at the adapter boundary', () => {
    expect(QR_PNG_MIME_TYPE).toBe('image/png');
  });
});
