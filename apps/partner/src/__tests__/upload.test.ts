/** Records what the code asked of the image manipulator, and fakes the resized file. */
jest.mock('expo-image-manipulator', () => {
  const manipulate = jest.fn((source: string | { width: number; height: number }) => {
    (globalThis as { __calls?: string[] }).__calls?.push('resize');
    let size = typeof source === 'string' ? { ...(globalThis as { __imageSize?: { width: number; height: number } }).__imageSize! } : { width: source.width, height: source.height };
    const ctx: { resize: jest.Mock; renderAsync: jest.Mock } = {
      resize: jest.fn((r: { width?: number; height?: number }) => {
        const ratio = r.width ? r.width / size.width : r.height! / size.height;
        size = { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) };
        return ctx;
      }),
      renderAsync: jest.fn(async () => ({
        ...size,
        saveAsync: jest.fn(async (opts: object) => {
          (globalThis as { __saved?: object }).__saved = opts;
          return { uri: 'file:///resized.jpg', ...size };
        }),
      })),
    };
    (globalThis as { __lastCtx?: typeof ctx }).__lastCtx = ctx;
    return ctx;
  });
  return { ImageManipulator: { manipulate }, SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } };
});

import type { UploadSignature } from '@eventseva/app-shared';
import { ApiError } from '@eventseva/app-shared';
import { ImageManipulator } from 'expo-image-manipulator';
import { checkFile, MAX_SIDE, resizePhoto, uploadDocument, uploadMedia, uploadToCloudinary, type UploadOptions } from '../lib/upload';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({ api: { post: jest.fn() } }));

const calls: string[] = [];
(globalThis as { __calls?: string[] }).__calls = calls;
const g = globalThis as { __imageSize?: { width: number; height: number }; __saved?: object; __lastCtx?: { resize: jest.Mock } };
const post = api.post as jest.Mock;
const manipulate = ImageManipulator.manipulate as unknown as jest.Mock;

const signature: UploadSignature = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/keidpig5/image/upload',
  cloudName: 'keidpig5',
  apiKey: '111222333',
  params: { folder: 'eventseva/vendors/v1/media', timestamp: 1767000000, allowed_formats: 'jpg,jpeg,png,webp,heic' },
  signature: 'a'.repeat(40),
  maxBytes: 15 * 1024 * 1024,
};

const cloudinaryResponse = {
  public_id: 'eventseva/vendors/v1/media/abc',
  version: 1767000001,
  signature: 'b'.repeat(40),
  width: 2000,
  height: 1500,
  bytes: 400_000,
  etag: 'etag-0123456789',
  format: 'jpg',
};

const photo = { uri: 'file:///photo.heic', type: 'photo' as const, width: 4000, height: 3000, fileSize: 6_000_000, mimeType: 'image/heic', fileName: 'photo.heic' };
const video = { uri: 'file:///clip.mp4', type: 'video' as const, width: 1920, height: 1080, fileSize: 30_000_000, mimeType: 'video/mp4', fileName: 'clip.mp4', durationMs: 41_600 };

