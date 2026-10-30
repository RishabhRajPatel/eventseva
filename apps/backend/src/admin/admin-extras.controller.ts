import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { BookingsService } from '../bookings/bookings.service';
import { Admin, AdminContext, AdminGuard, AdminRole, AdminRoles } from './admin-auth';
import { toCsv } from './csv';
import { StepUp } from './admin-2fa';

class CityDto {
  @IsString() @Length(2, 60) name: string;
  @IsString() @Length(2, 60) nameHi: string;
  @IsString() @Length(2, 60) state: string;
}

class UpdateCityDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsString() @Length(2, 60) nameHi?: string;
  @IsOptional() @IsString() @Length(2, 60) state?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AuditQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @IsString() @MaxLength(40) targetType?: string;
  @IsOptional() @IsString() @MaxLength(80) targetId?: string;
  @IsOptional() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @IsUUID() adminId?: string;
}

const EXPORTS = ['bookings', 'payouts', 'users', 'vendors', 'coupons', 'featured'] as const;
type ExportKind = (typeof EXPORTS)[number];

class ExportQuery {
  /** Inclusive India dates, 'YYYY-MM-DD'. Bookings use the event day; others the created date. */
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) to?: string;
}

class RefundDto {
  @IsInt() @Min(100) amountPaise: number;
  @IsString() @Length(5, 300) reason: string;
  /** true: the vendor pays it back out of this booking's payout. */
  @IsOptional() @IsBoolean() fromVendorPayout?: boolean;
}

/** Who may download which list (same as who may open that page). */
const EXPORT_ROLES: Record<ExportKind, AdminRole[]> = {
  bookings: ['support', 'finance'],
  payouts: ['finance'],
  users: ['support'],
  vendors: ['verifier', 'support'],
  coupons: ['finance'],
  featured: ['finance'],
};

const MAX_ROWS = 50_000;

