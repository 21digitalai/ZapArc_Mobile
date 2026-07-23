import { NativeModules, Platform } from 'react-native';

export const QR_PNG_MIME_TYPE = 'image/png';
export const QR_GALLERY_ALBUM_NAME = 'ZapArc';

export type AndroidQrSaveResult = {
  status: 'saved';
  fileName: string;
  uri: string;
};

type ZapArcMediaStoreModule = {
  savePngToZapArcAlbum(sourceUri: string, fileName: string): Promise<string>;
};

const mediaStoreModule = NativeModules.ZapArcMediaStore as ZapArcMediaStoreModule | undefined;

/**
 * Publishes a captured PNG through Android's write-only MediaStore API.
 * The native module inserts directly into Pictures/ZapArc without querying
 * the user's library, so it needs no photo-read permission or folder picker.
 */
export async function saveQrToAndroidGallery(
  sourceUri: string,
  fileName: string,
): Promise<AndroidQrSaveResult> {
  if (Platform.OS !== 'android') {
    throw new Error('Gallery saving is only available on Android');
  }

  if (!mediaStoreModule) {
    throw new Error('Gallery saving is unavailable in this app build');
  }

  const uri = await mediaStoreModule.savePngToZapArcAlbum(sourceUri, fileName);
  return { status: 'saved', fileName, uri };
}