/** A stand-in for XMLHttpRequest: each test scripts what Cloudinary does. */
class FakeXhr {
  static all: FakeXhr[] = [];
  static script: Array<(x: FakeXhr) => void> = [];
  method = '';
  url = '';
  body: unknown = null;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((e: Partial<ProgressEvent>) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
    calls.push('xhr.send');
    FakeXhr.all.push(this);
    const step = FakeXhr.script.shift();
    if (step) queueMicrotask(() => step(this));
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const ok = (body: object = cloudinaryResponse) => (x: FakeXhr) => {
  x.progress(50, 100);
  x.progress(100, 100);
  x.respond(200, body);
};
const opts = (extra: UploadOptions = {}): UploadOptions => ({ createXhr: () => new FakeXhr() as unknown as XMLHttpRequest, ...extra });

/** Everything appended to the FormData, in order. */
function captureForm() {
  const parts: Array<[string, unknown]> = [];
  jest.spyOn(FormData.prototype, 'append').mockImplementation((k: string, v: unknown) => {
    parts.push([k, v]);
  });
  return parts;
}

afterEach(() => {
  // Only the FormData spy is restored: the module mocks above keep their fakes.
  (FormData.prototype.append as jest.Mock & { mockRestore?: () => void }).mockRestore?.();
});

beforeEach(() => {
  post.mockReset();
  manipulate.mockClear();
  calls.length = 0;
  FakeXhr.all = [];
  FakeXhr.script = [];
  g.__imageSize = { width: 4000, height: 3000 };
  g.__saved = undefined;
  post.mockImplementation(async (path: string) => {
    calls.push(`post ${path}`);
    throw new Error(`unexpected ${path}`);
  });
});

/** api.post answers, in order, while still recording the call order. */
function answers(...values: unknown[]) {
  post.mockImplementation(async (path: string) => {
    calls.push(`post ${path}`);
    const v = values.shift();
    if (v instanceof Error) throw v;
    return v;
  });
}

describe('resizing before upload', () => {
  it('resizes a big photo to 2000 px on the long side, JPEG 0.8, before signing and uploading', async () => {
    const parts = captureForm();
    answers(signature, { id: 'm1', status: 'pending' });
    FakeXhr.script.push(ok());

    await uploadMedia(photo, opts());

    expect(calls).toEqual(['resize', 'post /v1/partner/uploads/sign', 'xhr.send', 'post /v1/partner/media']);
    expect(g.__lastCtx!.resize).toHaveBeenCalledWith({ width: MAX_SIDE });
    expect(g.__saved).toEqual({ compress: 0.8, format: 'jpeg' });
    // The resized file is what goes to Cloudinary, as a JPEG.
    expect(parts[0]).toEqual(['file', { uri: 'file:///resized.jpg', name: 'photo.jpg', type: 'image/jpeg' }]);
  });

  it('resizes portrait photos by height', async () => {
    g.__imageSize = { width: 3000, height: 4000 };
    const out = await resizePhoto({ ...photo, width: 3000, height: 4000 });
    expect(g.__lastCtx!.resize).toHaveBeenCalledWith({ height: MAX_SIDE });
    expect(out).toMatchObject({ uri: 'file:///resized.jpg', width: 1500, height: 2000, mimeType: 'image/jpeg', fileSize: null });
  });

  it('never upscales a small photo, but keeps its real size from the result', async () => {
    g.__imageSize = { width: 1200, height: 800 };
    const out = await resizePhoto({ ...photo, width: 1200, height: 800 });
    expect(g.__lastCtx!.resize).not.toHaveBeenCalled();
    expect(out).toMatchObject({ width: 1200, height: 800 });
  });

  it('checks the real size again when the picker had it rotated', async () => {
    // Picker says landscape, the decoded image is portrait 3000×4000.
    g.__imageSize = { width: 3000, height: 4000 };
    const out = await resizePhoto({ ...photo, width: 4000, height: 3000 });
    expect(Math.max(out.width, out.height)).toBe(MAX_SIDE);
  });

  it('uploads the original when the phone cannot read the image', async () => {
    manipulate.mockImplementationOnce(() => {
      throw new Error('cannot decode');
    });
    expect(await resizePhoto(photo)).toBe(photo);
  });

  it('does not resize videos', async () => {
    captureForm();
    answers({ ...signature, uploadUrl: signature.uploadUrl.replace('image', 'video'), maxBytes: 100 * 1024 * 1024 }, { id: 'm2' });
    FakeXhr.script.push(ok({ ...cloudinaryResponse, duration: 41.6 }));
    await uploadMedia(video, opts());
    expect(manipulate).not.toHaveBeenCalled();
    expect(post).toHaveBeenNthCalledWith(1, '/v1/partner/uploads/sign', { kind: 'video' });
    expect(post.mock.calls[1][1]).toMatchObject({ type: 'video', durationSec: 42 });
  });
});

describe('checks on the phone', () => {
  it('refuses a video over 2 minutes before anything is sent', async () => {
    await expect(uploadMedia({ ...video, durationMs: 150_000 }, opts())).rejects.toMatchObject({ code: 'VIDEO_TOO_LONG' });
    expect(post).not.toHaveBeenCalled();
    expect(FakeXhr.all).toHaveLength(0);
  });

  it('refuses a video over 100 MB before anything is sent', async () => {
    await expect(uploadMedia({ ...video, fileSize: 120 * 1024 * 1024 }, opts())).rejects.toMatchObject({ code: 'FILE_TOO_BIG', details: { maxBytes: 100 * 1024 * 1024 } });
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a photo or video', () => {
    expect(checkFile({ ...photo, mimeType: 'application/pdf' })).toMatchObject({ code: 'UNSUPPORTED_FILE' });
    expect(checkFile(photo)).toBeNull();
    expect(checkFile(video)).toBeNull();
  });

  it("refuses a file over the signature's maxBytes before the upload starts", async () => {
    answers(signature);
    await expect(uploadMedia({ ...video, fileSize: 20 * 1024 * 1024 }, opts())).rejects.toMatchObject({ code: 'FILE_TOO_BIG' });
    expect(FakeXhr.all).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('XHR upload to Cloudinary', () => {
  it('sends exactly the signed fields, reports progress, then registers the photo', async () => {
    const parts = captureForm();
    answers(signature, { id: 'm1', status: 'pending' });
    FakeXhr.script.push(ok());
    const progress: number[] = [];

    await uploadMedia(photo, opts({ onProgress: (p) => progress.push(p) }));

    const xhr = FakeXhr.all[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(signature.uploadUrl);
    // Every params key unchanged, plus file, api_key and signature — nothing else.
    expect(parts).toEqual([
      ['file', { uri: 'file:///resized.jpg', name: 'photo.jpg', type: 'image/jpeg' }],
      ['api_key', '111222333'],
      ['signature', signature.signature],
      ['folder', 'eventseva/vendors/v1/media'],
      ['timestamp', '1767000000'],
      ['allowed_formats', 'jpg,jpeg,png,webp,heic'],
    ]);
    expect(progress).toEqual([0, 0.5, 1, 1]);
    expect(post).toHaveBeenNthCalledWith(2, '/v1/partner/media', {
      publicId: cloudinaryResponse.public_id,
      version: cloudinaryResponse.version,
      signature: cloudinaryResponse.signature,
      type: 'photo',
      width: 2000,
      height: 1500,
      bytes: 400_000,
      etag: 'etag-0123456789',
    });
  });

  it('cancel aborts the request and nothing is registered', async () => {
    captureForm();
    answers(signature, { id: 'm1' });
    const controller = new AbortController();
    FakeXhr.script.push((x) => {
      x.progress(30, 100);
      controller.abort();
    });
    const progress: number[] = [];
    await expect(uploadMedia(photo, opts({ signal: controller.signal, onProgress: (p) => progress.push(p) }))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(FakeXhr.all[0].aborted).toBe(true);
    expect(progress).toContain(0.3);
    expect(post).toHaveBeenCalledTimes(1); // only the signature
  });

  it('a cancel before the upload starts sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadMedia(photo, opts({ signal: controller.signal }))).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(FakeXhr.all).toHaveLength(0);
  });

  it('retries when the connection drops', async () => {
    captureForm();
    answers(signature, { id: 'm1' });
    FakeXhr.script.push((x) => x.onerror?.(), ok());
    await uploadMedia(photo, opts());
    expect(FakeXhr.all).toHaveLength(2);
  });

  it('passes API errors through (e.g. MEDIA_DUPLICATE)', async () => {
    captureForm();
    answers(signature, new ApiError(409, 'MEDIA_DUPLICATE', 'You have already added this file.'));
    FakeXhr.script.push(ok());
    await expect(uploadMedia(photo, opts())).rejects.toMatchObject({ code: 'MEDIA_DUPLICATE' });
  });

  it('reports a Cloudinary error as UPLOAD_FAILED, and "too large" as FILE_TOO_BIG', async () => {
    captureForm();
    FakeXhr.script.push((x) => x.respond(401, { error: { message: 'Invalid Signature' } }));
    await expect(uploadToCloudinary(photo, signature, opts())).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    FakeXhr.script.push((x) => x.respond(400, { error: { message: 'File size too large' } }));
    await expect(uploadToCloudinary(photo, signature, opts())).rejects.toMatchObject({ code: 'FILE_TOO_BIG' });
  });
});

describe('uploadDocument', () => {
  it('resizes the photo and registers Aadhaar with only the last 4 digits', async () => {
    captureForm();
    answers({ ...signature, params: { ...signature.params, type: 'private' } }, { id: 'd1' });
    FakeXhr.script.push(ok());
    const progress: number[] = [];
    await uploadDocument(photo, 'aadhaar', '4821', opts({ onProgress: (p) => progress.push(p) }));
    expect(g.__lastCtx!.resize).toHaveBeenCalledWith({ width: MAX_SIDE });
    expect(progress).toContain(0.5);
    expect(post).toHaveBeenNthCalledWith(1, '/v1/partner/uploads/sign', { kind: 'document' });
    expect(post).toHaveBeenNthCalledWith(2, '/v1/partner/documents', {
      publicId: cloudinaryResponse.public_id,
      version: cloudinaryResponse.version,
      signature: cloudinaryResponse.signature,
      docType: 'aadhaar',
      format: 'jpg',
      last4: '4821',
    });
  });

  it('does not send last4 for other documents', async () => {
    captureForm();
    answers(signature, { id: 'd2' });
    FakeXhr.script.push(ok());
    await uploadDocument(photo, 'pan', '9999', opts());
    expect(post.mock.calls[1][1]).not.toHaveProperty('last4');
  });

  it('sends a PDF as it is (no resizing) and checks its size first', async () => {
    const pdf = { uri: 'file:///e-pan.pdf', type: 'photo' as const, width: 0, height: 0, fileSize: 800_000, mimeType: 'application/pdf', fileName: 'e-pan.pdf' };
    expect(checkFile(pdf, 'document')).toBeNull();
    expect(checkFile({ ...pdf, fileSize: 11 * 1024 * 1024 }, 'document')).toMatchObject({ code: 'FILE_TOO_BIG' });
    // A PDF is never accepted as a work photo.
    expect(checkFile(pdf, 'photo')).toMatchObject({ code: 'UNSUPPORTED_FILE' });

    captureForm();
    manipulate.mockClear();
    answers(signature, { id: 'd3' });
    FakeXhr.script.push((x) => x.respond(200, { ...cloudinaryResponse, format: 'pdf' }));
    await uploadDocument(pdf, 'pan', undefined, opts());
    expect(manipulate).not.toHaveBeenCalled();
    expect(post.mock.calls[1][1]).toMatchObject({ docType: 'pan', format: 'pdf' });
  });
});
