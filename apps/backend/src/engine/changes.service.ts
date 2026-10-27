// Changing a booked time: a reschedule (new start and end, before anything has started) or an
// extension (a later end, also while the service is going on). The customer asks, the vendor approves
// or declines. Approving takes the new times atomically: the booking's own holds are released and the
// new ones taken in one savepoint, so if the new time is not free the old booking stays exactly as it
// was. The price difference comes from the rates agreed in the booking, never today's listing.
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { RefundsService } from '../payments/refunds.service';
import { enginePayBy, EngineService } from './engine.service';
import { moveAll, Unavailable } from './reservations';
import { istDay, parseTime } from './rules';
import type { Quote } from './types';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const when = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

interface ChangeBooking {
  id: string;
  customer_id: string;
  vendor_id: string;
  vendor_user_id: string;
  status: string;
  booking_type: string;
  fulfilment: string;
  starts_at: Date;
  ends_at: Date;
  pay_by: Date | null;
  amount_paise: number;
  tax_paise: number;
  commission_paise: number;
  refund_paise: number;
  snapshot: Record<string, unknown> & { quote: Quote; changes?: unknown[] };
}

export interface ChangeRequest {
  kind: 'reschedule' | 'extension';
  startsAt?: string;
  endsAt: string;
  reason?: string;
}

const CHANGE_COLUMNS = `id, kind, new_starts_at AS "startsAt", new_ends_at AS "endsAt", price_diff_paise AS "priceDiffPaise", status, reason,
  created_at AS "createdAt", decided_at AS "decidedAt"`;

@Injectable()
export class ChangesService {
  constructor(
    private readonly db: Db,
    private readonly engine: EngineService,
    private readonly refunds: RefundsService,
  ) {}

