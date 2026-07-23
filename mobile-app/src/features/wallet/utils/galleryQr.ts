import * as ImagePicker from 'expo-image-picker';
import { scanFromURLAsync } from 'expo-camera';

export type GalleryQrResult = { kind: 'cancelled' | 'missing' | 'empty' | 'multiple' } | { kind: 'payload'; payload: string };

export async function pickSingleGalleryQr(): Promise<GalleryQrResult> {
  const image = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, selectionLimit: 1 });
  if (image.canceled) return { kind: 'cancelled' };
  const asset = image.assets[0];
  if (!asset || !asset.uri) return { kind: 'missing' };
  const payloads = Array.from(new Set((await scanFromURLAsync(asset.uri, ['qr'])).map((item) => item.data).filter(Boolean)));
  if (!payloads.length) return { kind: 'empty' };
  if (payloads.length > 1) return { kind: 'multiple' };
  return { kind: 'payload', payload: payloads[0] };
}
