import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';

export type UploadKind = 'photo' | 'video' | 'document';

type Params = Record<string, string | number>;

/**
 * Cloudinary's request signature: parameters sorted by name, joined as k=v&k=v, the API
 * secret appended, then SHA-1. Used for uploads, deletes and private download links.
 */
export function signParams(params: Params, apiSecret: string): string {
  const base = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(base + apiSecret).digest('hex');
}

/** What each kind of upload may be; the app checks these first, Cloudinary enforces the formats. */
export const UPLOAD_RULES: Record<UploadKind, { resourceType: 'image' | 'video'; formats: string; maxBytes: number }> = {
  photo: { resourceType: 'image', formats: 'jpg,jpeg,png,webp,heic', maxBytes: 15 * 1024 * 1024 },
  video: { resourceType: 'video', formats: 'mp4,mov', maxBytes: 100 * 1024 * 1024 },
  // Documents are uploaded as "private": they can only be opened through a signed, expiring link.
  document: { resourceType: 'image', formats: 'jpg,jpeg,png,pdf', maxBytes: 10 * 1024 * 1024 },
};

export const MAX_VIDEO_SEC = 120;

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger('Cloudinary');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private get creds() {
    if (!this.config.cloudinary) {
      throw new AppError('UPLOAD_NOT_CONFIGURED', 'Uploads are not set up yet.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.config.cloudinary;
  }

  get cloudName() {
    return this.creds.cloudName;
  }

  folderFor(vendorId: string, kind: UploadKind) {
    return `eventseva/vendors/${vendorId}/${kind === 'document' ? 'docs' : 'media'}`;
  }

  /**
   * Everything the app needs for one direct upload to Cloudinary. The app must send exactly
   * `params` (plus the file, api_key and signature); changing any of them breaks the signature.
   */
  signUpload(vendorId: string, kind: UploadKind) {
    const { apiKey, apiSecret, cloudName } = this.creds;
    const rule = UPLOAD_RULES[kind];
    const params: Params = {
      allowed_formats: rule.formats,
      folder: this.folderFor(vendorId, kind),
      timestamp: Math.floor(Date.now() / 1000),
      ...(kind === 'document' ? { type: 'private' } : {}),
    };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${rule.resourceType}/upload`,
      cloudName,
      apiKey,
      params,
      signature: signParams(params, apiSecret),
      maxBytes: rule.maxBytes,
    };
  }

  /** Cloudinary signs its upload response; checking it proves the file really was uploaded. */
  verifyUploadResponse(publicId: string, version: number | string, signature: string): boolean {
    const expected = signParams({ public_id: publicId, version }, this.creds.apiSecret);
    return expected === String(signature ?? '').toLowerCase();
  }

  /** A link to a private document that works for `ttlSec` seconds (admin review only). */
  privateDownloadUrl(publicId: string, format: string, ttlSec = 600) {
    const { apiKey, apiSecret, cloudName } = this.creds;
    const now = Math.floor(Date.now() / 1000);
    const params: Params = { public_id: publicId, format, type: 'private', timestamp: now, expires_at: now + ttlSec };
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      api_key: apiKey,
      signature: signParams(params, apiSecret),
    });
    return `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${query}`;
  }

  /** Removes a file from Cloudinary. Best effort: a failure is logged and the row is still deleted. */
  async destroy(publicId: string, resourceType: 'image' | 'video', type: 'upload' | 'private' = 'upload') {
    try {
      const { apiKey, apiSecret, cloudName } = this.creds;
      const params: Params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), type, invalidate: 'true' };
      const body = new URLSearchParams({
        ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        api_key: apiKey,
        signature: signParams(params, apiSecret),
      });
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`destroy ${publicId} failed: ${res.status}`);
    } catch (err) {
      this.logger.warn(`destroy ${publicId} failed: ${(err as Error).message}`);
    }
  }
}
