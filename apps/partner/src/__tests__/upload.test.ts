import type { UploadSignature } from '@eventseva/app-shared';
import { ApiError } from '@eventseva/app-shared';
import { uploadDocument, uploadMedia, uploadToCloudinary } from '../lib/upload';
import { api } from '../lib/api';

jest.mock('../lib/api', () => ({ api: { post: jest.fn() } }));
const post = api.post as jest.Mock;

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
  width: 1600,
  height: 1200,
  bytes: 400_000,
  etag: 'etag-0123456789',
  format: 'jpg',
};

const photo = { uri: 'file:///photo.jpg', type: 'photo' as const, width: 4000, height: 3000, fileSize: 400_000, mimeType: 'image/jpeg', fileName: 'photo.jpg' };

/** Everything appended to the FormData, in order. */
function captureForm() {
  const parts: Array<[string, unknown]> = [];
  jest.spyOn(FormData.prototype, 'append').mockImplementation((k: string, v: unknown) => {
    parts.push([k, v]);
  });
  return parts;
}

const okFetch = (body: object) => jest.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);

beforeEach(() => {
  jest.restoreAllMocks();
  post.mockReset();
});

describe('uploadMedia', () => {
  it('signs, sends exactly the signed params to Cloudinary, then registers the photo', async () => {
    const parts = captureForm();
    const fetchImpl = okFetch(cloudinaryResponse);
    post.mockResolvedValueOnce(signature).mockResolvedValueOnce({ id: 'm1', status: 'pending' });

    await uploadMedia(photo, fetchImpl);

    expect(post).toHaveBeenNthCalledWith(1, '/v1/partner/uploads/sign', { kind: 'photo' });
    expect(fetchImpl).toHaveBeenCalledWith(signature.uploadUrl, expect.objectContaining({ method: 'POST' }));
    expect(parts).toEqual([
      ['file', { uri: photo.uri, name: 'photo.jpg', type: 'image/jpeg' }],
      ['api_key', '111222333'],
      ['signature', signature.signature],
      ['folder', 'eventseva/vendors/v1/media'],
      ['timestamp', '1767000000'],
      ['allowed_formats', 'jpg,jpeg,png,webp,heic'],
    ]);
    expect(post).toHaveBeenNthCalledWith(2, '/v1/partner/media', {
      publicId: cloudinaryResponse.public_id,
      version: cloudinaryResponse.version,
      signature: cloudinaryResponse.signature,
      type: 'photo',
      width: 1600,
      height: 1200,
      bytes: 400_000,
      etag: 'etag-0123456789',
    });
  });

  it('sends a rounded duration for videos', async () => {
    captureForm();
    post.mockResolvedValueOnce({ ...signature, uploadUrl: signature.uploadUrl.replace('image', 'video') }).mockResolvedValueOnce({ id: 'm2' });
    await uploadMedia({ ...photo, type: 'video', mimeType: 'video/mp4', fileName: null }, okFetch({ ...cloudinaryResponse, duration: 41.6 }));
    expect(post).toHaveBeenNthCalledWith(1, '/v1/partner/uploads/sign', { kind: 'video' });
    expect(post.mock.calls[1][1]).toMatchObject({ type: 'video', durationSec: 42 });
  });

  it('refuses a file over maxBytes before uploading anything', async () => {
    const fetchImpl = jest.fn();
    post.mockResolvedValueOnce(signature);
    await expect(uploadMedia({ ...photo, fileSize: 20 * 1024 * 1024 }, fetchImpl)).rejects.toMatchObject({ code: 'FILE_TOO_BIG' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries the Cloudinary upload when the connection drops', async () => {
    captureForm();
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ ok: true, json: async () => cloudinaryResponse } as Response);
    post.mockResolvedValueOnce(signature).mockResolvedValueOnce({ id: 'm1' });
    await uploadMedia(photo, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('passes API errors through (e.g. MEDIA_DUPLICATE)', async () => {
    captureForm();
    post.mockResolvedValueOnce(signature).mockRejectedValueOnce(new ApiError(409, 'MEDIA_DUPLICATE', 'You have already added this file.'));
    await expect(uploadMedia(photo, okFetch(cloudinaryResponse))).rejects.toMatchObject({ code: 'MEDIA_DUPLICATE' });
  });

  it('reports a Cloudinary error as UPLOAD_FAILED', async () => {
    captureForm();
    post.mockResolvedValueOnce(signature);
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Invalid Signature' } }) } as Response);
    await expect(uploadToCloudinary(photo, signature, fetchImpl)).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
  });
});

describe('uploadDocument', () => {
  it('registers Aadhaar with only the last 4 digits', async () => {
    captureForm();
    post.mockResolvedValueOnce({ ...signature, params: { ...signature.params, type: 'private' } }).mockResolvedValueOnce({ id: 'd1' });
    await uploadDocument(photo, 'aadhaar', '4821', okFetch(cloudinaryResponse));
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
    post.mockResolvedValueOnce(signature).mockResolvedValueOnce({ id: 'd2' });
    await uploadDocument(photo, 'pan', '9999', okFetch(cloudinaryResponse));
    expect(post.mock.calls[1][1]).not.toHaveProperty('last4');
  });
});
