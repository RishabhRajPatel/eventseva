import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards, Headers } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { PartnerAppGuard } from '../partner/partner.controller';
import { pickLanguage } from '../catalog/catalog.controller';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { FeaturedService } from './featured.service';

class VerifyDto {
  @IsString() @MaxLength(64) razorpayOrderId: string;
  @IsString() @MaxLength(64) razorpayPaymentId: string;
  @IsString() @MaxLength(128) razorpaySignature: string;
}

class PlanDto {
  @IsString() @Length(2, 60) nameEn: string;
  @IsString() @Length(2, 60) nameHi: string;
  @IsInt() @Min(1) @Max(365) days: number;
  @IsInt() @Min(100) @Max(100_000_000) pricePaise: number;
}

class UpdatePlanDto {
  @IsOptional() @IsString() @Length(2, 60) nameEn?: string;
  @IsOptional() @IsString() @Length(2, 60) nameHi?: string;
  @IsOptional() @IsInt() @Min(100) @Max(100_000_000) pricePaise?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class GrantDto {
  @IsInt() @Min(1) @Max(365) days: number;
  @IsString() @Length(3, 300) reason: string;
}

class ReasonDto {
  @IsString() @Length(3, 300) reason: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

const PLAN_COLUMNS = `id, name_en AS "nameEn", name_hi AS "nameHi", days, price_paise AS "pricePaise", is_active AS "isActive", sort_order AS "sortOrder"`;

/** Partner app: "Get featured". */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/featured')
export class PartnerFeaturedController {
  constructor(
    private readonly db: Db,
    private readonly featured: FeaturedService,
  ) {}

  @Get()
  async overview(@Auth() auth: AuthContext, @Headers('accept-language') acceptLanguage?: string) {
    const lang = pickLanguage(acceptLanguage);
    const v = await this.db.one<{ id: string; featured_until: Date | null; status: string }>(
      this.db,
      'SELECT id, featured_until, status FROM vendors WHERE user_id = $1',
      [auth.userId],
    );
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    const plans = await this.db.query(
      `SELECT id, ${lang === 'hi' ? 'name_hi' : 'name_en'} AS name, days, price_paise AS "pricePaise"
         FROM featured_plans WHERE is_active ORDER BY sort_order, days`,
    );
    const history = await this.db.query(
      `SELECT id, days, amount_paise AS "amountPaise", status, starts_at AS "startsAt", ends_at AS "endsAt", created_at AS "createdAt"
         FROM featured_purchases WHERE vendor_id = $1 AND status <> 'created' ORDER BY created_at DESC LIMIT 20`,
      [v.id],
    );
    const active = v.featured_until && v.featured_until > new Date();
    return { featuredUntil: active ? v.featured_until : null, canBuy: v.status === 'approved', plans: plans.rows, history: history.rows };
  }

  @Post('plans/:planId/order')
  @HttpCode(HttpStatus.OK)
  order(@Auth() auth: AuthContext, @Param('planId', ParseIntPipe) planId: number) {
    return this.featured.startPurchase(auth.userId, planId);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Auth() auth: AuthContext, @Body() body: VerifyDto) {
    await this.featured.verify(auth.userId, body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
    return this.overview(auth);
  }

  /** Test payments while PAYMENT_PROVIDER=fake (404 otherwise). */
  @Post('purchases/:id/pay/dev')
  @HttpCode(HttpStatus.OK)
  async devPay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.featured.devPay(auth.userId, id);
    return this.overview(auth);
  }
}

/** Admin: plans and prices (super), sales list (finance), free featured days (super). */
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminFeaturedController {
  constructor(
    private readonly db: Db,
    private readonly featured: FeaturedService,
  ) {}

  @AdminRoles('finance')
  @Get('featured-plans')
  async plans() {
    const { rows } = await this.db.query(`SELECT ${PLAN_COLUMNS} FROM featured_plans ORDER BY is_active DESC, sort_order, days`);
    return { items: rows };
  }

  @AdminRoles('super')
  @Post('featured-plans')
  async createPlan(@Admin() admin: AdminContext, @Body() b: PlanDto) {
    return this.db.tx(async (client) => {
      const row = await this.db.one<{ id: number }>(
        client,
        `INSERT INTO featured_plans (name_en, name_hi, days, price_paise, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT max(sort_order) + 1 FROM featured_plans), 1)) RETURNING id`,
        [b.nameEn.trim(), b.nameHi.trim(), b.days, b.pricePaise],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'featured_plan.create', 'featured_plan', $2, NULL, $3)`,
        [admin.adminId, String(row!.id), b],
      );
      return this.db.one(client, `SELECT ${PLAN_COLUMNS} FROM featured_plans WHERE id = $1`, [row!.id]);
    });
  }

  /** Days cannot change once a plan has been sold; make a new plan instead. */
  @AdminRoles('super')
  @Patch('featured-plans/:id')
  async updatePlan(@Admin() admin: AdminContext, @Param('id', ParseIntPipe) id: number, @Body() b: UpdatePlanDto) {
    return this.db.tx(async (client) => {
      const before = await this.db.one(client, `SELECT ${PLAN_COLUMNS} FROM featured_plans WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw new AppError('NOT_FOUND', 'Plan not found.', HttpStatus.NOT_FOUND);
      await client.query(
        `UPDATE featured_plans SET name_en = COALESCE($2, name_en), name_hi = COALESCE($3, name_hi), price_paise = COALESCE($4, price_paise),
                is_active = COALESCE($5, is_active) WHERE id = $1`,
        [id, b.nameEn?.trim() ?? null, b.nameHi?.trim() ?? null, b.pricePaise ?? null, b.isActive ?? null],
      );
      const after = await this.db.one(client, `SELECT ${PLAN_COLUMNS} FROM featured_plans WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'featured_plan.update', 'featured_plan', $2, $3, $4)`,
        [admin.adminId, String(id), before, after],
      );
      return after;
    });
  }

  @AdminRoles('finance')
  @Get('featured-purchases')
  async purchases(@Query() query: PageQuery) {
    const page = query.page ?? 1;
    const { rows } = await this.db.query(
      `SELECT f.id, f.days, f.amount_paise AS "amountPaise", f.status, f.reason, f.starts_at AS "startsAt", f.ends_at AS "endsAt",
              f.created_at AS "createdAt", f.paid_at AS "paidAt", f.razorpay_payment_id AS "paymentId",
              v.id AS "vendorId", v.business_name AS "vendorName", p.name_en AS "planName", a.email AS "grantedBy"
         FROM featured_purchases f JOIN vendors v ON v.id = f.vendor_id
         LEFT JOIN featured_plans p ON p.id = f.plan_id LEFT JOIN admin_users a ON a.id = f.granted_by
        WHERE f.status <> 'created' ORDER BY f.created_at DESC LIMIT $1 OFFSET $2`,
      [21, (page - 1) * 20],
    );
    return { items: rows.slice(0, 20), page, hasMore: rows.length > 20 };
  }

  @AdminRoles('super')
  @Post('vendors/:id/feature')
  @HttpCode(HttpStatus.OK)
  grant(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() b: GrantDto) {
    return this.featured.grant(admin.adminId, id, b.days, b.reason.trim());
  }

  @AdminRoles('super')
  @Post('vendors/:id/unfeature')
  @HttpCode(HttpStatus.OK)
  async stop(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto) {
    await this.featured.stop(admin.adminId, id, b.reason.trim());
    return { featuredUntil: null };
  }
}
