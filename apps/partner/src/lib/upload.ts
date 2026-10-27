// Signed direct upload to Cloudinary. The API signs the request (its secret never reaches the
// phone), the phone sends the file straight to Cloudinary, then registers the result with the API.
//
// Before sending: photos are resized on the phone (≤ 2000 px, JPEG 0.8) and type, size and video
// length are checked, so a vendor on 4G never waits for an upload that was going to fail.
// While sending: XMLHttpRequest, because fetch has no upload progress; it can be cancelled.
import { ImageManipulator, SaveFormat, type ImageManipulatorContext, type ImageRef } from 'expo-image-manipulator';
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
  /** Video length in milliseconds, from the picker. */
  durationMs?: number | null;
}

/** Same limits as the API (docs/API.md, "Photos, videos and documents"). */
export const MAX_BYTES: Record<UploadKind, number> = {
  photo: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 10 * 1024 * 1024,
};
export const MAX_VIDEO_SEC = 120;
/** Longest side of a photo after resizing on the phone, and its JPEG quality. */
export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.8;

export type UploadErrorCode = 'FILE_TOO_BIG' | 'UPLOAD_FAILED' | 'NETWORK' | 'CANCELLED' | 'VIDEO_TOO_LONG' | 'UNSUPPORTED_FILE' | 'LIMIT_REACHED';

/** Upload problems found on the phone or reported by Cloudinary (API errors stay ApiError). */
export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export type UploadStage = 'preparing' | 'uploading' | 'saving';

export interface UploadOptions {
  /** 0…1 while the file goes to Cloudinary. */
  onProgress?: (fraction: number) => void;
  onStage?: (stage: UploadStage) => void;
  /** Aborting it cancels the upload (`xhr.abort()`). */
  signal?: AbortSignal;
  /** For tests. */
  createXhr?: () => XMLHttpRequest;
}

const cancelled = () => new UploadError('CANCELLED', 'Upload cancelled.');

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
}

const NETWORK_RETRIES = 2;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(id);
      reject(cancelled());
    }
    signal?.addEventListener?.('abort', onAbort);
  });
}

/** Runs `fn` again (up to twice) when the connection dropped; other errors go straight out. */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn();
    } catch (e) {
      if (errorCode(e) !== 'NETWORK' || attempt >= NETWORK_RETRIES || signal?.aborted) throw e;
      await wait(800 * (attempt + 1), signal);
    }
  }
}

/**
 * What can be refused on the phone, before anything is sent: wrong file type, too big, video too long.
 * Photos are not size-checked here because resizing makes them far smaller.
 */
export function checkFile(file: PickedFile, kind: UploadKind = file.type): UploadError | null {
  const mime = file.mimeType ?? '';
  const wantVideo = kind === 'video';
  // Documents may also be a PDF; it is not resized, so its size is checked here.
  if (kind === 'document' && isPdf(file)) {
    if (file.fileSize && file.fileSize > MAX_BYTES.document) {
      return new UploadError('FILE_TOO_BIG', 'This file is too big.', { maxBytes: MAX_BYTES.document });
    }
    return null;
  }
  if (mime && !mime.startsWith(wantVideo ? 'video/' : 'image/')) {
    return new UploadError('UNSUPPORTED_FILE', 'This type of file cannot be added.', { kind });
  }
  if (wantVideo) {
    if (file.durationMs && file.durationMs / 1000 > MAX_VIDEO_SEC + 0.5) {
      return new UploadError('VIDEO_TOO_LONG', 'Videos can be up to 2 minutes long.', { maxSec: MAX_VIDEO_SEC });
    }
    if (file.fileSize && file.fileSize > MAX_BYTES.video) {
      return new UploadError('FILE_TOO_BIG', 'This file is too big.', { maxBytes: MAX_BYTES.video });
    }
  }
  return null;
}

export const isPdf = (file: Pick<PickedFile, 'mimeType' | 'fileName'>) =>
  file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.fileName ?? '');

const jpgName = (name?: string | null) => (name ? `${name.replace(/\.[^.]+$/, '')}.jpg` : null);

/**
 * Resizes a photo so its long side is at most 2000 px (never upscaled) and saves it as JPEG 0.8:
 * 5–10× smaller than a camera original. If the phone cannot read the image, the original is used.
 */
export async function resizePhoto(file: PickedFile): Promise<PickedFile> {
  const release = (o: unknown) => (o as { release?: () => void } | null)?.release?.();
  let ctx: ImageManipulatorContext | null = null;
  let ref: ImageRef | null = null;
  try {
    ctx = ImageManipulator.manipulate(file.uri);
    const long = Math.max(file.width, file.height);
    if (long > MAX_SIDE) ctx = ctx.resize(file.width >= file.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    ref = await ctx.renderAsync();
    // The picker's size can be before EXIF rotation: check the real image once more.
    if (Math.max(ref.width, ref.height) > MAX_SIDE) {
      const again = ImageManipulator.manipulate(ref).resize(ref.width >= ref.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
      const smaller = await again.renderAsync();
      release(again);
      release(ref);
      ref = smaller;
    }
    const out = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
    return { ...file, uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg', fileName: jpgName(file.fileName), fileSize: null };
  } catch {
    return file;
  } finally {
    release(ref);
    release(ctx);
  }
}

export const signUpload = (kind: UploadKind, signal?: AbortSignal) => withRetry(() => api.post<UploadSignature>('/v1/partner/uploads/sign', { kind }), signal);

function filePart(file: PickedFile) {
  const fallbackType = file.type === 'video' ? 'video/mp4' : 'image/jpeg';
  const type = file.mimeType || fallbackType;
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return { uri: file.uri, name: file.fileName || `upload.${ext}`, type };
}

/** One multipart POST with upload progress; resolves with the status and raw body. */
function postWithProgress(url: string, form: FormData, opts: UploadOptions): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(opts.signal);
    const xhr = opts.createXhr ? opts.createXhr() : new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => opts.signal?.removeEventListener?.('abort', onAbort);
    opts.signal?.addEventListener?.('abort', onAbort);
    xhr.open('POST', url);
    if (xhr.upload) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, body: xhr.responseText });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new UploadError('NETWORK', 'No internet connection.'));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      cleanup();
      reject(cancelled());
    };
    xhr.send(form);
  });
}

