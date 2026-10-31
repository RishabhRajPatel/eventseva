import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { AppError } from '../common/errors';
import { PublicCache } from '../common/cache';
import { pickLanguage } from '../catalog/catalog.controller';
import { EVENT_TYPES } from '../bookings/booking.rules';
import { PartnerAppGuard } from '../partner/partner.controller';
import { BookingsService } from '../bookings/bookings.service';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { CheckoutService, MAX_CHECKOUT_ITEMS } from './checkout.service';
import { EngineRequestDto } from './engine.controller';

class PackageQuery {
  @IsOptional() @IsIn(EVENT_TYPES) eventType?: string;
}

class ServiceSearchQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
}

class PackageDto {
  @IsString() @Length(2, 80) name: string;
  @IsString() @Length(2, 80) nameHi: string;
  @IsIn(EVENT_TYPES) eventType: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) descriptionHi?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(50) discountPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(MAX_CHECKOUT_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items: BundleItemDto[];
}

class UpdatePackageDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() @Length(2, 80) nameHi?: string;
  @IsOptional() @IsIn(EVENT_TYPES) eventType?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) descriptionHi?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(50) discountPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(MAX_CHECKOUT_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items?: BundleItemDto[];
}

/**
 * EventSeva's curated packages: a set of services from several vendors, booked together. They use
 * the same rows and the same checkout as a vendor's own bundle — what makes one ours is that it has
 * no vendor of its own.
 */
@UseGuards(AdminGuard)
@AdminRoles('super')
@Controller('v1/admin/packages')
export class AdminPackagesController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get()
  list() {
    return this.checkout.adminPackages();
  }

  /** The picker in the package editor: live services from approved vendors, by name or vendor. */
  @Get('services')
  services(@Query() query: ServiceSearchQuery) {
    return this.checkout.packageableServices(query.q);
  }

  @Post()
  create(@Admin() admin: AdminContext, @Body() body: PackageDto) {
    return this.checkout.createPackage(admin.adminId, body);
  }

  @Patch(':id')
  update(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePackageDto) {
    return this.checkout.updatePackage(admin.adminId, id, body);
  }

  /** Hidden rather than deleted: bookings made from it point at it. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.checkout.updatePackage(admin.adminId, id, { isActive: false });
  }
}

class BundleItemDto {
  @IsUUID() serviceId: string;
  @IsBoolean() mandatory: boolean;
}

class BundleDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(50) discountPercent?: number;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(MAX_CHECKOUT_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items: BundleItemDto[];
}

class UpdateBundleDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(50) discountPercent?: number;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(MAX_CHECKOUT_ITEMS) @ValidateNested({ each: true }) @Type(() => BundleItemDto) items?: BundleItemDto[];
}

class VerifyDto {
  @IsString() @MaxLength(64) razorpayOrderId: string;
  @IsString() @MaxLength(64) razorpayPaymentId: string;
  @IsString() @MaxLength(128) razorpaySignature: string;
}

class CheckoutDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_CHECKOUT_ITEMS) @ValidateNested({ each: true }) @Type(() => EngineRequestDto) items: EngineRequestDto[];
  @IsOptional() @IsUUID() bundleId?: string;
  /** The cart total the customer saw (all lines); a different server total answers PRICE_CHANGED. */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) expectedTotalPaise?: number;
}

/** Partner app: bundles of services booked together. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/bundles')
export class PartnerBundlesController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get()
  async list(@Auth() auth: AuthContext) {
    return { items: await this.checkout.bundles(auth.userId) };
  }

  @Post()
  create(@Auth() auth: AuthContext, @Body() body: BundleDto) {
    return this.checkout.createBundle(auth.userId, body);
  }

  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateBundleDto) {
    return this.checkout.updateBundle(auth.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.checkout.removeBundle(auth.userId, id);
  }
}

@Controller('v1')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly bookings: BookingsService,
  ) {}

  @Get('vendors/:id/bundles')
  async bundles(@Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.checkout.publicBundles(id) };
  }

  /**
   * EventSeva's own packages, which may span several vendors. No login: this is part of the
   * catalogue. `available: false` means one of the parts is not bookable, so the app should grey
   * the package out instead of letting the checkout fail.
   */
  @PublicCache(60)
  @Get('packages')
  packages(@Query() query: PackageQuery, @Headers('accept-language') acceptLanguage?: string) {
    return this.checkout.publicPackages(query.eventType, pickLanguage(acceptLanguage));
  }

  @UseGuards(AuthGuard)
  @Post('checkouts/quote')
  @HttpCode(HttpStatus.OK)
  quote(@Auth() auth: AuthContext, @Body() body: CheckoutDto) {
    return this.checkout.quote(auth.userId, body.items, body.bundleId);
  }

  /** All the bookings or none; the same Idempotency-Key returns the same checkout. */
  @UseGuards(AuthGuard)
  @Post('checkouts')
  create(@Auth() auth: AuthContext, @Body() body: CheckoutDto, @Headers('idempotency-key') key?: string) {
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
      throw new AppError('VALIDATION', 'Idempotency-Key: 8 to 64 letters, digits, - or _.', HttpStatus.BAD_REQUEST, { field: 'Idempotency-Key' });
    }
    return this.checkout.checkout(auth.userId, body.items, body.bundleId, key, body.expectedTotalPaise);
  }

  @UseGuards(AuthGuard)
  @Get('checkouts/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.checkout.view(auth.userId, id);
  }

  /** One Razorpay order for every accepted booking of the checkout still waiting for its advance. */
  @UseGuards(AuthGuard)
  @Post('checkouts/:id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.startCheckoutPayment(auth.userId, id);
  }

  @UseGuards(AuthGuard)
  @Post('checkouts/:id/pay/verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyDto) {
    await this.bookings.verifyCheckoutPayment(auth.userId, id, body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
    return this.checkout.view(auth.userId, id);
  }

  /** Development only (PAYMENT_PROVIDER=fake). */
  @UseGuards(AuthGuard)
  @Post('checkouts/:id/pay/dev')
  @HttpCode(HttpStatus.OK)
  async devPay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.bookings.devPayCheckout(auth.userId, id);
    return this.checkout.view(auth.userId, id);
  }
}
