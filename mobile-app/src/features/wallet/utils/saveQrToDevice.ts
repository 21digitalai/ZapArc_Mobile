import {
  EncodingType,
  readAsStringAsync,
  StorageAccessFramework,
} from 'expo-file-system';

export const QR_PNG_MIME_TYPE = 'image/png';

export type AndroidQrSaveResult =
  | { status: 'saved'; fileName: string; uri: string }
  | { status: 'cancelled' };

/**
 * Saves a captured QR PNG through Android's Storage Access Framework. The
 * platform picker grants access only to the directory selected by the user,
 * so no broad external-storage permission is needed.
 */
export async function saveQrToAndroidDirectory(
  sourceUri: string,
  fileName: string,
): Promise<AndroidQrSaveResult> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { status: 'cancelled' };

  const base64Png = await readAsStringAsync(sourceUri, {
    encoding: EncodingType.Base64,
  });
  const destinationUri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    fileName,
    QR_PNG_MIME_TYPE,
  );
  await StorageAccessFramework.writeAsStringAsync(destinationUri, base64Png, {
    encoding: EncodingType.Base64,
  });

  return { status: 'saved', fileName, uri: destinationUri };
}
