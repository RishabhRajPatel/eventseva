import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { BOOKING_STATUSES, type BookingStatus } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { PartnerAppGuard } from '../partner/partner.controller';
import { SLOTS, type Slot } from './booking.rules';
import { loadBookings } from './booking.view';
import { BookingsService } from './bookings.service';

class StatusQuery {
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: BookingStatus;
}

class ReasonDto {
  @IsString() @Length(3, 300) reason: string;
}

class SlotDto {
  @IsDateString({ strict: true }) @Length(10, 10) day: string;
  @IsIn(SLOTS) slot: Slot;
}

class MonthQuery {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month: string;
}

/** Partner app: answer requests, cancel if really needed, and keep the calendar up to date. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerBookingsController {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingsService,
  ) {}

  @Get('bookings')
  async list(@Auth() auth: AuthContext, @Query() query: StatusQuery) {
    return { items: await loadBookings(this.db, 'vendor', { vendorUserId: auth.userId, status: query.status }) };
  }

  @Get('bookings/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.one(auth.userId, id);
  }

  @Post('bookings/:id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.bookings.accept(auth.userId, id);
    return this.one(auth.userId, id);
  }

  @Post('bookings/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.bookings.reject(auth.userId, id, body.reason.trim());
    return this.one(auth.userId, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.bookings.cancelByVendor(auth.userId, id, body.reason.trim());
    return this.one(auth.userId, id);
  }

  /** Booked and blocked slots for one month; days not listed are free. */
  @Get('calendar')
  async calendar(@Auth() auth: AuthContext, @Query() query: MonthQuery) {
    const { rows } = await this.db.query(
      `SELECT a.day, a.slot, a.status, a.booking_id AS "bookingId"
         FROM availability a JOIN vendors v ON v.id = a.vendor_id
        WHERE v.user_id = $1 AND to_char(a.day, 'YYYY-MM') = $2 ORDER BY a.day, a.slot`,
      [auth.userId, query.month],
    );
    return { month: query.month, items: rows };
  }

  @Post('calendar/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(@Auth() auth: AuthContext, @Body() body: SlotDto) {
    await this.bookings.block(auth.userId, body.day, body.slot);
  }

  @Delete('calendar/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(@Auth() auth: AuthContext, @Body() body: SlotDto) {
    await this.bookings.unblock(auth.userId, body.day, body.slot);
  }

  private async one(vendorUserId: string, id: string) {
    const [b] = await loadBookings(this.db, 'vendor', { vendorUserId, bookingId: id });
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }
}
