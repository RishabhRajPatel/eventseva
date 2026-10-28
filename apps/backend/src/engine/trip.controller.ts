import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Db } from '../db/db.service';
import { HandoverCodes } from './handover-code';
import { Auth, AuthGuard } from '../auth/auth.guard';
import { SignedPhotoDto } from '../media/signed-photo.dto';
import { AppError } from '../common/errors';
import type { AuthContext } from '../auth/token.service';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { PartnerAppGuard } from '../partner/partner.controller';
import { EngineService } from './engine.service';
import { TripService } from './trip.service';

class AssignDto {
  @IsUUID() driverId: string;
}

class InspectionDto {
  @IsInt() @Min(0) @Max(2_000_000) odometerKm: number;
  @IsInt() @Min(0) @Max(8) fuelEighths: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => SignedPhotoDto) photos?: SignedPhotoDto[];
  @IsOptional() @Matches(/^\d{6}$/, { message: 'customerCode must be the 6 digits in the customer app' }) customerCode?: string;
}

class DamageDto {
  @IsString() @Length(3, 200) description: string;
  @IsInt() @Min(100) @Max(10_000_000) amountPaise: number;
}

class ReturnDto extends InspectionDto {
  @IsOptional() @IsInt() @Min(0) @Max(5_000_000) fuelPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(5_000_000) tollsPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) parkingPaise?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DamageDto) damage?: DamageDto[];
}

class AckDto {
  @IsIn(['agreed', 'disputed']) decision: 'agreed' | 'disputed';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class LicenceDecisionDto {
  @IsIn(['verify', 'reject']) decision: 'verify' | 'reject';
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}

/** Partner app: driver, handover and return for a car booking. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/bookings/:id/trip')
export class PartnerTripController {
  constructor(private readonly trips: TripService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.view(id, { vendorUserId: auth.userId });
  }

  @Post('driver')
  @HttpCode(HttpStatus.OK)
  async assign(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: AssignDto) {
    await this.trips.assignDriver(auth.userId, id, body.driverId);
    return this.get(auth, id);
  }

  @Post('handover')
  @HttpCode(HttpStatus.OK)
  async handover(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: InspectionDto) {
    await this.trips.handover(auth.userId, id, body);
    return this.get(auth, id);
  }

  @Post('return')
  @HttpCode(HttpStatus.OK)
  async returnCar(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReturnDto) {
    await this.trips.returnCar(auth.userId, id, body);
    return this.get(auth, id);
  }
}

/** Customer app: the trip, and agreeing to or disputing the handover / return record. */
@UseGuards(AuthGuard)
@Controller('v1/bookings/:id')
export class TripController {
  constructor(
    private readonly trips: TripService,
    private readonly codes: HandoverCodes,
    private readonly db: Db,
  ) {}

  /** The code the customer reads out at the handover and the return (cars and rentals, once confirmed). */
  @Get('handover-code')
  async handoverCode(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const b = await this.db.one(
      this.db,
      `SELECT 1 FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 'confirmed' AND booking_type IN ('transport', 'rental')`,
      [id, auth.userId],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return { code: this.codes.codeFor(id) };
  }

  @Get('trip')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.view(id, { customerId: auth.userId });
  }

  @Post('inspections/:phase/ack')
  @HttpCode(HttpStatus.OK)
  async ack(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('phase') phase: string, @Body() body: AckDto) {
    if (phase !== 'handover' && phase !== 'return') throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    await this.trips.acknowledge(auth.userId, id, phase, body.decision, body.note);
    return this.get(auth, id);
  }
}

/** Admin: driving licences for self-drive cars. */
@UseGuards(AdminGuard)
@Controller('v1/admin/licences')
export class AdminLicencesController {
  constructor(private readonly engine: EngineService) {}

  @AdminRoles('verifier')
  @Get('pending')
  async pending() {
    return { items: await this.engine.pendingLicences() };
  }

  @AdminRoles('verifier')
  @Post(':userId/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Admin() admin: AdminContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: LicenceDecisionDto) {
    return this.engine.verifyLicence(admin.adminId, userId, body.decision, body.reason);
  }
}
