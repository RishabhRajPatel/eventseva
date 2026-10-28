import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BookingsService } from '../bookings/bookings.service';
import { AppConfig, CONFIG } from '../config';
import { runAs } from '../db/actor';
import { Db } from '../db/db.service';
import { FeaturedService } from '../featured/featured.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';
import { RefundsService } from './refunds.service';

export interface RazorpayEvent {
  event: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    refund?: { entity?: { id?: string; status?: string; error_description?: string } };
  };
}

/**
 * What the log keeps of an event: ids, amounts and statuses only. Razorpay's entities also carry the
 * customer's email, phone and card or UPI details, which EventSeva does not need to store.
 */
function slim(body: RazorpayEvent) {
  const pick = <T extends object>(o: T | undefined, keys: string[]) =>
    o ? Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k))) : undefined;
  const payment = pick(body.payload?.payment?.entity, ['id', 'order_id', 'amount', 'currency', 'status', 'method', 'captured']);
  const refund = pick(body.payload?.refund?.entity, ['id', 'payment_id', 'amount', 'status', 'error_description']);
  return { event: body.event, payload: { ...(payment && { payment: { entity: payment } }), ...(refund && { refund: { entity: refund } }) } };
}

/** Unpaid orders are asked about after this long without a webhook, and again at most this often. */
const RECONCILE_AFTER_MIN = 10;
/** Orders older than this are not checked any more (the checkout has long closed). */
const RECONCILE_MAX_AGE = '3 days';
const RECONCILE_BATCH = 50;

/**
 * Money arriving from the payment provider, from three sources that may overlap: the app's own
 * verify call, the webhook, and the reconciliation job that asks the provider about orders no
 * webhook confirmed. Each confirms at most once (payments are locked and checked by status), and
 * an amount that does not match the order is never treated as paid.
 */
