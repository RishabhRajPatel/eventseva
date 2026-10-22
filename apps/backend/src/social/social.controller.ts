import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { pickLanguage } from '../catalog/catalog.controller';
import { notify } from '../notifications/notify';

class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class ComplaintDto {
  @IsOptional() @IsUUID() bookingId?: string;
  @IsString() @Length(3, 120) subject: string;
  @IsString() @Length(10, 2000) details: string;
}

class ReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) ids?: number[];
}

class NotificationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeId?: number;
}

class DeviceDto {
  @IsString() @Length(10, 400) fcmToken: string;
  @IsIn(['android', 'ios']) platform: 'android' | 'ios';
}

class DeviceRemoveDto {
  @IsString() @Length(10, 400) fcmToken: string;
}

const PAGE_SIZE = 20;

/** Rating shown on the vendor card: average of visible reviews, one decimal. */
export async function refreshRating(q: Queryable, vendorId: string) {
  await q.query(
    `UPDATE vendors v SET rating_avg = COALESCE(r.avg, 0), rating_count = r.n
       FROM (SELECT round(avg(rating)::numeric, 1) AS avg, count(*)::int AS n
               FROM reviews WHERE vendor_id = $1 AND NOT is_hidden) r
      WHERE v.id = $1`,
    [vendorId],
  );
}

/** Public: reviews on the vendor page (no login needed). */
@Controller('v1/vendors')
export class PublicReviewsController {
  constructor(private readonly db: Db) {}

