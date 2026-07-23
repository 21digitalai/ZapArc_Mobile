import { cacheDirectory, copyAsync } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

export const QR_PNG_MIME_TYPE = 'image/png';
export const QR_GALLERY_ALBUM_NAME = 'ZapArc';

export type AndroidQrSaveResult = {
  status: 'saved';
  fileName: string;
  uri: string;
};

/**
 * Publishes a captured PNG through Android's scoped MediaStore-backed
 * gallery, without opening the Storage Access Framework directory picker or
 * asking to read the user's existing photos.
 */
export async function saveQrToAndroidGallery(
  sourceUri: string,
  fileName: string,
): Promise<AndroidQrSaveResult> {
  if (!cacheDirectory) throw new Error('Temporary storage is unavailable');

  // `captureRef` creates a temporary filename. Copying it first preserves the
  // user-visible QR filename when MediaStore creates the gallery asset.
  const namedPngUri = `${cacheDirectory}${fileName}`;
  await copyAsync({ from: sourceUri, to: namedPngUri });

  const album = await MediaLibrary.getAlbumAsync(QR_GALLERY_ALBUM_NAME);
  if (album) {
    const asset = await MediaLibrary.createAssetAsync(namedPngUri);
    await MediaLibrary.addAssetsToAlbumAsync(asset, album, false);
    return { status: 'saved', fileName, uri: asset.uri };
  }

  // Android cannot create an empty gallery album. Giving MediaStore the
  // first local PNG creates both the image asset and the ZapArc album.
  await MediaLibrary.createAlbumAsync(
    QR_GALLERY_ALBUM_NAME,
    undefined,
    false,
    namedPngUri,
  );
  return { status: 'saved', fileName, uri: namedPngUri };
}
