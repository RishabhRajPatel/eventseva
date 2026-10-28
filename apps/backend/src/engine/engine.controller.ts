import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { AppError } from '../common/errors';
import { CloudinaryService } from '../media/cloudinary.service';
import { EngineService } from './engine.service';
import type { EngineRequest } from './types';

class LineDto {
  @IsUUID() itemId: string;
  @IsInt() @Min(1) @Max(100_000) qty: number;
}

class AddonDto {
  @IsUUID() addonId: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class PlaceDto {
  @IsString() @Length(3, 300) address: string;
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
}

class RouteDto {
  @ValidateNested() @Type(() => PlaceDto) pickup: PlaceDto;
  @ValidateNested() @Type(() => PlaceDto) destination: PlaceDto;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PlaceDto) stops?: PlaceDto[];
}

/** One body for a price check (quote) and for the booking request itself. */
export class EngineRequestDto implements EngineRequest {
  @IsUUID() eventId: string;
  @IsUUID() serviceId: string;
  @IsString() @MaxLength(40) startsAt: string;
  @IsOptional() @IsString() @MaxLength(40) endsAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) quantity?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) guestCount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) people?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) lines?: LineDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => AddonDto) addons?: AddonDto[];
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
  @IsOptional() @ValidateNested() @Type(() => RouteDto) route?: RouteDto;
  @IsOptional() @IsIn(['with_driver', 'self_drive']) mode?: 'with_driver' | 'self_drive';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class LicencePhotoDto {
  @IsString() @MaxLength(255) publicId: string;
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/^[0-9a-f]{40}$/i) signature: string;
  @Matches(/^(jpg|jpeg|png|pdf)$/) format: string;
}

class LicenceDto {
  @IsString() @Length(8, 25) number: string;
  @IsDateString({ strict: true }) @Length(10, 10) dateOfBirth: string;
  @IsDateString({ strict: true }) @Length(10, 10) expiresOn: string;
  /** Cloudinary's signed reply for the licence photo (POST /v1/me/licence/upload first). */
  @IsOptional() @ValidateNested() @Type(() => LicencePhotoDto) photo?: LicencePhotoDto;
}

/**
 * Customer app: price check and booking for services booked by time, quantity or items (rentals,
 * catering, cars, staff, appointments …). Day + slot bookings stay on POST /v1/bookings.
 */
@UseGuards(AuthGuard)
@Controller('v1')
export class EngineController {
  constructor(
    private readonly engine: EngineService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('quotes')
  @HttpCode(HttpStatus.OK)
  quote(@Auth() auth: AuthContext, @Body() body: EngineRequestDto) {
    return this.engine.quote(auth.userId, body);
  }

  /** Repeating a request with the same Idempotency-Key returns the booking already made. */
  @Post('engine-bookings')
  async request(@Auth() auth: AuthContext, @Body() body: EngineRequestDto, @Headers('idempotency-key') key?: string) {
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
      throw new AppError('VALIDATION', 'Idempotency-Key: 8 to 64 letters, digits, - or _.', HttpStatus.BAD_REQUEST, { field: 'Idempotency-Key' });
    }
    return { id: await this.engine.request(auth.userId, body, key) };
  }

  @Get('me/licence')
  async licence(@Auth() auth: AuthContext) {
    return { licence: await this.engine.licence(auth.userId) };
  }

  /** A signed, private upload for the licence photo. */
  @Post('me/licence/upload')
  @HttpCode(HttpStatus.OK)
  signLicencePhoto(@Auth() auth: AuthContext) {
    return this.cloudinary.signLicenceUpload(auth.userId);
  }

  @Put('me/licence')
  saveLicence(@Auth() auth: AuthContext, @Body() body: LicenceDto) {
    return this.engine.saveLicence(auth.userId, body);
  }
}
