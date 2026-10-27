import {
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Language, VendorStatus } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { loadVendor, missingForReview, PRICING_UNITS, type PricingUnit } from '../vendors/vendor.queries';

const MAX_PRICE_PAISE = 100_000_000; // ₹10 lakh
const MAX_SERVICES = 30;
const MAX_PACKAGES = 20;

/** Vendor routes only work from the Partner app's login, never the customer app's. */
@Injectable()
export class PartnerAppGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const auth = ctx.switchToHttp().getRequest().auth as AuthContext;
    if (auth.app !== 'partner') {
      throw new AppError('PARTNER_APP_ONLY', 'Use the EventSeva Partner app for this.', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

class VendorProfileDto {
  @IsOptional() @IsString() @Length(2, 80) businessName?: string;
  @IsOptional() @IsInt() @Min(1) categoryId?: number;
  @IsOptional() @IsInt() @Min(1) cityId?: number;
  @IsOptional() @IsString() @Length(2, 80) area?: string;
  @IsOptional() @IsString() @Length(5, 300) address?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsString() @Length(0, 1500) about?: string;
  /** How far you usually travel, in km; null clears it. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(500) serviceRadiusKm?: number | null;
}

class CreateVendorDto {
  @IsString() @Length(2, 80) businessName: string;
  @IsInt() @Min(1) categoryId: number;
  @IsInt() @Min(1) cityId: number;
  @IsOptional() @IsString() @Length(2, 80) area?: string;
  @IsOptional() @IsString() @Length(5, 300) address?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsString() @Length(0, 1500) about?: string;
  /** How far you usually travel, in km; null clears it. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(500) serviceRadiusKm?: number | null;
}

class ServiceDto {
  @IsString() @Length(2, 80) title: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsInt() @Min(100) @Max(MAX_PRICE_PAISE) pricePaise: number;
  @IsIn(PRICING_UNITS) unit: PricingUnit;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) minGuests?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) maxGuests?: number;
}

class UpdateServiceDto {
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsOptional() @IsInt() @Min(100) @Max(MAX_PRICE_PAISE) pricePaise?: number;
  @IsOptional() @IsIn(PRICING_UNITS) unit?: PricingUnit;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) minGuests?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) maxGuests?: number;
}

class PackageDto {
  @IsString() @Length(2, 80) title: string;
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 60, { each: true }) items: string[];
  @IsInt() @Min(100) @Max(MAX_PRICE_PAISE) pricePaise: number;
}

class UpdatePackageDto {
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Length(1, 60, { each: true }) items?: string[];
  @IsOptional() @IsInt() @Min(100) @Max(MAX_PRICE_PAISE) pricePaise?: number;
}

interface OwnVendor {
  id: string;
  status: VendorStatus;
  category_id: number;
}

/**
 * Partner app: a vendor builds their profile (draft), sends it for approval (pending),
 * and the EventSeva team approves or rejects it. Customers only ever see approved vendors.
 */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerController {
  constructor(private readonly db: Db) {}

  private async language(userId: string): Promise<Language> {
    return (await this.db.one<{ language: Language }>(this.db, 'SELECT language FROM users WHERE id = $1', [userId]))!.language;
  }

  private async own(q: Queryable, userId: string, lock = false): Promise<OwnVendor> {
    const v = await this.db.one<OwnVendor>(
      q,
      `SELECT id, status, category_id FROM vendors WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [userId],
    );
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v;
  }

  /** The team reviews a fixed version, so nothing can change while the review is running. */
  private async editable(q: Queryable, userId: string): Promise<OwnVendor> {
    const v = await this.own(q, userId, true);
    if (v.status === 'pending') {
      throw new AppError('VENDOR_UNDER_REVIEW', 'Your profile is being reviewed. You can edit it after the review.', HttpStatus.CONFLICT);
    }
    return v;
  }

  private async view(userId: string) {
    const v = await this.own(this.db, userId);
    const detail = (await loadVendor(this.db, v.id, await this.language(userId), 'owner'))!;
    return { ...detail, missingForReview: missingForReview(detail) };
  }

  private async checkRefs(q: Queryable, body: VendorProfileDto | CreateVendorDto) {
    if (body.categoryId !== undefined) {
      const ok = await this.db.one(q, 'SELECT 1 FROM categories WHERE id = $1 AND is_active', [body.categoryId]);
      if (!ok) throw new AppError('CATEGORY_NOT_FOUND', 'This service type does not exist.');
    }
    if (body.cityId !== undefined) {
      const ok = await this.db.one(q, 'SELECT 1 FROM cities WHERE id = $1 AND is_active', [body.cityId]);
      if (!ok) throw new AppError('CITY_NOT_FOUND', 'We are not in this city yet.');
    }
    if ((body.lat === undefined) !== (body.lng === undefined)) {
      throw new AppError('VALIDATION', 'Send lat and lng together.');
    }
  }

  @Get('vendor')
  get(@Auth() auth: AuthContext) {
    return this.view(auth.userId);
  }

  @Post('vendor')
  async create(@Auth() auth: AuthContext, @Body() body: CreateVendorDto) {
    await this.checkRefs(this.db, body);
    const created = await this.db.one(
      this.db,
      `INSERT INTO vendors (user_id, business_name, category_id, city_id, area, address, lat, lng, about, service_radius_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (user_id) DO NOTHING RETURNING id`,
      [auth.userId, body.businessName.trim(), body.categoryId, body.cityId, body.area?.trim() ?? null,
        body.address?.trim() ?? null, body.lat ?? null, body.lng ?? null, body.about?.trim() || null, body.serviceRadiusKm ?? null],
    );
    if (!created) throw new AppError('VENDOR_EXISTS', 'You already have a business profile.', HttpStatus.CONFLICT);
    return this.view(auth.userId);
  }

  @Patch('vendor')
  async update(@Auth() auth: AuthContext, @Body() body: VendorProfileDto) {
    await this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      // The service type decides which customers see the vendor, so it is fixed once approved.
      if (body.categoryId !== undefined && body.categoryId !== v.category_id && !['draft', 'rejected'].includes(v.status)) {
        throw new AppError('CATEGORY_LOCKED', 'Contact EventSeva support to change your service type.', HttpStatus.CONFLICT);
      }
      await this.checkRefs(client, body);
      await client.query(
        `UPDATE vendors SET business_name = COALESCE($2, business_name), category_id = COALESCE($3, category_id),
                city_id = COALESCE($4, city_id), area = COALESCE($5, area), address = COALESCE($6, address),
                lat = COALESCE($7, lat), lng = COALESCE($8, lng), about = COALESCE($9, about),
                service_radius_km = CASE WHEN $10::boolean THEN $11::int ELSE service_radius_km END
          WHERE id = $1`,
        [v.id, body.businessName?.trim() ?? null, body.categoryId ?? null, body.cityId ?? null, body.area?.trim() ?? null,
          body.address?.trim() ?? null, body.lat ?? null, body.lng ?? null, body.about?.trim() ?? null,
          body.serviceRadiusKm !== undefined, body.serviceRadiusKm ?? null],
      );
    });
    return this.view(auth.userId);
  }

  /** Draft or rejected → pending. The checklist must be complete first. */
  @Post('vendor/submit')
  @HttpCode(HttpStatus.OK)
  async submit(@Auth() auth: AuthContext) {
    const v = await this.own(this.db, auth.userId);
    if (!['draft', 'rejected'].includes(v.status)) {
      throw new AppError('VENDOR_BAD_STATUS', 'This profile cannot be sent for review now.', HttpStatus.CONFLICT, { status: v.status });
    }
    const detail = (await this.view(auth.userId))!;
    if (detail.missingForReview.length) {
      throw new AppError('VENDOR_INCOMPLETE', 'Complete your profile before sending it for review.', HttpStatus.BAD_REQUEST, {
        missing: detail.missingForReview,
      });
    }
    // The status check is repeated in SQL, so two taps on "Submit" cannot both go through.
    await this.db.query(
      `UPDATE vendors SET status = 'pending', reject_reason = NULL WHERE id = $1 AND status IN ('draft', 'rejected')`,
      [v.id],
    );
    return this.view(auth.userId);
  }

  // ---- Services (price per plate / per event / per day …) ----

  @Post('services')
  async addService(@Auth() auth: AuthContext, @Body() body: ServiceDto) {
    checkGuests(body.minGuests, body.maxGuests);
    return this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const count = await this.db.one<{ n: number }>(client, `SELECT count(*)::int AS n FROM services WHERE vendor_id = $1 AND is_active AND booking_type = 'slot'`, [v.id]);
      if (count!.n >= MAX_SERVICES) throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_SERVICES} services.`);
      return this.db.one(
        client,
        `INSERT INTO services (vendor_id, title, description, price_paise, unit, min_guests, max_guests)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${SERVICE_COLUMNS}`,
        [v.id, body.title.trim(), body.description?.trim() || null, body.pricePaise, body.unit, body.minGuests ?? null, body.maxGuests ?? null],
      );
    });
  }

  @Patch('services/:id')
  async updateService(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateServiceDto) {
    return this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const current = await this.db.one<{ minGuests: number | null; maxGuests: number | null }>(
        client,
        `SELECT min_guests AS "minGuests", max_guests AS "maxGuests" FROM services WHERE id = $1 AND vendor_id = $2 AND is_active AND booking_type = 'slot'`,
        [id, v.id],
      );
      if (!current) throw new AppError('NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
      checkGuests(body.minGuests ?? current.minGuests ?? undefined, body.maxGuests ?? current.maxGuests ?? undefined);
      return this.db.one(
        client,
        `UPDATE services SET title = COALESCE($3, title), description = COALESCE($4, description),
                price_paise = COALESCE($5, price_paise), unit = COALESCE($6, unit),
                min_guests = COALESCE($7, min_guests), max_guests = COALESCE($8, max_guests)
          WHERE id = $1 AND vendor_id = $2 RETURNING ${SERVICE_COLUMNS}`,
        [id, v.id, body.title?.trim() ?? null, body.description?.trim() ?? null, body.pricePaise ?? null, body.unit ?? null,
          body.minGuests ?? null, body.maxGuests ?? null],
      );
    });
  }

  /** Soft delete: old bookings still point at the service. */
  @Delete('services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const res = await client.query(`UPDATE services SET is_active = false WHERE id = $1 AND vendor_id = $2 AND is_active AND booking_type = 'slot'`, [id, v.id]);
      if (!res.rowCount) throw new AppError('NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
    });
  }

  // ---- Packages ("Gold wedding package: DJ + lights + 5 hours") ----

  @Post('packages')
  async addPackage(@Auth() auth: AuthContext, @Body() body: PackageDto) {
    return this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const count = await this.db.one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM packages WHERE vendor_id = $1 AND is_active', [v.id]);
      if (count!.n >= MAX_PACKAGES) throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_PACKAGES} packages.`);
      return this.db.one(
        client,
        `INSERT INTO packages (vendor_id, title, items, price_paise) VALUES ($1, $2, $3, $4) RETURNING ${PACKAGE_COLUMNS}`,
        [v.id, body.title.trim(), JSON.stringify(body.items.map((i) => i.trim())), body.pricePaise],
      );
    });
  }

  @Patch('packages/:id')
  async updatePackage(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePackageDto) {
    return this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const row = await this.db.one(
        client,
        `UPDATE packages SET title = COALESCE($3, title), items = COALESCE($4, items), price_paise = COALESCE($5, price_paise)
          WHERE id = $1 AND vendor_id = $2 AND is_active RETURNING ${PACKAGE_COLUMNS}`,
        [id, v.id, body.title?.trim() ?? null, body.items ? JSON.stringify(body.items.map((i) => i.trim())) : null, body.pricePaise ?? null],
      );
      if (!row) throw new AppError('NOT_FOUND', 'Package not found.', HttpStatus.NOT_FOUND);
      return row;
    });
  }

  @Delete('packages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePackage(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(async (client) => {
      const v = await this.editable(client, auth.userId);
      const res = await client.query('UPDATE packages SET is_active = false WHERE id = $1 AND vendor_id = $2 AND is_active', [id, v.id]);
      if (!res.rowCount) throw new AppError('NOT_FOUND', 'Package not found.', HttpStatus.NOT_FOUND);
    });
  }
}

const SERVICE_COLUMNS = `id, title, description, price_paise AS "pricePaise", unit, min_guests AS "minGuests",
  max_guests AS "maxGuests", is_active AS "isActive"`;
const PACKAGE_COLUMNS = `id, title, items, price_paise AS "pricePaise", is_active AS "isActive"`;

function checkGuests(min?: number, max?: number) {
  if (min !== undefined && max !== undefined && min > max) {
    throw new AppError('VALIDATION', 'Minimum guests cannot be more than maximum guests.');
  }
}
