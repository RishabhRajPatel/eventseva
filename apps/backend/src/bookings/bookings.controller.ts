import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
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
  /** Venue pin, from the address (geocoded on the phone) or the phone's location; send both. */
  @IsOptional() @IsLatitude() venueLat?: number;
  @IsOptional() @IsLongitude() venueLng?: number;
  @IsOptional() @IsString() @Length(2, 120) venueLandmark?: string;
}

/** Everything but the date can change; null clears an optional field. */
class UpdateEventDto {
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(5, 300) venueAddress?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(2, 120) venueLandmark?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsLatitude() venueLat?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsLongitude() venueLng?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) guestCount?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(2_000_000_000) budgetPaise?: number | null;
}

class CreateBookingDto {
  @IsUUID() eventId: string;
  @IsUUID() vendorId: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional() @IsUUID() packageId?: string;
  @IsIn(SLOTS) slot: Slot;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) quantity?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** When the vendor should be at the venue, 'HH:MM' (24 h, India time). */
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'arriveBy must look like 17:30' }) arriveBy?: string;
}

class BookingListQuery {
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: BookingStatus;
}

class PayQuery {
  /** advance (default), or for a confirmed engine booking: balance / deposit. */
  @IsOptional() @IsIn(['advance', 'balance', 'deposit']) part?: 'advance' | 'balance' | 'deposit';
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
  ${t}.budget_paise AS "budgetPaise", ${t}.created_at AS "createdAt", ${t}.venue_landmark AS "venueLandmark",
  CASE WHEN ${t}.venue_lat IS NULL THEN NULL ELSE json_build_object('lat', ${t}.venue_lat::float8, 'lng', ${t}.venue_lng::float8) END AS "venueLocation"`;
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
    if ((body.venueLat === undefined) !== (body.venueLng === undefined)) throw new AppError('VALIDATION', 'Send venueLat and venueLng together.');
    return this.db.one(
      this.db,
      `INSERT INTO events (customer_id, title, event_type, event_date, city_id, venue_address, guest_count, budget_paise, venue_lat, venue_lng, venue_landmark)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${EVENT_COLUMNS}`,
      [auth.userId, body.title.trim(), body.eventType, body.eventDate, body.cityId, body.venueAddress?.trim() ?? null,
        body.guestCount ?? null, body.budgetPaise ?? null, body.venueLat ?? null, body.venueLng ?? null, body.venueLandmark ?? null],
    );
  }

  /**
   * Edit an event (not its date: bookings are for that day). When the venue changes, vendors with a
   * confirmed booking are told at once, with the new details in the chat.
   */
  @Patch('events/:id')
  async updateEvent(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEventDto) {
    if ((body.venueLat === undefined) !== (body.venueLng === undefined) || (body.venueLat === null) !== (body.venueLng === null)) {
      throw new AppError('VALIDATION', 'Send venueLat and venueLng together.');
    }
    return this.db.tx(async (client) => {
      const before = await this.db.one<{ venue_address: string | null; venue_lat: string | null; venue_lng: string | null; venue_landmark: string | null }>(
        client,
        'SELECT venue_address, venue_lat, venue_lng, venue_landmark FROM events WHERE id = $1 AND customer_id = $2 FOR UPDATE',
        [id, auth.userId],
      );
      if (!before) throw new AppError('EVENT_NOT_FOUND', 'Event not found.', HttpStatus.NOT_FOUND);
      const set = (key: keyof UpdateEventDto) => body[key] !== undefined;
      const updated = await this.db.one(
        client,
        `UPDATE events SET
            title = CASE WHEN $3 THEN $4 ELSE title END,
            venue_address = CASE WHEN $5 THEN $6 ELSE venue_address END,
            venue_landmark = CASE WHEN $7 THEN $8 ELSE venue_landmark END,
            venue_lat = CASE WHEN $9 THEN $10::numeric ELSE venue_lat END,
            venue_lng = CASE WHEN $9 THEN $11::numeric ELSE venue_lng END,
            guest_count = CASE WHEN $12 THEN $13::int ELSE guest_count END,
            budget_paise = CASE WHEN $14 THEN $15::int ELSE budget_paise END
          WHERE id = $1 AND customer_id = $2 RETURNING ${EVENT_COLUMNS}`,
        [id, auth.userId, set('title'), body.title ?? null, set('venueAddress'), body.venueAddress ?? null, set('venueLandmark'),
          body.venueLandmark ?? null, set('venueLat'), body.venueLat ?? null, body.venueLng ?? null, set('guestCount'), body.guestCount ?? null,
          set('budgetPaise'), body.budgetPaise ?? null],
      );
      const venueChanged =
        (set('venueAddress') && body.venueAddress !== before.venue_address) ||
        (set('venueLandmark') && body.venueLandmark !== before.venue_landmark) ||
        (set('venueLat') && (body.venueLat ?? null) !== (before.venue_lat === null ? null : Number(before.venue_lat)));
      if (venueChanged) await this.bookings.venueChanged(client, id, auth.userId);
      return updated;
    });
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
  pay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: PayQuery) {
    return this.bookings.startPayment(auth.userId, id, q.part);
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
  async devPay(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: PayQuery) {
    await this.bookings.devPay(auth.userId, id, q.part);
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