  @Get(':id/reviews')
  async reviews(@Param('id', ParseUUIDPipe) id: string, @Query() query: PageQuery) {
    const page = query.page ?? 1;
    const { rows } = await this.db.query(
      `SELECT r.id, r.rating, r.comment, r.vendor_reply AS "vendorReply", r.created_at AS "createdAt",
              COALESCE(split_part(u.name, ' ', 1), 'Customer') AS "customerName", e.event_type AS "eventType"
         FROM reviews r JOIN users u ON u.id = r.customer_id
         JOIN bookings b ON b.id = r.booking_id JOIN events e ON e.id = b.event_id
        WHERE r.vendor_id = $1 AND NOT r.is_hidden
        ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [id, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    );
    return { items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE };
  }
}

/** Customer app: reviews, shortlist ("saved"), complaints. Notifications and devices are for both apps. */
@UseGuards(AuthGuard)
@Controller('v1')
export class SocialController {
  constructor(private readonly db: Db) {}

  // ---- reviews ----

  /** Only after the event is over (booking completed), once per booking. */
  @Post('bookings/:id/review')
  async review(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReviewDto) {
    return this.db.tx(async (client) => {
      const b = await this.db.one<{ vendor_id: string; status: string; vendor_user_id: string }>(
        client,
        `SELECT b.vendor_id, b.status, v.user_id AS vendor_user_id FROM bookings b JOIN vendors v ON v.id = b.vendor_id
          WHERE b.id = $1 AND b.customer_id = $2`,
        [id, auth.userId],
      );
      if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
      if (b.status !== 'completed') throw new AppError('REVIEW_NOT_ALLOWED', 'You can review after the event is over.', HttpStatus.CONFLICT);
      const review = await this.db.one(
        client,
        `INSERT INTO reviews (booking_id, customer_id, vendor_id, rating, comment) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (booking_id) DO NOTHING
         RETURNING id, rating, comment, vendor_reply AS "vendorReply", created_at AS "createdAt"`,
        [id, auth.userId, b.vendor_id, body.rating, body.comment?.trim() || null],
      );
      if (!review) throw new AppError('REVIEW_EXISTS', 'You have already reviewed this booking.', HttpStatus.CONFLICT);
      await refreshRating(client, b.vendor_id);
      await notify(client, b.vendor_user_id, 'review_received', {
        en: { title: `New ${body.rating}★ review`, body: body.comment?.slice(0, 120) || 'A customer rated your service.' },
        hi: { title: `नया ${body.rating}★ रिव्यू`, body: body.comment?.slice(0, 120) || 'एक ग्राहक ने आपकी सेवा को रेटिंग दी।' },
      }, { reviewId: review.id });
      return review;
    });
  }

  // ---- shortlist ----

  @Get('shortlist')
  async shortlist(@Auth() auth: AuthContext, @Headers('accept-language') acceptLanguage?: string) {
    const lang = pickLanguage(acceptLanguage);
    const { rows } = await this.db.query(
      `SELECT v.id, v.business_name AS "businessName", v.area, v.rating_avg::float AS "ratingAvg", v.rating_count AS "ratingCount",
              json_build_object('slug', c.slug, 'name', ${lang === 'hi' ? 'c.name_hi' : 'c.name_en'}) AS category,
              (SELECT json_build_object('publicId', m.public_id, 'width', m.width, 'height', m.height, 'blurhash', m.blurhash)
                 FROM media m WHERE m.vendor_id = v.id AND m.status = 'approved' AND m.type = 'photo'
                ORDER BY m.is_cover DESC, m.sort_order LIMIT 1) AS cover,
              s.created_at AS "savedAt"
         FROM shortlists s JOIN vendors v ON v.id = s.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE s.customer_id = $1 AND v.status = 'approved' ORDER BY s.created_at DESC`,
      [auth.userId],
    );
    return { items: rows };
  }

  @Put('shortlist/:vendorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(@Auth() auth: AuthContext, @Param('vendorId', ParseUUIDPipe) vendorId: string) {
    const res = await this.db.query(
      `INSERT INTO shortlists (customer_id, vendor_id)
       SELECT $1, id FROM vendors WHERE id = $2 AND status = 'approved'
       ON CONFLICT DO NOTHING`,
      [auth.userId, vendorId],
    );
    if (!res.rowCount) {
      const exists = await this.db.one(this.db, 'SELECT 1 FROM shortlists WHERE customer_id = $1 AND vendor_id = $2', [auth.userId, vendorId]);
      if (!exists) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
    }
  }

  @Delete('shortlist/:vendorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsave(@Auth() auth: AuthContext, @Param('vendorId', ParseUUIDPipe) vendorId: string) {
    await this.db.query('DELETE FROM shortlists WHERE customer_id = $1 AND vendor_id = $2', [auth.userId, vendorId]);
  }

  // ---- complaints (help & support) ----

  @Post('complaints')
  async complain(@Auth() auth: AuthContext, @Body() body: ComplaintDto) {
    if (body.bookingId) {
      // Either side of the booking can raise a complaint about it.
      const mine = await this.db.one(
        this.db,
        `SELECT 1 FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND (b.customer_id = $2 OR v.user_id = $2)`,
        [body.bookingId, auth.userId],
      );
      if (!mine) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    }
    return this.db.one(
      this.db,
      `INSERT INTO complaints (booking_id, raised_by, subject, details) VALUES ($1, $2, $3, $4)
       RETURNING id, booking_id AS "bookingId", subject, details, status, resolution, created_at AS "createdAt"`,
      [body.bookingId ?? null, auth.userId, body.subject.trim(), body.details.trim()],
    );
  }

  @Get('complaints')
  async complaints(@Auth() auth: AuthContext) {
    const { rows } = await this.db.query(
      `SELECT id, booking_id AS "bookingId", subject, details, status, resolution, created_at AS "createdAt"
         FROM complaints WHERE raised_by = $1 ORDER BY created_at DESC LIMIT 100`,
      [auth.userId],
    );
    return { items: rows };
  }

  // ---- notifications ----

  @Get('notifications')
  async notifications(@Auth() auth: AuthContext, @Query() query: NotificationQuery) {
    const { rows } = await this.db.query(
      `SELECT id::int, kind, title, body, data, read_at AS "readAt", created_at AS "createdAt"
         FROM notifications WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT 31`,
      [auth.userId, query.beforeId ?? null],
    );
    const unread = await this.db.one<{ n: number }>(
      this.db,
      'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [auth.userId],
    );
    return { items: rows.slice(0, 30), hasMore: rows.length > 30, unreadCount: unread!.n };
  }

  /** Marks the given notifications read, or all of them when no ids are sent. */
  @Post('notifications/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async read(@Auth() auth: AuthContext, @Body() body: ReadDto) {
    await this.db.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`,
      [auth.userId, body.ids ?? null],
    );
  }

  // ---- push tokens (Firebase Cloud Messaging) ----

  /** A phone's token moves to whoever logged in on it last. */
  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async device(@Auth() auth: AuthContext, @Body() body: DeviceDto) {
    await this.db.query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (fcm_token) DO UPDATE SET user_id = $1, platform = $3, updated_at = now()`,
      [auth.userId, body.fcmToken, body.platform],
    );
  }

  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDevice(@Auth() auth: AuthContext, @Body() body: DeviceRemoveDto) {
    await this.db.query('DELETE FROM device_tokens WHERE user_id = $1 AND fcm_token = $2', [auth.userId, body.fcmToken]);
  }
}
