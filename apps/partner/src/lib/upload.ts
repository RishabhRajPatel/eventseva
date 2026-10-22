// Signed direct upload to Cloudinary. The API signs the request (its secret never reaches the
// phone), the phone sends the file straight to Cloudinary, then registers the result with the API.
import type { CloudinaryUploadResult, DocType, Media, UploadKind, UploadSignature, VendorDocument } from '@eventseva/app-shared';
import { api } from './api';
import { errorCode } from './errors';

export interface PickedFile {
  uri: string;
  type: 'photo' | 'video';
  width: number;
  height: number;
  /** From the picker when known; checked against the server's limit before uploading. */
  fileSize?: number | null;
  mimeType?: string | null;
  fileName?: string | null;
}

/** Upload problems found on the phone or reported by Cloudinary (API errors stay ApiError). */
export class UploadError extends Error {
  constructor(
    readonly code: 'FILE_TOO_BIG' | 'UPLOAD_FAILED' | 'NETWORK',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

const NETWORK_RETRIES = 2;

/** Runs `fn` again (up to twice) when the connection dropped; other errors go straight out. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (errorCode(e) !== 'NETWORK' || attempt >= NETWORK_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

export const signUpload = (kind: UploadKind) => withRetry(() => api.post<UploadSignature>('/v1/partner/uploads/sign', { kind }));

function filePart(file: PickedFile) {
  const fallbackType = file.type === 'video' ? 'video/mp4' : 'image/jpeg';
  const type = file.mimeType || fallbackType;
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return { uri: file.uri, name: file.fileName || `upload.${ext}`, type };
}

/**
 * POSTs the file to Cloudinary with exactly the signed params. Any change to `params`
 * (renaming, adding, reformatting a value) breaks the signature, so they are copied as-is.
 */
export async function uploadToCloudinary(file: PickedFile, sig: UploadSignature, fetchImpl: typeof fetch = fetch): Promise<CloudinaryUploadResult> {
  if (file.fileSize && file.fileSize > sig.maxBytes) {
    throw new UploadError('FILE_TOO_BIG', 'This file is too big.', { maxBytes: sig.maxBytes });
  }
  const form = new FormData();
  // React Native sends {uri, name, type} as a file part.
  form.append('file', filePart(file) as unknown as Blob);
  form.append('api_key', sig.apiKey);
  form.append('signature', sig.signature);
  for (const [key, value] of Object.entries(sig.params)) form.append(key, String(value));

  const res = await withRetry(async () => {
    try {
      return await fetchImpl(sig.uploadUrl, { method: 'POST', body: form });
    } catch {
      throw new UploadError('NETWORK', 'No internet connection.');
    }
  });
  const json = (await res.json().catch(() => null)) as (CloudinaryUploadResult & { error?: { message?: string } }) | null;
  if (!res.ok || !json || json.error) {
    const message = json?.error?.message ?? '';
    if (/too large|file size/i.test(message)) throw new UploadError('FILE_TOO_BIG', message, { maxBytes: sig.maxBytes });
    throw new UploadError('UPLOAD_FAILED', message || 'Upload failed.');
  }
  return json;
}

/** Uploads one photo or video and registers it; it then waits for the team's review. */
export async function uploadMedia(file: PickedFile, fetchImpl?: typeof fetch): Promise<Media> {
  const sig = await signUpload(file.type);
  const r = await uploadToCloudinary(file, sig, fetchImpl);
  return withRetry(() =>
    api.post<Media>('/v1/partner/media', {
      publicId: r.public_id,
      version: r.version,
      signature: r.signature,
      type: file.type,
      width: r.width ?? file.width,
      height: r.height ?? file.height,
      bytes: r.bytes,
      etag: r.etag,
      ...(file.type === 'video' ? { durationSec: Math.round(r.duration ?? 0) } : {}),
    }),
  );
}

/** Uploads a private verification document. For Aadhaar only the last 4 digits are sent. */
export async function uploadDocument(file: PickedFile, docType: DocType, last4?: string, fetchImpl?: typeof fetch): Promise<VendorDocument> {
  const sig = await signUpload('document');
  const r = await uploadToCloudinary(file, sig, fetchImpl);
  return withRetry(() =>
    api.post<VendorDocument>('/v1/partner/documents', {
      publicId: r.public_id,
      version: r.version,
      signature: r.signature,
      docType,
      format: r.format,
      ...(docType === 'aadhaar' ? { last4 } : {}),
    }),
  );
}
