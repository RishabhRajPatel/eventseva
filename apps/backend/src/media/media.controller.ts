import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { PartnerAppGuard } from '../partner/partner.controller';
import { CloudinaryService, MAX_VIDEO_SEC, UPLOAD_RULES, type UploadKind } from './cloudinary.service';

export const MAX_PHOTOS = 30;
export const MAX_VIDEOS = 5;
const DOC_TYPES = ['aadhaar', 'pan', 'gst', 'shop_photo'] as const;

class SignDto {
  @IsIn(['photo', 'video', 'document']) kind: UploadKind;
}

/** Fields copied from Cloudinary's upload response. */
class UploadedDto {
  @IsString() @MaxLength(255) publicId: string;
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/^[0-9a-f]{40}$/i) signature: string;
}

class RegisterMediaDto extends UploadedDto {
  @IsIn(['photo', 'video']) type: 'photo' | 'video';
  @IsInt() @Min(1) @Max(20_000) width: number;
  @IsInt() @Min(1) @Max(20_000) height: number;
  @IsInt() @Min(1) bytes: number;
  /** Cloudinary's etag (MD5 of the file): catches the same photo uploaded twice. */
  @IsString() @Length(8, 64) etag: string;
  @IsOptional() @IsInt() @Min(0) durationSec?: number;
  @IsOptional() @IsString() @MaxLength(100) blurhash?: string;
}

class RegisterDocumentDto extends UploadedDto {
  @IsIn(DOC_TYPES) docType: (typeof DOC_TYPES)[number];
  @IsString() @Matches(/^(jpg|jpeg|png|pdf)$/) format: string;
  /** Aadhaar only: the last 4 digits. The full number is never sent or stored. */
  @IsOptional() @Matches(/^\d{4}$/) last4?: string;
}

class OrderDto {
  @IsArray() @ArrayMaxSize(MAX_PHOTOS + MAX_VIDEOS) @IsUUID('all', { each: true }) ids: string[];
}

const MEDIA_COLUMNS = `id, type, public_id AS "publicId", width, height, duration_sec AS "durationSec", blurhash,
  is_cover AS "isCover", sort_order AS "sortOrder", status, reject_reason AS "rejectReason"`;

