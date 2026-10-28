// The driving-licence photo: picked from the phone, uploaded straight to Cloudinary as a private
// file with a signature from our API, then sent with the licence details (the API checks Cloudinary's
// signed reply, so only the customer's own upload is accepted).
import * as ImagePicker from 'expo-image-picker';
import type { CloudinaryUploadResult, UploadSignature } from '@eventseva/app-shared';
import { api } from './api';

export interface LicencePhoto {
  publicId: string;
  version: number;
  signature: string;
  format: string;
}

export class LicencePhotoError extends Error {
  constructor(readonly code: 'FILE_TOO_BIG' | 'UPLOAD_FAILED') {
    super(code);
  }
}

/** null when the customer closes the picker. */
export async function pickAndUploadLicence(): Promise<LicencePhoto | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (picked.canceled || !picked.assets.length) return null;
  const a = picked.assets[0];
  const sig = await api.signLicencePhoto();
  if (a.fileSize && a.fileSize > sig.maxBytes) throw new LicencePhotoError('FILE_TOO_BIG');
  return uploadSigned({ uri: a.uri, name: a.fileName ?? 'licence.jpg', type: a.mimeType ?? 'image/jpeg' }, sig);
}

/** POSTs the file with exactly the signed params (changing any of them breaks the signature). */
export async function uploadSigned(file: { uri: string; name: string; type: string }, sig: UploadSignature, doFetch: typeof fetch = fetch): Promise<LicencePhoto> {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  form.append('api_key', sig.apiKey);
  form.append('signature', sig.signature);
  for (const [k, v] of Object.entries(sig.params)) form.append(k, String(v));
  const res = await doFetch(sig.uploadUrl, { method: 'POST', body: form });
  const json = (await res.json().catch(() => null)) as (CloudinaryUploadResult & { error?: unknown }) | null;
  if (!res.ok || !json || json.error) throw new LicencePhotoError('UPLOAD_FAILED');
  return { publicId: json.public_id, version: json.version, signature: json.signature, format: json.format === 'jpeg' ? 'jpg' : json.format };
}
