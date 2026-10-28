import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { AppError } from '../common/errors';
import { PartnerAppGuard } from '../partner/partner.controller';
import { BookingsService } from '../bookings/bookings.service';
import { CheckoutService, MAX_CHECKOUT_ITEMS } from './checkout.service';
import { EngineRequestDto } from './engine.controller';

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
