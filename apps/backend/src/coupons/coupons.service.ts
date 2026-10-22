import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { discountFor, type CouponTerms } from './coupon.rules';

interface CouponRow extends CouponTerms {
  id: number;
  code: string;
  min_amount_paise: number;
  category_id: number | null;
  first_booking_only: boolean;
  max_uses: number | null;
  per_customer_limit: number;
  is_active: boolean;
  live: boolean;
}

/** Statuses during which a coupon can still be added, changed or removed (before payment). */
const OPEN = ['requested', 'accepted'];

@Injectable()
export class CouponsService {
  constructor(private readonly db: Db) {}

  /** Applies a code to an unpaid booking (replacing any earlier one); returns the discount. */
  async apply(customerId: string, bookingId: string, rawCode: string): Promise<number> {
    const code = rawCode.trim().toUpperCase();
    return this.db.tx(async (client) => {
      const b = await this.openBooking(client, customerId, bookingId);
      // Locking the coupon puts concurrent uses in a queue, so max_uses holds.
      const c = await this.db.one<CouponRow>(
        client,
        `SELECT *, (is_active AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())) AS live
           FROM coupons WHERE code = $1 FOR UPDATE`,
        [code],
      );
      if (!c || !c.live) throw new AppError('COUPON_INVALID', 'This coupon code is not valid or has expired.');
      if (c.category_id !== null && c.category_id !== b.category_id) {
        throw new AppError('COUPON_NOT_APPLICABLE', 'This coupon is not for this kind of service.', HttpStatus.BAD_REQUEST, { reason: 'category' });
      }
      if (b.amount_paise < c.min_amount_paise) {
        throw new AppError('COUPON_NOT_APPLICABLE', 'The booking amount is below this coupon’s minimum.', HttpStatus.BAD_REQUEST, {
          reason: 'min_amount',
          minAmountPaise: c.min_amount_paise,
        });
      }
      if (c.first_booking_only) {
        const earlier = await this.db.one(
          client,
          `SELECT 1 FROM bookings WHERE customer_id = $1 AND id <> $2 AND status IN ('confirmed', 'completed')`,
          [customerId, bookingId],
        );
        if (earlier) {
          throw new AppError('COUPON_NOT_APPLICABLE', 'This coupon is only for your first booking.', HttpStatus.BAD_REQUEST, { reason: 'first_booking' });
        }
      }
      const uses = await this.db.one<{ total: number; mine: number }>(
        client,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE customer_id = $2)::int AS mine
           FROM coupon_redemptions WHERE coupon_id = $1 AND status <> 'released' AND booking_id <> $3`,
        [c.id, customerId, bookingId],
      );
      if (uses!.mine >= c.per_customer_limit) throw new AppError('COUPON_ALREADY_USED', 'You have already used this coupon.', HttpStatus.CONFLICT);
      if (c.max_uses !== null && uses!.total >= c.max_uses) throw new AppError('COUPON_USED_UP', 'This coupon has been fully used.', HttpStatus.CONFLICT);

      const discount = discountFor(c, b.amount_paise, b.advance_paise);
      if (discount <= 0) throw new AppError('COUPON_NOT_APPLICABLE', 'This coupon gives no discount on this booking.', HttpStatus.BAD_REQUEST, { reason: 'zero' });

      await this.releaseFor(client, bookingId);
      await client.query(
        `INSERT INTO coupon_redemptions (coupon_id, booking_id, customer_id, discount_paise) VALUES ($1, $2, $3, $4)`,
        [c.id, bookingId, customerId, discount],
      );
      await client.query('UPDATE bookings SET discount_paise = $2, updated_at = now() WHERE id = $1', [bookingId, discount]);
      return discount;
    });
  }

  async remove(customerId: string, bookingId: string) {
    await this.db.tx(async (client) => {
      await this.openBooking(client, customerId, bookingId);
      await this.releaseFor(client, bookingId);
    });
  }

  /** Gives the use back (booking removed the coupon, ended or expired unpaid). */
  async releaseFor(q: Queryable, bookingId: string) {
    await q.query(`UPDATE coupon_redemptions SET status = 'released' WHERE booking_id = $1 AND status = 'applied'`, [bookingId]);
    await q.query(
      `UPDATE bookings SET discount_paise = 0 WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM coupon_redemptions WHERE booking_id = $1 AND status = 'used')`,
      [bookingId],
    );
  }

  /** The advance was paid with the discount: the coupon counts as used. */
  async markUsed(q: Queryable, bookingId: string) {
    await q.query(`UPDATE coupon_redemptions SET status = 'used', used_at = now() WHERE booking_id = $1 AND status = 'applied'`, [bookingId]);
  }

  private async openBooking(q: Queryable, customerId: string, bookingId: string) {
    const b = await this.db.one<{ status: string; amount_paise: number; advance_paise: number; category_id: number; paid: boolean }>(
      q,
      `SELECT b.status, b.amount_paise, b.advance_paise, v.category_id,
              EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.type = 'advance' AND p.status = 'paid') AS paid
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND b.customer_id = $2 FOR UPDATE OF b`,
      [bookingId, customerId],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    if (!OPEN.includes(b.status) || b.paid) {
      throw new AppError('COUPON_NOT_ALLOWED', 'Coupons can only be changed before you pay.', HttpStatus.CONFLICT, { status: b.status });
    }
    return b;
  }
}
