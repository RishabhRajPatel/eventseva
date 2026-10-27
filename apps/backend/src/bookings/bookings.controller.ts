import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { BOOKING_STATUSES, type BookingStatus } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { EVENT_TYPES, lastPlannableDay, MAX_DAYS_AHEAD, SLOTS, type Slot, todayIst } from './booking.rules';
import { loadBookings } from './booking.view';
import { BookingsService } from './bookings.service';

class CreateEventDto {
  @IsString() @Length(2, 80) title: string;
  @IsIn(EVENT_TYPES) eventType: string;
  @IsDateString({ strict: true }) @Length(10, 10) eventDate: string;
  @IsInt() @Min(1) cityId: number;
  @IsOptional() @IsString() @Length(5, 300) venueAddress?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) guestCount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) budgetPaise?: number;
}

class CreateBookingDto {
  @IsUUID() eventId: string;
  @IsUUID() vendorId: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional() @IsUUID() packageId?: string;
  @IsIn(SLOTS) slot: Slot;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) quantity?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class BookingListQuery {
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: BookingStatus;
}

class VerifyPaymentDto {
  @IsString() @MaxLength(64) razorpayOrderId: string;
  @IsString() @MaxLength(64) razorpayPaymentId: string;
  @IsString() @MaxLength(128) razorpaySignature: string;
}

class ReasonDto {
  @IsString() @Length(3, 300) reason: string;
}

const eventColumns = (t = 'events') => `${t}.id, ${t}.title, ${t}.event_type AS "eventType", ${t}.event_date AS "eventDate",
  ${t}.city_id AS "cityId", ${t}.venue_address AS "venueAddress", ${t}.guest_count AS "guestCount",
  ${t}.budget_paise AS "budgetPaise", ${t}.created_at AS "createdAt"`;
const EVENT_COLUMNS = eventColumns();

/** Customer app: plan an event, book vendors for it, pay the advance, cancel. */
@UseGuards(AuthGuard)
@Controller('v1')
export class BookingsController {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingsService,
  ) {}

  @Post('events')
  async createEvent(@Auth() auth: AuthContext, @Body() body: CreateEventDto) {
    if (body.eventDate < todayIst()) throw new AppError('EVENT_IN_PAST', 'Choose a date from today onwards.');
    if (body.eventDate > lastPlannableDay()) {
      throw new AppError('DATE_TOO_FAR', `Events can be planned up to ${MAX_DAYS_AHEAD / 365} years ahead.`, HttpStatus.BAD_REQUEST, { lastDay: lastPlannableDay() });
    }
    const city = await this.db.one(this.db, 'SELECT 1 FROM cities WHERE id = $1 AND is_active', [body.cityId]);
    if (!city) throw new AppError('CITY_NOT_FOUND', 'We are not in this city yet.');
    return this.db.one(
      this.db,
      `INSERT INTO events (customer_id, title, event_type, event_date, city_id, venue_address, guest_count, budget_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${EVENT_COLUMNS}`,
      [auth.userId, body.title.trim(), body.eventType, body.eventDate, body.cityId, body.venueAddress?.trim() ?? null,
        body.guestCount ?? null, body.budgetPaise ?? null],
    );
  }

  /** "My events", each with how many vendors are booked and how much is committed. */
  @Get('events')
  async events(@Auth() auth: AuthContext) {
    const { rows } = await this.db.query(
      `SELECT ${eventColumns('e')},
              count(b.id) FILTER (WHERE b.status IN ('confirmed', 'completed'))::int AS "confirmedCount",
              count(b.id) FILTER (WHERE b.status IN ('requested', 'accepted'))::int AS "pendingCount",
              COALESCE(sum(b.amount_paise) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0)::int AS "committedPaise"
         FROM events e LEFT JOIN bookings b ON b.event_id = e.id
        WHERE e.customer_id = $1 GROUP BY e.id ORDER BY e.event_date, e.created_at`,
      [auth.userId],
    );
    return { items: rows };
  }

  @Get('events/:id')
  async event(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const event = await this.db.one(this.db, `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 AND customer_id = $2`, [id, auth.userId]);
    if (!event) throw new AppError('EVENT_NOT_FOUND', 'Event not found.', HttpStatus.NOT_FOUND);
    return { ...event, bookings: await loadBookings(this.db, 'customer', { customerId: auth.userId, eventId: id }) };
  }

  @Post('bookings')
  async create(@Auth() auth: AuthContext, @Body() body: CreateBookingDto) {
    const id = await this.bookings.request(auth.userId, body);
    return (await loadBookings(this.db, 'customer', { bookingId: id }))[0];
  }

  @Get('bookings')
  async list(@Auth() auth: AuthContext, @Query() query: BookingListQuery) {
    return { items: await loadBookings(this.db, 'customer', { customerId: auth.userId, ...query }) };
  }

  @Get('bookings/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.one(auth.userId, id);
  }

  @Post('bookings/:id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.startPayment(auth.userId, id);
  }

  @Post('bookings/:id/pay/verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyPaymentDto) {
    await this.bookings.verifyPayment(auth.userId, id, body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
    return this.one(auth.userId, id);
  }

  /** Test payments while PAYMENT_PROVIDER=fake (404 otherwise). */
  @Post('bookings/:id/pay/dev')
  @HttpCode(HttpStatus.OK)
  async devPay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.bookings.devPay(auth.userId, id);
    return this.one(auth.userId, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    await this.bookings.cancelByCustomer(auth.userId, id, body.reason.trim());
    return this.one(auth.userId, id);
  }

  private async one(customerId: string, id: string) {
    const [b] = await loadBookings(this.db, 'customer', { customerId, bookingId: id });
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }
}