  private async lock(q: Queryable, bookingId: string, who: { customerId?: string; vendorUserId?: string }): Promise<ChangeBooking> {
    const b = await this.db.one<ChangeBooking>(
      q,
      `SELECT b.id, b.customer_id, b.vendor_id, v.user_id AS vendor_user_id, b.status, b.booking_type, b.fulfilment, b.starts_at, b.ends_at, b.pay_by,
              b.amount_paise, b.tax_paise, b.commission_paise, b.refund_paise, b.snapshot
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR b.customer_id = $2) AND ($3::uuid IS NULL OR v.user_id = $3)
        FOR UPDATE OF b`,
      [bookingId, who.customerId ?? null, who.vendorUserId ?? null],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }

  /** New times are valid for this booking and this kind of change. */
  private times(b: ChangeBooking, body: { kind: string; startsAt?: string | Date | null; endsAt: string | Date }) {
    if (b.booking_type === 'slot') throw new AppError('CHANGE_NOT_SUPPORTED', 'Day and slot bookings are changed by cancelling and booking again.', HttpStatus.CONFLICT);
    if (!['accepted', 'confirmed'].includes(b.status)) throw new AppError('BOOKING_BAD_STATUS', 'Only accepted or confirmed bookings can be changed.', HttpStatus.CONFLICT, { status: b.status });
    if (b.fulfilment === 'closed') throw new AppError('BOOKING_BAD_STATUS', 'This booking is finished.', HttpStatus.CONFLICT, { status: b.status });
    const ends = body.endsAt instanceof Date ? body.endsAt : parseTime(body.endsAt, 'endsAt');
    let starts = b.starts_at;
    if (body.kind === 'reschedule') {
      if (b.fulfilment !== 'scheduled') throw new AppError('BOOKING_IN_PROGRESS', 'This booking has already started; you can only extend it.', HttpStatus.CONFLICT);
      if (!body.startsAt) throw new AppError('VALIDATION', 'startsAt is required.', HttpStatus.BAD_REQUEST, { field: 'startsAt' });
      starts = body.startsAt instanceof Date ? body.startsAt : parseTime(body.startsAt, 'startsAt');
      if (starts.getTime() < Date.now()) throw new AppError('DATE_IN_PAST', 'The new start has already passed.', HttpStatus.BAD_REQUEST);
    } else if (ends.getTime() <= b.ends_at.getTime()) {
      throw new AppError('VALIDATION', 'An extension must end later than the booking does now.', HttpStatus.BAD_REQUEST, { field: 'endsAt' });
    }
    if (ends.getTime() <= starts.getTime()) throw new AppError('TIME_ORDER', 'The end must be after the start.', HttpStatus.BAD_REQUEST);
    return { starts, ends };
  }

  /**
   * Prices the change and, inside a savepoint, takes the new times. With `keep` false the savepoint
   * is rolled back (a feasibility check); with true the move stands.
   */
  private async tryMove(q: Queryable, b: ChangeBooking, starts: Date, ends: Date, keep: boolean) {
    const { plan, quote, commissionPaise } = await this.engine.planChange(q, b, starts, ends);
    const confirmed = b.status === 'confirmed';
    await q.query('SAVEPOINT change_times');
    try {
      await moveAll(q, plan.needs, {
        bookingId: b.id,
        vendorId: b.vendor_id,
        from: plan.occupyFrom,
        until: plan.occupyUntil,
        status: confirmed ? 'active' : 'hold',
        expiresAt: confirmed ? null : (b.pay_by ?? enginePayBy(starts)),
      });
      // Rental stock already out stays counted as out until it is checked back in.
      if (['dispatched', 'delivered', 'return_pending'].includes(b.fulfilment)) {
        await q.query(`UPDATE capacity_holds SET until_returned = true WHERE booking_id = $1 AND status = 'active'`, [b.id]);
      }
    } catch (err) {
      await q.query('ROLLBACK TO SAVEPOINT change_times');
      if (err instanceof Unavailable) throw err;
      throw err;
    }
    if (!keep) await q.query('ROLLBACK TO SAVEPOINT change_times');
    else await q.query('RELEASE SAVEPOINT change_times');
    return { plan, quote, commissionPaise, diff: quote.totalPaise - b.snapshot.quote.totalPaise };
  }

  async request(customerId: string, bookingId: string, body: ChangeRequest) {
    return this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { customerId });
      const { starts, ends } = this.times(b, body);
      const { diff } = await this.tryMove(client, b, starts, ends, false);
      let row;
      try {
        row = await this.db.one(
          client,
          `INSERT INTO booking_changes (booking_id, kind, requested_by, new_starts_at, new_ends_at, price_diff_paise, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CHANGE_COLUMNS}`,
          [b.id, body.kind, customerId, starts, ends, diff, body.reason?.trim() || null],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new AppError('CHANGE_PENDING', 'A change is already waiting for the vendor.', HttpStatus.CONFLICT);
        throw err;
      }
      await client.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, 'change_requested', $2, $3)`, [b.id, customerId, { kind: body.kind, diff }]);
      await notify(client, b.vendor_user_id, 'change_requested', {
        en: { title: body.kind === 'extension' ? 'Extension requested' : 'New time requested', body: `${when(starts)} to ${when(ends)}${diff ? ` (${diff > 0 ? '+' : '−'}${rupees(Math.abs(diff))})` : ''}. Please answer soon.` },
        hi: { title: body.kind === 'extension' ? 'समय बढ़ाने की रिक्वेस्ट' : 'नए समय की रिक्वेस्ट', body: `${when(starts)} से ${when(ends)}${diff ? ` (${diff > 0 ? '+' : '−'}${rupees(Math.abs(diff))})` : ''}। जल्दी जवाब दें।` },
      }, { bookingId: b.id }, 'partner');
      return row;
    });
  }

  async list(bookingId: string, who: { customerId?: string; vendorUserId?: string }) {
    await this.lock(this.db, bookingId, who);
    return (await this.db.query(`SELECT ${CHANGE_COLUMNS} FROM booking_changes WHERE booking_id = $1 ORDER BY created_at DESC`, [bookingId])).rows;
  }

  async cancel(customerId: string, bookingId: string, changeId: string) {
    await this.lock(this.db, bookingId, { customerId });
    const r = await this.db.query(`UPDATE booking_changes SET status = 'cancelled', decided_at = now() WHERE id = $1 AND booking_id = $2 AND status = 'requested'`, [changeId, bookingId]);
    if (!r.rowCount) throw new AppError('NOT_FOUND', 'No open change found.', HttpStatus.NOT_FOUND);
  }

  /**
   * The vendor approves: new times, holds and price in one transaction. A higher price is added to
   * the balance; if more has been paid than the new price, the difference is refunded.
   */
  async approve(vendorUserId: string, bookingId: string, changeId: string) {
    const result = await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      const c = await this.db.one<{ kind: string; new_starts_at: Date; new_ends_at: Date }>(
        client,
        `SELECT kind, new_starts_at, new_ends_at FROM booking_changes WHERE id = $1 AND booking_id = $2 AND status = 'requested' FOR UPDATE`,
        [changeId, b.id],
      );
      if (!c) throw new AppError('NOT_FOUND', 'No open change found.', HttpStatus.NOT_FOUND);
      const { starts, ends } = this.times(b, { kind: c.kind, startsAt: c.new_starts_at, endsAt: c.new_ends_at });
      const moved = await this.tryMove(client, b, starts, ends, true);
      const { plan, quote } = moved;
      const old = b.snapshot.quote;
      const amount = b.amount_paise + moved.diff;
      const tax = b.tax_paise + (quote.taxPaise - old.taxPaise);
      const commission = Math.max(0, b.commission_paise + (moved.commissionPaise - Math.round((old.subtotalPaise * moved.commissionPaise) / Math.max(1, quote.subtotalPaise))));
      const history = [...(b.snapshot.changes ?? []), { id: changeId, kind: c.kind, from: { startsAt: b.starts_at, endsAt: b.ends_at }, diffPaise: moved.diff, at: new Date() }];
      await client.query(
        `UPDATE bookings SET starts_at = $2, ends_at = $3, occupy_from = $4, occupy_until = $5, return_due_at = $6, day = $7, amount_paise = $8, tax_paise = $9,
                commission_paise = $10, snapshot = snapshot || jsonb_build_object('quote', $11::jsonb, 'changes', $12::jsonb), updated_at = now()
          WHERE id = $1`,
        [b.id, plan.starts, plan.ends, plan.occupyFrom, plan.occupyUntil, plan.returnDue, istDay(plan.starts), amount, tax, commission, quote, JSON.stringify(history)],
      );
      for (const s of plan.stock) await client.query('UPDATE booking_lines SET unit_paise = $3 WHERE booking_id = $1 AND inventory_item_id = $2', [b.id, s.itemId, s.unitPaise]);
      await client.query(`UPDATE booking_changes SET status = 'approved', decided_at = now(), price_diff_paise = $2 WHERE id = $1`, [changeId, moved.diff]);
      await client.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, 'change_approved', $2, $3)`, [b.id, vendorUserId, { kind: c.kind, diff: moved.diff }]);