/**
 * Partner app photos, videos and documents. Files go straight from the phone to Cloudinary
 * with a signature from here (the API secret never leaves the server); then the app registers
 * the upload, and it waits for admin approval before customers can see it.
 */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class MediaController {
  constructor(
    private readonly db: Db,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async vendorId(q: Queryable, userId: string, lock = false) {
    const v = await this.db.one<{ id: string }>(q, `SELECT id FROM vendors WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`, [userId]);
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v.id;
  }

  /** Checks Cloudinary's signature and that the file sits in this vendor's own folder. */
  private checkUpload(vendorId: string, kind: UploadKind, body: UploadedDto) {
    if (!body.publicId.startsWith(this.cloudinary.folderFor(vendorId, kind) + '/')) {
      throw new AppError('UPLOAD_INVALID', 'This upload does not belong to your account.', HttpStatus.FORBIDDEN);
    }
    if (!this.cloudinary.verifyUploadResponse(body.publicId, body.version, body.signature)) {
      throw new AppError('UPLOAD_INVALID', 'We could not verify this upload. Please try again.');
    }
  }

  @Post('uploads/sign')
  @HttpCode(HttpStatus.OK)
  async sign(@Auth() auth: AuthContext, @Body() body: SignDto) {
    return this.cloudinary.signUpload(await this.vendorId(this.db, auth.userId), body.kind);
  }

  @Get('media')
  async list(@Auth() auth: AuthContext) {
    const vendorId = await this.vendorId(this.db, auth.userId);
    const { rows } = await this.db.query(
      `SELECT ${MEDIA_COLUMNS} FROM media WHERE vendor_id = $1 AND status <> 'uploading' ORDER BY is_cover DESC, sort_order, created_at`,
      [vendorId],
    );
    return { items: rows, limits: { photos: MAX_PHOTOS, videos: MAX_VIDEOS } };
  }

  /** New photos and videos wait for review; the first photo becomes the cover. */
  @Post('media')
  async register(@Auth() auth: AuthContext, @Body() body: RegisterMediaDto) {
    return this.db.tx(async (client) => {
      const vendorId = await this.vendorId(client, auth.userId, true);
      this.checkUpload(vendorId, body.type, body);
      if (body.bytes > UPLOAD_RULES[body.type].maxBytes) throw new AppError('FILE_TOO_BIG', 'This file is too big.');
      if (body.type === 'video' && (body.durationSec ?? 0) > MAX_VIDEO_SEC) {
        throw new AppError('VIDEO_TOO_LONG', `Videos can be up to ${MAX_VIDEO_SEC / 60} minutes long.`);
      }
      const counts = await this.db.one<{ photos: number; videos: number }>(
        client,
        `SELECT count(*) FILTER (WHERE type = 'photo')::int AS photos, count(*) FILTER (WHERE type = 'video')::int AS videos
           FROM media WHERE vendor_id = $1 AND status <> 'rejected'`,
        [vendorId],
      );
      if (body.type === 'photo' ? counts!.photos >= MAX_PHOTOS : counts!.videos >= MAX_VIDEOS) {
        throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_PHOTOS} photos and ${MAX_VIDEOS} videos.`);
      }
      const row = await this.db.one(
        client,
        `INSERT INTO media (vendor_id, type, public_id, width, height, bytes, duration_sec, blurhash, file_hash, status, sort_order, is_cover)
         SELECT $1, $2::media_type, $3, $4, $5, $6, $7, $8, $9, 'pending',
                COALESCE((SELECT max(sort_order) + 1 FROM media WHERE vendor_id = $1), 0),
                $2::media_type = 'photo' AND NOT EXISTS (SELECT 1 FROM media WHERE vendor_id = $1 AND is_cover)
         ON CONFLICT DO NOTHING
         RETURNING ${MEDIA_COLUMNS}`,
        [vendorId, body.type, body.publicId, body.width, body.height, body.bytes, body.durationSec ?? null, body.blurhash ?? null, body.etag],
      );
      if (!row) throw new AppError('MEDIA_DUPLICATE', 'You have already added this file.', HttpStatus.CONFLICT);
      return row;
    });
  }

  @Delete('media/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const removed = await this.db.tx(async (client) => {
      const vendorId = await this.vendorId(client, auth.userId, true);
      const m = await this.db.one<{ public_id: string; type: 'photo' | 'video'; is_cover: boolean }>(
        client,
        'DELETE FROM media WHERE id = $1 AND vendor_id = $2 RETURNING public_id, type, is_cover',
        [id, vendorId],
      );
      if (!m) throw new AppError('NOT_FOUND', 'Photo not found.', HttpStatus.NOT_FOUND);
      // Removing the cover passes it to the next photo, so the vendor card never goes blank.
      if (m.is_cover) {
        await client.query(
          `UPDATE media SET is_cover = true WHERE id = (
             SELECT id FROM media WHERE vendor_id = $1 AND type = 'photo' AND status <> 'rejected'
              ORDER BY (status = 'approved') DESC, sort_order LIMIT 1)`,
          [vendorId],
        );
      }
      return m;
    });
    await this.cloudinary.destroy(removed.public_id, removed.type === 'video' ? 'video' : 'image');
  }

  @Post('media/:id/cover')
  @HttpCode(HttpStatus.OK)
  async cover(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (client) => {
      const vendorId = await this.vendorId(client, auth.userId, true);
      const ok = await this.db.one(
        client,
        `SELECT 1 FROM media WHERE id = $1 AND vendor_id = $2 AND type = 'photo' AND status <> 'rejected'`,
        [id, vendorId],
      );
      if (!ok) throw new AppError('NOT_FOUND', 'Photo not found.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE media SET is_cover = (id = $1) WHERE vendor_id = $2', [id, vendorId]);
      return { id, isCover: true };
    });
  }

  /** The order photos appear on the vendor page. Ids not in the list keep their place after these. */
  @Put('media/order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async order(@Auth() auth: AuthContext, @Body() body: OrderDto) {
    const vendorId = await this.vendorId(this.db, auth.userId);
    await this.db.query(
      `UPDATE media m SET sort_order = o.pos FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, pos)
        WHERE m.id = o.id AND m.vendor_id = $1`,
      [vendorId, body.ids],
    );
  }

  // ---- documents (Aadhaar, PAN, GST, shop photo) ----

  @Get('documents')
  async documents(@Auth() auth: AuthContext) {
    const vendorId = await this.vendorId(this.db, auth.userId);
    const { rows } = await this.db.query(
      `SELECT DISTINCT ON (doc_type) id, doc_type AS "docType", last4, status, reject_reason AS "rejectReason", created_at AS "createdAt"
         FROM vendor_documents WHERE vendor_id = $1 ORDER BY doc_type, created_at DESC`,
      [vendorId],
    );
    return { items: rows };
  }

  /** A new upload of the same document type replaces the older one. */
  @Post('documents')
  async addDocument(@Auth() auth: AuthContext, @Body() body: RegisterDocumentDto) {
    if (body.docType === 'aadhaar' && !body.last4) throw new AppError('VALIDATION', 'Enter the last 4 digits of your Aadhaar.');
    const { row, old } = await this.db.tx(async (client) => {
      const vendorId = await this.vendorId(client, auth.userId, true);
      this.checkUpload(vendorId, 'document', body);
      const replaced = await client.query<{ storage_key: string }>(
        'DELETE FROM vendor_documents WHERE vendor_id = $1 AND doc_type = $2 RETURNING storage_key',
        [vendorId, body.docType],
      );
      const inserted = await this.db.one(
        client,
        `INSERT INTO vendor_documents (vendor_id, doc_type, storage_key, format, last4) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, doc_type AS "docType", last4, status, reject_reason AS "rejectReason", created_at AS "createdAt"`,
        [vendorId, body.docType, body.publicId, body.format, body.docType === 'aadhaar' ? body.last4 : null],
      );
      return { row: inserted, old: replaced.rows };
    });
    // Only after the commit, so a failed save never loses the previous file.
    for (const o of old) await this.cloudinary.destroy(o.storage_key, 'image', 'private');
    return row;
  }
}