/**
 * POSTs the file to Cloudinary with exactly the signed params. Any change to `params`
 * (renaming, adding, reformatting a value) breaks the signature, so they are copied as-is.
 */
export async function uploadToCloudinary(file: PickedFile, sig: UploadSignature, opts: UploadOptions = {}): Promise<CloudinaryUploadResult> {
  if (file.fileSize && file.fileSize > sig.maxBytes) {
    throw new UploadError('FILE_TOO_BIG', 'This file is too big.', { maxBytes: sig.maxBytes });
  }
  const form = new FormData();
  // React Native sends {uri, name, type} as a file part.
  form.append('file', filePart(file) as unknown as Blob);
  form.append('api_key', sig.apiKey);
  form.append('signature', sig.signature);
  for (const [key, value] of Object.entries(sig.params)) form.append(key, String(value));

  opts.onStage?.('uploading');
  const res = await withRetry(() => {
    opts.onProgress?.(0);
    return postWithProgress(sig.uploadUrl, form, opts);
  }, opts.signal);
  let json: (CloudinaryUploadResult & { error?: { message?: string } }) | null = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    json = null;
  }
  const ok = res.status >= 200 && res.status < 300;
  if (!ok || !json || json.error) {
    const message = json?.error?.message ?? '';
    if (/too large|file size/i.test(message)) throw new UploadError('FILE_TOO_BIG', message, { maxBytes: sig.maxBytes });
    throw new UploadError('UPLOAD_FAILED', message || 'Upload failed.');
  }
  opts.onProgress?.(1);
  return json;
}

/** Checks, resizes (photos), signs and uploads one file. */
async function send(file: PickedFile, kind: UploadKind, opts: UploadOptions) {
  const problem = checkFile(file, kind);
  if (problem) throw problem;
  opts.onStage?.('preparing');
  const prepared = file.type === 'photo' && !isPdf(file) ? await resizePhoto(file) : file;
  throwIfAborted(opts.signal);
  const sig = await signUpload(kind, opts.signal);
  throwIfAborted(opts.signal);
  const result = await uploadToCloudinary(prepared, sig, opts);
  throwIfAborted(opts.signal);
  opts.onStage?.('saving');
  return { prepared, result };
}

/**
 * Uploads one photo or video and registers it; it then waits for the team's review. With `itemId`
 * it is a photo of that rental item instead of a gallery photo.
 */
export async function uploadMedia(file: PickedFile, opts: UploadOptions = {}, itemId?: string): Promise<Media> {
  const { prepared, result: r } = await send(file, file.type, opts);
  return withRetry(() =>
    api.post<Media>('/v1/partner/media', {
      publicId: r.public_id,
      version: r.version,
      signature: r.signature,
      type: file.type,
      width: r.width ?? prepared.width,
      height: r.height ?? prepared.height,
      bytes: r.bytes,
      etag: r.etag,
      ...(file.type === 'video' ? { durationSec: Math.round(r.duration ?? (file.durationMs ?? 0) / 1000) } : {}),
      ...(itemId ? { itemId } : {}),
    }),
  );
}

export interface SignedPhoto {
  publicId: string;
  version: number;
  signature: string;
}

/**
 * A photo kept with a delivery or return record (not reviewed, not in the gallery). Returns Cloudinary's
 * signed reply, which the server checks so only the vendor's own uploads are accepted.
 */
export async function uploadEvidencePhoto(file: PickedFile, opts: UploadOptions = {}): Promise<SignedPhoto> {
  const { result } = await send(file, 'photo', opts);
  return { publicId: result.public_id, version: result.version, signature: result.signature };
}

/** Uploads a private verification document (a photo or a PDF). For Aadhaar only the last 4 digits are sent. */
export async function uploadDocument(file: PickedFile, docType: DocType, last4?: string, opts: UploadOptions = {}): Promise<VendorDocument> {
  const { result: r } = await send({ ...file, type: 'photo' }, 'document', opts);
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

/** RC, insurance, permit, PUC of a vehicle, or a driver's licence / police verification: private, like KYC. */
export async function uploadResourceDocument(file: PickedFile, resourceId: string, docType: string, opts: UploadOptions = {}): Promise<{ id: string; docType: string; status: string }> {
  const { result: r } = await send({ ...file, type: 'photo' }, 'document', opts);
  return withRetry(() =>
    api.post<{ id: string; docType: string; status: string }>(`/v1/partner/resources/${resourceId}/documents`, {
      publicId: r.public_id,
      version: r.version,
      signature: r.signature,
      docType,
      format: r.format,
    }),
  );
}