      // Paid more than the new price (a shorter reschedule): the excess goes back.
      const paid = await this.db.one<{ id: string; razorpay_payment_id: string; amount_paise: number; type: string }>(
        client,
        `SELECT id, razorpay_payment_id, amount_paise, type FROM payments WHERE booking_id = $1 AND type IN ('advance', 'final') AND status = 'paid' ORDER BY type DESC, paid_at DESC LIMIT 1`,
        [b.id],
      );
      const totalPaid = (await this.db.one<{ s: number }>(client, `SELECT COALESCE(sum(amount_paise), 0)::int AS s FROM payments WHERE booking_id = $1 AND type IN ('advance', 'final') AND status = 'paid'`, [b.id]))!.s;
      const excess = totalPaid - b.refund_paise - amount;
      if (excess > 0 && paid) {
        await this.refunds.queue(client, b.id, paid.razorpay_payment_id, Math.min(excess, paid.amount_paise), 'change_cheaper');
        await client.query('UPDATE bookings SET refund_paise = refund_paise + $2 WHERE id = $1', [b.id, Math.min(excess, paid.amount_paise)]);
      }
      await notify(client, b.customer_id, 'change_approved', {
        en: { title: 'Change approved', body: `Now ${when(plan.starts)} to ${when(plan.ends)}.${moved.diff > 0 ? ` ${rupees(moved.diff)} more is added to the balance.` : moved.diff < 0 ? ` ${rupees(-moved.diff)} less.` : ''}` },
        hi: { title: 'बदलाव मंज़ूर', body: `अब ${when(plan.starts)} से ${when(plan.ends)} तक।${moved.diff > 0 ? ` ${rupees(moved.diff)} बाकी रकम में जुड़े।` : moved.diff < 0 ? ` ${rupees(-moved.diff)} कम।` : ''}` },
      }, { bookingId: b.id }, 'customer');
      return { excess };
    });
    if (result.excess > 0) await this.refunds.flush();
  }

  async reject(vendorUserId: string, bookingId: string, changeId: string, reason: string) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      const r = await client.query(`UPDATE booking_changes SET status = 'rejected', decided_at = now(), reason = $3 WHERE id = $1 AND booking_id = $2 AND status = 'requested'`, [changeId, b.id, reason]);
      if (!r.rowCount) throw new AppError('NOT_FOUND', 'No open change found.', HttpStatus.NOT_FOUND);
      await notify(client, b.customer_id, 'change_rejected', {
        en: { title: 'Change not possible', body: `${reason}. Your booking stays as it was.` },
        hi: { title: 'बदलाव नहीं हो सका', body: `${reason}। आपकी बुकिंग पहले जैसी है।` },
      }, { bookingId: b.id }, 'customer');
    });
  }
}
