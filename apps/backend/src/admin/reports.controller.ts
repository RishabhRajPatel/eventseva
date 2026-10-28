import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, Length } from 'class-validator';
import { Db } from '../db/db.service';
import { PaymentEventsService } from '../payments/payment-events.service';
import { RefundsService } from '../payments/refunds.service';
import { Admin, AdminContext, AdminGuard, AdminRoles } from './admin-auth';
import { StepUp } from './admin-2fa';

class RangeQuery {
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Length(10, 10) to?: string;
}

class PaymentEventsQuery {
  @IsOptional() @IsIn(['received', 'processed', 'ignored', 'failed', 'problems']) status?: string;
}

class RefundsQuery {
  @IsOptional() @IsIn(['pending', 'sending', 'sent', 'processed', 'failed']) status?: string;
}

/** 'YYYY-MM-DD' of the last day in the month of `day`. */
export function lastDayOfMonth(day: string): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Admin: money and booking numbers for a period, open disputes (charges and inspections the customer
 * disagrees with), and refunds with their Razorpay result.
 */
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminReportsController {
  constructor(
    private readonly db: Db,
    private readonly refunds: RefundsService,
    private readonly paymentEvents: PaymentEventsService,
  ) {}

  /** Event days from `from` to `to` (default: this whole month, so upcoming events count too), India time. */
  @AdminRoles('finance', 'support')
  @Get('reports/summary')
  async summary(@Query() q: RangeQuery) {
    const from = q.from ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 8) + '01';
    const to = q.to ?? lastDayOfMonth(from);
    const byStatus = await this.db.query(
      `SELECT status, booking_type AS "bookingType", count(*)::int AS bookings, COALESCE(sum(amount_paise), 0)::bigint::text AS "amountPaise"
         FROM bookings WHERE day BETWEEN $1 AND $2 GROUP BY status, booking_type ORDER BY status, booking_type`,
      [from, to],
    );
    const byCategory = await this.db.query(
      `SELECT c.slug, c.name_en AS name, count(*)::int AS bookings, COALESCE(sum(b.amount_paise), 0)::bigint::text AS "amountPaise"
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE b.day BETWEEN $1 AND $2 AND b.status IN ('confirmed', 'completed') GROUP BY c.slug, c.name_en ORDER BY count(*) DESC`,
      [from, to],
    );
    const money = await this.db.one(
      this.db,
      `SELECT
         COALESCE((SELECT sum(amount_paise) FROM bookings WHERE day BETWEEN $1 AND $2 AND status IN ('confirmed', 'completed')), 0)::bigint::text AS "bookedValuePaise",
         COALESCE((SELECT sum(commission_paise) FROM bookings WHERE day BETWEEN $1 AND $2 AND status = 'completed'), 0)::bigint::text AS "commissionPaise",
         COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.type = 'advance' AND p.status IN ('paid', 'refunded') AND (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2), 0)::bigint::text AS "advancesPaise",
         COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.type = 'final' AND p.status IN ('paid', 'refunded') AND (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2), 0)::bigint::text AS "balancesPaise",
         COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.type = 'deposit' AND p.status IN ('paid', 'refunded') AND (p.paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2), 0)::bigint::text AS "depositsPaise",
         COALESCE((SELECT sum(r.amount_paise) FROM refunds r WHERE r.status IN ('sent', 'processed') AND (r.sent_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1 AND $2), 0)::bigint::text AS "refundsPaise",
         COALESCE((SELECT sum(o.amount_paise) FROM payouts o JOIN bookings b ON b.id = o.booking_id WHERE b.day BETWEEN $1 AND $2), 0)::bigint::text AS "payoutsPaise",
         (SELECT count(*)::int FROM refunds WHERE status = 'failed' AND reason NOT LIKE '%:retried') AS "failedRefunds"`,
      [from, to],
    );
    return { from, to, money, byStatus: byStatus.rows, byCategory: byCategory.rows };
  }

  /** Charges and inspection records a customer disputes, oldest first. */
  @AdminRoles('support', 'finance')
  @Get('disputes')
  async disputes() {
    const charges = await this.db.query(
      `SELECT c.id, c.booking_id AS "bookingId", c.kind, c.description, c.amount_paise AS "amountPaise", c.decision_note AS "customerNote",
              c.created_at AS "createdAt", v.business_name AS "businessName", b.booking_type AS "bookingType"
         FROM booking_charges c JOIN bookings b ON b.id = c.booking_id JOIN vendors v ON v.id = b.vendor_id
        WHERE c.status = 'disputed' ORDER BY c.created_at`,
    );
    const inspections = await this.db.query(
      `SELECT i.booking_id AS "bookingId", i.phase, i.readings, i.notes, i.photo_ids AS "photoIds", i.customer_note AS "customerNote", i.acked_at AS "disputedAt",
              v.business_name AS "businessName"
         FROM booking_inspections i JOIN bookings b ON b.id = i.booking_id JOIN vendors v ON v.id = b.vendor_id
        WHERE i.customer_ack = 'disputed' AND b.status IN ('confirmed', 'completed') ORDER BY i.acked_at`,
    );
    return { charges: charges.rows, inspections: inspections.rows };
  }

  @AdminRoles('finance')
  @Get('refunds')
  async refundList(@Query() q: RefundsQuery) {
    return { items: await this.refunds.list(q.status) };
  }

  /** A refund Razorpay could not complete, sent again as a new refund. */
  @AdminRoles('finance')
  @StepUp()
  @Post('refunds/:id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.refunds.retry(admin.adminId, id);
  }

  /**
   * Razorpay webhooks as received, newest first (last 200). `problems`: failed ones, and payments that
   * were not confirmed because the amount did not match the order or the payment was not captured.
   */
  @AdminRoles('finance')
  @Get('payment-events')
  async paymentEventList(@Query() q: PaymentEventsQuery) {
    const { rows } = await this.db.query(
      `SELECT w.id::text, w.event_id AS "eventId", w.event, w.status, w.result, w.attempts, w.last_error AS "lastError",
              w.received_at AS "receivedAt", w.processed_at AS "processedAt",
              w.payload->'payload'->'payment'->'entity'->>'order_id' AS "orderId",
              w.payload->'payload'->'payment'->'entity'->>'id' AS "paymentId",
              (w.payload->'payload'->'payment'->'entity'->>'amount')::bigint AS "amountPaise",
              p.booking_id AS "bookingId"
         FROM webhook_events w
         LEFT JOIN payments p ON p.razorpay_order_id = w.payload->'payload'->'payment'->'entity'->>'order_id'
        WHERE $1::text IS NULL
           OR ($1 = 'problems' AND (w.status = 'failed' OR w.result IN ('amount_mismatch', 'not_captured')))
           OR w.status = $1
        ORDER BY w.id DESC LIMIT 200`,
      [q.status ?? null],
    );
    return { items: rows.map((r) => ({ ...r, amountPaise: r.amountPaise === null ? null : Number(r.amountPaise) })) };
  }

  /** Asks Razorpay now about unpaid orders older than 10 minutes, instead of waiting for the next run. */
  @AdminRoles('finance')
  @Post('payment-events/reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcileNow() {
    return { confirmed: await this.paymentEvents.reconcile() };
  }
}