@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminExtrasController {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingsService,
  ) {}

  // ---- cities ----

  @AdminRoles('super')
  @Get('cities')
  async cities() {
    const { rows } = await this.db.query(
      `SELECT ci.id, ci.name, ci.name_hi AS "nameHi", ci.state, ci.is_active AS "isActive",
              (SELECT count(*)::int FROM vendors v WHERE v.city_id = ci.id AND v.status = 'approved') AS "liveVendors"
         FROM cities ci ORDER BY ci.is_active DESC, ci.name`,
    );
    return { items: rows };
  }

  /** New cities start hidden, so the team can sign up vendors there before customers see it. */
  @AdminRoles('super')
  @Post('cities')
  async addCity(@Admin() admin: AdminContext, @Body() b: CityDto) {
    return this.db.tx(async (client) => {
      if (await this.db.one(client, 'SELECT 1 FROM cities WHERE lower(name) = lower($1)', [b.name.trim()])) {
        throw new AppError('CITY_EXISTS', 'This city is already added.', HttpStatus.CONFLICT);
      }
      const row = await this.db.one(
        client,
        `INSERT INTO cities (name, name_hi, state, is_active) VALUES ($1, $2, $3, false)
         RETURNING id, name, name_hi AS "nameHi", state, is_active AS "isActive"`,
        [b.name.trim(), b.nameHi.trim(), b.state.trim()],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'city.create', 'city', $2, NULL, $3)`,
        [admin.adminId, String(row.id), row],
      );
      return row;
    });
  }

  @AdminRoles('super')
  @Patch('cities/:id')
  async updateCity(@Admin() admin: AdminContext, @Param('id', ParseIntPipe) id: number, @Body() b: UpdateCityDto) {
    return this.db.tx(async (client) => {
      const before = await this.db.one(client, `SELECT id, name, name_hi AS "nameHi", state, is_active AS "isActive" FROM cities WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw new AppError('NOT_FOUND', 'City not found.', HttpStatus.NOT_FOUND);
      if (b.isActive === false) {
        const others = await this.db.one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM cities WHERE is_active AND id <> $1', [id]);
        if (!others!.n) throw new AppError('LAST_CITY', 'At least one city must stay open.', HttpStatus.CONFLICT);
      }
      const after = await this.db.one(
        client,
        `UPDATE cities SET name = COALESCE($2, name), name_hi = COALESCE($3, name_hi), state = COALESCE($4, state), is_active = COALESCE($5, is_active)
          WHERE id = $1 RETURNING id, name, name_hi AS "nameHi", state, is_active AS "isActive"`,
        [id, b.name?.trim() ?? null, b.nameHi?.trim() ?? null, b.state?.trim() ?? null, b.isActive ?? null],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'city.update', 'city', $2, $3, $4)`,
        [admin.adminId, String(id), before, after],
      );
      return after;
    });
  }

  // ---- audit log ----

  @AdminRoles('super')
  @Get('audit')
  async audit(@Query() q: AuditQuery) {
    const page = q.page ?? 1;
    const { rows } = await this.db.query(
      `SELECT l.id, l.action, l.target_type AS "targetType", l.target_id AS "targetId", l.before, l.after, l.created_at AS "createdAt",
              a.id AS "adminId", a.email AS "adminEmail", a.role AS "adminRole"
         FROM admin_audit_log l JOIN admin_users a ON a.id = l.admin_id
        WHERE ($1::text IS NULL OR l.target_type = $1) AND ($2::text IS NULL OR l.target_id = $2)
          AND ($3::text IS NULL OR l.action LIKE $3 || '%') AND ($4::uuid IS NULL OR l.admin_id = $4)
        ORDER BY l.id DESC LIMIT 51 OFFSET $5`,
      [q.targetType ?? null, q.targetId ?? null, q.action ?? null, q.adminId ?? null, (page - 1) * 50],
    );
    const admins = await this.db.query(`SELECT id, email, role FROM admin_users ORDER BY email`);
    return { items: rows.slice(0, 50), page, hasMore: rows.length > 50, admins: admins.rows };
  }

  // ---- CSV downloads ----

  @StepUp()
  @Get('export/:kind')
  @Header('Cache-Control', 'no-store')
  async export(@Admin() admin: AdminContext, @Param('kind') kind: string, @Query() q: ExportQuery, @Res() res: Response) {
    if (!(EXPORTS as readonly string[]).includes(kind)) throw new AppError('NOT_FOUND', 'Unknown export.', HttpStatus.NOT_FOUND);
    const k = kind as ExportKind;
    if (admin.role !== 'super' && !EXPORT_ROLES[k].includes(admin.role)) {
      throw new AppError('FORBIDDEN', 'Your admin role cannot download this.', HttpStatus.FORBIDDEN);
    }
    const { columns, sql } = EXPORT_SQL[k];
    const { rows } = await this.db.query(sql, [q.from ?? null, q.to ?? null, MAX_ROWS]);
    await this.db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'export.download', 'export', $2, NULL, $3)`,
      [admin.adminId, k, { from: q.from ?? null, to: q.to ?? null, rows: rows.length }],
    );
    const name = `eventseva-${k}${q.from ? `-from-${q.from}` : ''}${q.to ? `-to-${q.to}` : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(toCsv(columns, rows));
  }

  // ---- partial refund ----

  @AdminRoles('finance')
  @StepUp()
  @Post('bookings/:id/refund')
  @HttpCode(HttpStatus.OK)
  refund(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() b: RefundDto) {
    return this.bookings.adminRefund(admin.adminId, id, b.amountPaise, b.reason.trim(), b.fromVendorPayout ?? false);
  }
}

/** Date filters: $1 from, $2 to (India dates, inclusive), $3 row limit. Amounts in rupees for spreadsheets. */
const IST = `AT TIME ZONE 'Asia/Kolkata'`;
const range = (col: string) => `($1::date IS NULL OR ${col} >= $1::date) AND ($2::date IS NULL OR ${col} <= $2::date)`;

const EXPORT_SQL: Record<ExportKind, { columns: string[]; sql: string }> = {
  bookings: {
    columns: ['booking_id', 'created_at', 'event_day', 'slot', 'status', 'category', 'vendor', 'customer_name', 'customer_phone', 'service',
      'quantity', 'amount_rs', 'advance_rs', 'discount_rs', 'paid_online_rs', 'commission_rs', 'refund_rs', 'payout_deduction_rs', 'coupon', 'cancel_reason'],
    sql: `SELECT b.id AS booking_id, (b.created_at ${IST})::timestamp(0) AS created_at, b.day AS event_day, b.slot, b.status,
                 cat.name_en AS category, v.business_name AS vendor, cu.name AS customer_name, cu.phone AS customer_phone,
                 COALESCE(s.title, p.title) AS service, b.quantity,
                 b.amount_paise / 100.0 AS amount_rs, b.advance_paise / 100.0 AS advance_rs, b.discount_paise / 100.0 AS discount_rs,
                 COALESCE((SELECT sum(amount_paise) FROM payments x WHERE x.booking_id = b.id AND x.type = 'advance' AND x.status = 'paid'), 0) / 100.0 AS paid_online_rs,
                 b.commission_paise / 100.0 AS commission_rs, b.refund_paise / 100.0 AS refund_rs, b.payout_deduction_paise / 100.0 AS payout_deduction_rs,
                 (SELECT c.code FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id WHERE r.booking_id = b.id AND r.status <> 'released') AS coupon,
                 b.cancel_reason
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id JOIN categories cat ON cat.id = v.category_id JOIN users cu ON cu.id = b.customer_id
            LEFT JOIN services s ON s.id = b.service_id LEFT JOIN packages p ON p.id = b.package_id
           WHERE ${range('b.day')} ORDER BY b.day, b.created_at LIMIT $3`,
  },
  payouts: {
    columns: ['payout_id', 'booking_id', 'event_day', 'vendor', 'amount_rs', 'status', 'release_after', 'reference', 'bank_holder', 'bank_last4', 'ifsc', 'bank_status'],
    sql: `SELECT po.id AS payout_id, po.booking_id, b.day AS event_day, v.business_name AS vendor, po.amount_paise / 100.0 AS amount_rs, po.status,
                 (po.release_after ${IST})::timestamp(0) AS release_after, po.razorpay_transfer_id AS reference,
                 ba.holder_name AS bank_holder, ba.account_last4 AS bank_last4, ba.ifsc, ba.status AS bank_status
            FROM payouts po JOIN bookings b ON b.id = po.booking_id JOIN vendors v ON v.id = po.vendor_id
            LEFT JOIN vendor_bank_accounts ba ON ba.vendor_id = v.id
           WHERE ${range('b.day')} ORDER BY po.release_after LIMIT $3`,
  },
  users: {
    columns: ['user_id', 'joined', 'name', 'phone', 'language', 'blocked', 'vendor', 'vendor_status', 'bookings'],
    sql: `SELECT u.id AS user_id, (u.created_at ${IST})::date AS joined, u.name, u.phone, u.language, u.is_blocked AS blocked,
                 v.business_name AS vendor, v.status AS vendor_status,
                 (SELECT count(*) FROM bookings b WHERE b.customer_id = u.id) AS bookings
            FROM users u LEFT JOIN vendors v ON v.user_id = u.id
           WHERE u.deleted_at IS NULL AND ${range(`(u.created_at ${IST})::date`)} ORDER BY u.created_at LIMIT $3`,
  },
  vendors: {
    columns: ['vendor_id', 'created', 'business', 'category', 'city', 'area', 'status', 'owner_phone', 'rating', 'reviews', 'featured_until', 'live_photos', 'completed_bookings'],
    sql: `SELECT v.id AS vendor_id, (v.created_at ${IST})::date AS created, v.business_name AS business, cat.name_en AS category, ci.name AS city, v.area,
                 v.status, u.phone AS owner_phone, v.rating_avg AS rating, v.rating_count AS reviews, (v.featured_until ${IST})::timestamp(0) AS featured_until,
                 (SELECT count(*) FROM media m WHERE m.vendor_id = v.id AND m.status = 'approved') AS live_photos,
                 (SELECT count(*) FROM bookings b WHERE b.vendor_id = v.id AND b.status = 'completed') AS completed_bookings
            FROM vendors v JOIN categories cat ON cat.id = v.category_id JOIN cities ci ON ci.id = v.city_id JOIN users u ON u.id = v.user_id
           WHERE ${range(`(v.created_at ${IST})::date`)} ORDER BY v.created_at LIMIT $3`,
  },
  coupons: {
    columns: ['code', 'title', 'type', 'value', 'max_discount_rs', 'min_amount_rs', 'active', 'valid_until', 'used', 'discount_given_rs'],
    sql: `SELECT c.code, c.title_en AS title, c.discount_type AS type,
                 CASE WHEN c.discount_type = 'flat' THEN c.discount_value / 100.0 ELSE c.discount_value END AS value,
                 c.max_discount_paise / 100.0 AS max_discount_rs, c.min_amount_paise / 100.0 AS min_amount_rs, c.is_active AS active,
                 (c.valid_until ${IST})::timestamp(0) AS valid_until,
                 (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'used') AS used,
                 COALESCE((SELECT sum(discount_paise) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'used'), 0) / 100.0 AS discount_given_rs
            FROM coupons c WHERE ${range(`(c.created_at ${IST})::date`)} ORDER BY c.created_at LIMIT $3`,
  },
  featured: {
    columns: ['purchase_id', 'date', 'vendor', 'plan', 'days', 'amount_rs', 'status', 'payment_id', 'starts', 'ends', 'reason'],
    sql: `SELECT f.id AS purchase_id, (COALESCE(f.paid_at, f.created_at) ${IST})::date AS date, v.business_name AS vendor, p.name_en AS plan, f.days,
                 f.amount_paise / 100.0 AS amount_rs, f.status, f.razorpay_payment_id AS payment_id,
                 (f.starts_at ${IST})::timestamp(0) AS starts, (f.ends_at ${IST})::timestamp(0) AS ends, f.reason
            FROM featured_purchases f JOIN vendors v ON v.id = f.vendor_id LEFT JOIN featured_plans p ON p.id = f.plan_id
           WHERE f.status <> 'created' AND ${range(`(f.created_at ${IST})::date`)} ORDER BY f.created_at LIMIT $3`,
  },
};
