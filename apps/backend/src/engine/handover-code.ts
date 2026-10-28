import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { Db, Queryable } from '../db/db.service';

/** Wrong codes allowed per booking per hour before the vendor has to wait. */
const MAX_FAILS_PER_HOUR = 5;

/**
 * A 6-digit code the customer shows in their app and reads out to the vendor at the handover or
 * return. Entering it proves the customer was there and agreed to the record. It is derived from
 * the booking id with a server secret, so nothing is stored and it never changes for a booking.
 */
@Injectable()
export class HandoverCodes {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  codeFor(bookingId: string): string {
    const n = createHmac('sha256', this.config.otpPepper).update(`handover|${bookingId}`).digest().readUInt32BE(0);
    return String(n % 1_000_000).padStart(6, '0');
  }

  /**
   * Checks a code the vendor typed. No code: false (the customer acknowledges later in the app).
   * A wrong one is counted and refused; after 5 in an hour the booking is locked for a while.
   */
  async check(vendorUserId: string, bookingId: string, given: string | undefined): Promise<boolean> {
    if (given === undefined) return false;
    const mine = await this.db.one(
      this.db,
      'SELECT 1 FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND v.user_id = $2',
      [bookingId, vendorUserId],
    );
    if (!mine) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const fails = await this.db.one<{ n: number }>(
      this.db,
      `SELECT count(*)::int AS n FROM booking_events WHERE booking_id = $1 AND event = 'handover_code_failed' AND created_at > now() - interval '1 hour'`,
      [bookingId],
    );
    if (fails!.n >= MAX_FAILS_PER_HOUR) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Too many wrong codes. Try again in an hour, or record it without the code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const want = Buffer.from(this.codeFor(bookingId));
    const got = Buffer.from(given);
    if (got.length === want.length && timingSafeEqual(got, want)) return true;
    // Recorded outside the step's transaction, which is about to fail.
    await this.db.query(`INSERT INTO booking_events (booking_id, event, actor_id) VALUES ($1, 'handover_code_failed', $2)`, [bookingId, vendorUserId]);
    throw new AppError('CODE_INVALID', 'That is not the customer’s handover code.', HttpStatus.BAD_REQUEST, { field: 'customerCode' });
  }

  /** Marks a just-written inspection as agreed by the customer. */
  async confirm(q: Queryable, bookingId: string, phase: string) {
    await q.query(
      `UPDATE booking_inspections SET customer_ack = 'agreed', acked_at = now(), confirmed_by = 'code' WHERE booking_id = $1 AND phase = $2`,
      [bookingId, phase],
    );
  }
}
