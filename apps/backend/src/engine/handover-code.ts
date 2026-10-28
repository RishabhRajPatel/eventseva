import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { Db, Queryable } from '../db/db.service';

export type HandoverPhase = 'handover' | 'delivery' | 'return';

/** How long a code shown in the customer's app stays valid. */
export const CODE_MINUTES = 30;
/** Wrong codes allowed per code; after that the customer opens a new one. */
const MAX_TRIES = 5;

/**
 * A 6-digit code the customer reads out to the vendor at one step: the car handover, the rental
 * delivery, or the return. Each step has its own random code, valid for 30 minutes and once only;
 * opening the code again in the app makes a new one and the old one stops working. Only a keyed
 * hash is stored. Entering it proves the customer was there and agreed to the record.
 */
@Injectable()
export class HandoverCodes {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private hash(bookingId: string, phase: HandoverPhase, code: string) {
    return createHmac('sha256', this.config.otpPepper).update(`handover|${bookingId}|${phase}|${code}`).digest('hex');
  }

  /** The step the customer's code is for now, or null when no step is waiting for one. */
  static phaseOf(b: { booking_type: string; fulfilment: string }): HandoverPhase | null {
    if (b.booking_type === 'transport') return ['scheduled', 'assigned'].includes(b.fulfilment) ? 'handover' : b.fulfilment === 'in_progress' ? 'return' : null;
    if (b.booking_type === 'rental') {
      return ['scheduled', 'preparing', 'dispatched'].includes(b.fulfilment) ? 'delivery' : ['delivered', 'return_pending'].includes(b.fulfilment) ? 'return' : null;
    }
    return null;
  }

  /** A fresh code for the booking's next step (the customer's app); the previous unused one stops working. */
  async issue(customerId: string, bookingId: string): Promise<{ code: string; phase: HandoverPhase; expiresAt: Date }> {
    return this.db.tx(async (client) => {
      const b = await this.db.one<{ booking_type: string; fulfilment: string }>(
        client,
        `SELECT booking_type, fulfilment FROM bookings WHERE id = $1 AND customer_id = $2 AND status = 'confirmed' FOR UPDATE`,
        [bookingId, customerId],
      );
      const phase = b && HandoverCodes.phaseOf(b);
      if (!phase) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000);
      await client.query(`DELETE FROM handover_codes WHERE booking_id = $1 AND phase = $2 AND used_at IS NULL`, [bookingId, phase]);
      await client.query(`INSERT INTO handover_codes (booking_id, phase, code_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
        bookingId, phase, this.hash(bookingId, phase, code), expiresAt,
      ]);
      return { code, phase, expiresAt };
    });
  }

  /**
   * Checks a code the vendor typed for one step. No code: null (the customer acknowledges later in the
   * app). Wrong, expired or used codes are refused; a wrong try is counted outside the step's
   * transaction, which is about to fail. Returns the code's id, to be used up with `consume`.
   */
  async check(vendorUserId: string, bookingId: string, phase: HandoverPhase, given: string | undefined): Promise<string | null> {
    if (given === undefined) return null;
    const mine = await this.db.one(
      this.db,
      'SELECT 1 FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND v.user_id = $2',
      [bookingId, vendorUserId],
    );
    if (!mine) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const row = await this.db.one<{ id: string; code_hash: string; expires_at: Date; attempts: number }>(
      this.db,
      `SELECT id, code_hash, expires_at, attempts FROM handover_codes WHERE booking_id = $1 AND phase = $2 AND used_at IS NULL`,
      [bookingId, phase],
    );
    if (!row || row.expires_at < new Date()) {
      throw new AppError('CODE_EXPIRED', 'This code has expired. Ask the customer to open the code again in their app.', HttpStatus.BAD_REQUEST, { field: 'customerCode' });
    }
    if (row.attempts >= MAX_TRIES) {
      throw new AppError('TOO_MANY_ATTEMPTS', 'Too many wrong codes. Ask the customer to open a new code, or record it without the code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const want = Buffer.from(row.code_hash, 'hex');
    const got = Buffer.from(this.hash(bookingId, phase, given), 'hex');
    if (timingSafeEqual(got, want)) return row.id;
    await this.db.query(`UPDATE handover_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    throw new AppError('CODE_INVALID', 'That is not the customer’s handover code.', HttpStatus.BAD_REQUEST, { field: 'customerCode' });
  }

  /**
   * Uses the code up and marks the just-written record as agreed by the customer. Inside the step's
   * transaction: a code used at the same moment by another request fails here, and nothing is saved.
   */
  async consume(q: Queryable, codeId: string, bookingId: string, phase: HandoverPhase) {
    const used = await q.query(`UPDATE handover_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL`, [codeId]);
    if (!used.rowCount) throw new AppError('CODE_INVALID', 'That code was already used.', HttpStatus.BAD_REQUEST, { field: 'customerCode' });
    await q.query(
      `UPDATE booking_inspections SET customer_ack = 'agreed', acked_at = now(), confirmed_by = 'code' WHERE booking_id = $1 AND phase = $2`,
      [bookingId, phase],
    );
  }
}
