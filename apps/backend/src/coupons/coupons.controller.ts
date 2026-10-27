import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { pickLanguage } from '../catalog/catalog.controller';
import { loadBookings } from '../bookings/booking.view';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { CouponsService } from './coupons.service';
import { describeCoupon } from './coupon.rules';
import { PublicCache } from '../common/cache';

class ApplyDto {
  @IsString() @Length(3, 20) code: string;
}

class CreateCouponDto {
  @Matches(/^[A-Za-z0-9]{3,20}$/, { message: 'code: 3–20 letters or digits' }) code: string;
  @IsString() @Length(2, 80) titleEn: string;
  @IsString() @Length(2, 80) titleHi: string;
  @IsIn(['percent', 'flat']) discountType: 'percent' | 'flat';
  /** Percent (1–100) or paise for flat. */
  @IsInt() @Min(1) @Max(10_000_000) discountValue: number;
  @IsOptional() @IsInt() @Min(100) maxDiscountPaise?: number;
  @IsOptional() @IsInt() @Min(0) minAmountPaise?: number;
  @IsOptional() @IsInt() @Min(1) categoryId?: number;
  @IsOptional() @IsBoolean() firstBookingOnly?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) perCustomerLimit?: number;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validUntil?: string;
}

/** The code and discount never change once created (customers may already hold it); everything else can. */
class UpdateCouponDto {
  @IsOptional() @IsString() @Length(2, 80) titleEn?: string;
  @IsOptional() @IsString() @Length(2, 80) titleHi?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsDateString() validUntil?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

const PAGE_SIZE = 20;

const ADMIN_COLUMNS = `c.id, c.code, c.title_en AS "titleEn", c.title_hi AS "titleHi", c.discount_type AS "discountType",
  c.discount_value AS "discountValue", c.max_discount_paise AS "maxDiscountPaise", c.min_amount_paise AS "minAmountPaise",
  c.category_id AS "categoryId", cat.name_en AS "categoryName", c.first_booking_only AS "firstBookingOnly", c.is_public AS "isPublic",
  c.max_uses AS "maxUses", c.per_customer_limit AS "perCustomerLimit", c.valid_from AS "validFrom", c.valid_until AS "validUntil",
  c.is_active AS "isActive", c.created_at AS "createdAt",
  (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'used') AS "usedCount",
  (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'applied') AS "heldCount",
  (SELECT COALESCE(sum(discount_paise), 0)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'used') AS "discountGivenPaise"`;

async function audit(q: Queryable, adminId: string, action: string, id: number, before: object | null, after: object | null) {
  await q.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'coupon', $3, $4, $5)`,
    [adminId, action, String(id), before, after],
  );
}

/** Customer app: offers banner, and adding a coupon to a booking before paying. */
@Controller('v1')
export class CouponsController {
  constructor(
    private readonly db: Db,
    private readonly coupons: CouponsService,
  ) {}

  /** Public offers that can still be used (no login needed). */
  @PublicCache(60)
  @Get('offers')
  async offers(@Headers('accept-language') acceptLanguage?: string) {
    const lang = pickLanguage(acceptLanguage);
    const { rows } = await this.db.query(
      `SELECT c.code, ${lang === 'hi' ? 'c.title_hi' : 'c.title_en'} AS title, c.discount_type, c.discount_value, c.max_discount_paise,
              c.min_amount_paise AS "minAmountPaise", c.first_booking_only AS "firstBookingOnly", c.valid_until AS "validUntil",
              CASE WHEN cat.id IS NULL THEN NULL ELSE json_build_object('slug', cat.slug, 'icon', cat.icon,
                'name', ${lang === 'hi' ? 'cat.name_hi' : 'cat.name_en'}) END AS category
         FROM coupons c LEFT JOIN categories cat ON cat.id = c.category_id
        WHERE c.is_active AND c.is_public AND c.valid_from <= now() AND (c.valid_until IS NULL OR c.valid_until > now())
          AND (c.max_uses IS NULL OR c.max_uses > (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status <> 'released'))
        ORDER BY c.created_at DESC LIMIT 20`,
    );
    return {
      items: rows.map(({ discount_type, discount_value, max_discount_paise, ...r }) => ({
        ...r,
        discountType: discount_type,
        discountValue: discount_value,
        maxDiscountPaise: max_discount_paise,
        summary: describeCoupon({ discount_type, discount_value, max_discount_paise }, lang),
      })),
      language: lang,
    };
  }

  @UseGuards(AuthGuard)
  @Post('bookings/:id/coupon')
  @HttpCode(HttpStatus.OK)
  async apply(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ApplyDto) {
    await this.coupons.apply(auth.userId, id, body.code);
    return (await loadBookings(this.db, 'customer', { customerId: auth.userId, bookingId: id }))[0];
  }

  @UseGuards(AuthGuard)
  @Delete('bookings/:id/coupon')
  @HttpCode(HttpStatus.OK)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.coupons.remove(auth.userId, id);
    return (await loadBookings(this.db, 'customer', { customerId: auth.userId, bookingId: id }))[0];
  }
}

/** Admin: create and manage coupons. Super admins and finance (who watch the money). */
@UseGuards(AdminGuard)
@AdminRoles('finance')
@Controller('v1/admin/coupons')
export class AdminCouponsController {
  constructor(private readonly db: Db) {}

  @Get()
  async list(@Query() query: PageQuery) {
    const page = query.page ?? 1;
    const { rows } = await this.db.query(
      `SELECT ${ADMIN_COLUMNS} FROM coupons c LEFT JOIN categories cat ON cat.id = c.category_id
        ORDER BY c.is_active DESC, c.created_at DESC LIMIT $1 OFFSET $2`,
      [PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    );
    return { items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE };
  }

  @Post()
  async create(@Admin() admin: AdminContext, @Body() b: CreateCouponDto) {
    if (b.discountType === 'percent' && b.discountValue > 100) throw new AppError('VALIDATION', 'A percent discount can be at most 100.');
    if (b.validFrom && b.validUntil && new Date(b.validUntil) <= new Date(b.validFrom)) {
      throw new AppError('VALIDATION', 'The end date must be after the start date.');
    }
    return this.db.tx(async (client) => {
      const code = b.code.toUpperCase();
      if (await this.db.one(client, 'SELECT 1 FROM coupons WHERE code = $1', [code])) {
        throw new AppError('COUPON_EXISTS', 'This code is already taken.', HttpStatus.CONFLICT);
      }
      if (b.categoryId && !(await this.db.one(client, 'SELECT 1 FROM categories WHERE id = $1', [b.categoryId]))) {
        throw new AppError('CATEGORY_NOT_FOUND', 'Category not found.');
      }
      const row = await this.db.one<{ id: number }>(
        client,
        `INSERT INTO coupons (code, title_en, title_hi, discount_type, discount_value, max_discount_paise, min_amount_paise, category_id,
                              first_booking_only, is_public, max_uses, per_customer_limit, valid_from, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, now()), $14) RETURNING id`,
        [code, b.titleEn.trim(), b.titleHi.trim(), b.discountType, b.discountValue, b.maxDiscountPaise ?? null, b.minAmountPaise ?? 0,
          b.categoryId ?? null, b.firstBookingOnly ?? false, b.isPublic ?? true, b.maxUses ?? null, b.perCustomerLimit ?? 1,
          b.validFrom ?? null, b.validUntil ?? null],
      );
      await audit(client, admin.adminId, 'coupon.create', row!.id, null, { ...b, code });
      return this.db.one(client, `SELECT ${ADMIN_COLUMNS} FROM coupons c LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`, [row!.id]);
    });
  }

  @Patch(':id')
  async update(@Admin() admin: AdminContext, @Param('id', ParseIntPipe) id: number, @Body() b: UpdateCouponDto) {
    return this.db.tx(async (client) => {
      const before = await this.db.one(client, `SELECT ${ADMIN_COLUMNS} FROM coupons c LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`, [id]);
      if (!before) throw new AppError('NOT_FOUND', 'Coupon not found.', HttpStatus.NOT_FOUND);
      await client.query(
        `UPDATE coupons SET title_en = COALESCE($2, title_en), title_hi = COALESCE($3, title_hi), is_active = COALESCE($4, is_active),
                is_public = COALESCE($5, is_public), max_uses = COALESCE($6, max_uses), valid_until = COALESCE($7, valid_until)
          WHERE id = $1`,
        [id, b.titleEn?.trim() ?? null, b.titleHi?.trim() ?? null, b.isActive ?? null, b.isPublic ?? null, b.maxUses ?? null, b.validUntil ?? null],
      );
      const after = await this.db.one(client, `SELECT ${ADMIN_COLUMNS} FROM coupons c LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = $1`, [id]);
      await audit(client, admin.adminId, 'coupon.update', id, before, after);
      return after;
    });
  }
}