@Injectable()
export class PaymentEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaymentEvents');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly bookings: BookingsService,
    private readonly featured: FeaturedService,
    private readonly refunds: RefundsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.bookingSweepSec > 0) {
      this.timer = setInterval(() => {
        this.reconcile().catch((err) => this.logger.error(`reconcile failed: ${err.stack ?? err}`));
      }, this.config.bookingSweepSec * 5 * 1000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One verified webhook. Returns what it did. A delivery seen before (same provider event id) is
   * answered without running again; if running throws, the event is marked failed and the error
   * goes back to the caller so the provider retries it.
   */
  async webhook(eventId: string | undefined, rawBody: Buffer, body: RazorpayEvent): Promise<{ result: string; duplicate?: true }> {
    const id = eventId || `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    const row = await this.db.one<{ id: string; status: string; result: string | null }>(
      this.db,
      `INSERT INTO webhook_events (event_id, event, payload) VALUES ($1, $2, $3)
       ON CONFLICT (provider, event_id) DO UPDATE SET attempts = webhook_events.attempts
       RETURNING id, status, result`,
      [id, String(body.event ?? 'unknown').slice(0, 100), slim(body)],
    );
    if (row!.status === 'processed' || row!.status === 'ignored') return { result: row!.result ?? row!.status, duplicate: true };
    try {
      const result = await runAs({ kind: 'gateway' }, () => this.run(body));
      await this.db.query(
        `UPDATE webhook_events SET status = $2, result = $3, attempts = attempts + 1, processed_at = now(), last_error = NULL WHERE id = $1`,
        [row!.id, result === 'ignored' ? 'ignored' : 'processed', result],
      );
      return { result };
    } catch (err) {
      await this.db.query(`UPDATE webhook_events SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`, [
        row!.id,
        String(err instanceof Error ? err.message : err).slice(0, 500),
      ]);
      throw err;
    }
  }

  private async run(body: RazorpayEvent): Promise<string> {
    const refund = body.payload?.refund?.entity;
    if (refund?.id && body.event === 'refund.processed') {
      return (await this.refunds.processed(refund.id)) ? 'refund_processed' : 'unknown_refund';
    }
    if (refund?.id && body.event === 'refund.failed') {
      const reason = refund.error_description || refund.status || 'failed';
      return (await this.refunds.failedAtProvider(refund.id, reason)) ? 'refund_failed' : 'unknown_refund';
    }
    const payment = body.payload?.payment?.entity;
    if (body.event === 'payment.captured' && payment?.id && payment.order_id) {
      // The event must say the money was captured, for the amount of the order.
      if (payment.status && payment.status !== 'captured') return 'not_captured';
      return this.captured(payment.order_id, payment.id, payment.amount);
    }
    return 'ignored';
  }

  /**
   * A captured payment for one of our orders (a booking payment or a featured listing). With an
   * amount, it must equal the order's: otherwise nothing is confirmed and finance is alerted.
   */
  async captured(orderId: string, paymentId: string, amountPaise?: number): Promise<string> {
    if (amountPaise !== undefined) {
      const order = await this.db.one<{ amount: number }>(
        this.db,
        `SELECT amount_paise AS amount FROM payments WHERE razorpay_order_id = $1
          UNION ALL SELECT amount_paise FROM featured_purchases WHERE razorpay_order_id = $1`,
        [orderId],
      );
      if (order && order.amount !== amountPaise) {
        await this.db.query(`INSERT INTO system_alerts (kind, message, data) VALUES ('payment_amount_mismatch', $1, $2)`, [
          `Payment ${paymentId} for order ${orderId} was ${amountPaise} paise, but the order is for ${order.amount}. Nothing was confirmed; check it in Razorpay.`,
          { orderId, paymentId, amountPaise, expectedPaise: order.amount },
        ]);
        this.logger.error(`${orderId}: amount ${amountPaise} ≠ ${order.amount}`);
        return 'amount_mismatch';
      }
    }
    let result: string = await this.bookings.paymentCaptured(orderId, paymentId);
    if (result === 'unknown_order') result = await this.featured.captured(orderId, paymentId);
    this.logger.log(`${orderId}: ${result}`);
    return result;
  }

  /**
   * Asks the provider about unpaid orders that no webhook or app call confirmed (a lost webhook,
   * a phone that died on the checkout). Each order is asked at most every 10 minutes for 3 days.
   * Returns how many were found paid.
   */
  async reconcile(): Promise<number> {
    const { rows } = await this.db.query<{ order_id: string; kind: string }>(
      `WITH due AS (
         SELECT razorpay_order_id AS order_id, 'booking' AS kind, created_at FROM payments
          WHERE status = 'created' AND created_at < now() - interval '${RECONCILE_AFTER_MIN} minutes' AND created_at > now() - interval '${RECONCILE_MAX_AGE}'
            AND (checked_at IS NULL OR checked_at < now() - interval '${RECONCILE_AFTER_MIN} minutes')
         UNION ALL
         SELECT razorpay_order_id, 'featured', created_at FROM featured_purchases
          WHERE status = 'created' AND razorpay_order_id IS NOT NULL
            AND created_at < now() - interval '${RECONCILE_AFTER_MIN} minutes' AND created_at > now() - interval '${RECONCILE_MAX_AGE}'
            AND (checked_at IS NULL OR checked_at < now() - interval '${RECONCILE_AFTER_MIN} minutes'))
       SELECT order_id, kind FROM due ORDER BY created_at LIMIT ${RECONCILE_BATCH}`,
    );
    let found = 0;
    for (const r of rows) {
      const table = r.kind === 'booking' ? 'payments' : 'featured_purchases';
      await this.db.query(`UPDATE ${table} SET checked_at = now() WHERE razorpay_order_id = $1`, [r.order_id]);
      try {
        const paid = await this.gateway.capturedPayment(r.order_id);
        if (!paid) continue;
        const result = await runAs({ kind: 'gateway' }, () => this.captured(r.order_id, paid.paymentId, paid.amountPaise));
        if (result !== 'amount_mismatch') found++;
      } catch (err) {
        // The provider is down: the next run asks again.
        this.logger.warn(`reconcile ${r.order_id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return found;
  }
}
