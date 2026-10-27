import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';

/** Wait before attempt n+1 (minutes); after the last one the refund is marked failed and the team alerted. */
const RETRY_MIN = [1, 5, 15, 60, 180, 360, 720];
const BATCH = 20;

interface Due {
  id: string;
  booking_id: string;
  razorpay_payment_id: string;
  amount_paise: number;
  reason: string;
  attempts: number;
}

/**
 * Refunds never call Razorpay inside a booking transaction. They are queued with `queue()` in that
 * transaction and sent by `flush()` after it commits (right away for the request, and again every
 * minute for retries). Two things keep a refund from going out twice:
 *  - rows are claimed with SKIP LOCKED, so two servers never send the same row at once;
 *  - every refund carries `notes.refund_ref = row id`, and before a retry the sender asks Razorpay
 *    whether that refund already exists (the reply to an earlier attempt may have been lost).
 */
@Injectable()
export class RefundsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Refunds');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  onModuleInit() {
    if (this.config.bookingSweepSec > 0) {
      this.timer = setInterval(() => void this.flush(), 60_000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Records a refund inside the caller's transaction; nothing is sent until it commits. */
  async queue(q: Queryable, bookingId: string, paymentId: string, amountPaise: number, reason: string) {
    await q.query(
      `INSERT INTO refunds (booking_id, razorpay_payment_id, amount_paise, reason) VALUES ($1, $2, $3, $4)`,
      [bookingId, paymentId, amountPaise, reason],
    );
  }

  /** Sends every refund that is due. Never throws: failures are retried later. Returns how many were sent. */
  async flush(): Promise<number> {
    let sent = 0;
    try {
      for (;;) {
        const due = await this.claim();
        for (const r of due) if (await this.send(r)) sent++;
        if (due.length < BATCH) break;
      }
    } catch (err) {
      this.logger.error(`refund flush failed: ${(err as Error).stack ?? err}`);
    }
    return sent;
  }

  private async claim(): Promise<Due[]> {
    // Claiming pushes next_attempt_at forward, so a server that dies mid-send leaves the row to be
    // picked up again later (and the findRefund check makes that safe).
    const { rows } = await this.db.query<Due>(
      `UPDATE refunds r SET status = 'sending', attempts = attempts + 1,
              next_attempt_at = now() + make_interval(mins => ($1::int[])[LEAST(r.attempts + 1, array_length($1::int[], 1))])
        WHERE r.id IN (SELECT id FROM refunds WHERE status IN ('pending', 'sending') AND next_attempt_at <= now()
                        ORDER BY next_attempt_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING r.id, r.booking_id, r.razorpay_payment_id, r.amount_paise, r.reason, r.attempts - 1 AS attempts`,
      [RETRY_MIN, BATCH],
    );
    return rows;
  }

  /** Razorpay says the money reached the customer. */
  async processed(razorpayRefundId: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE refunds SET status = 'processed', processed_at = now() WHERE razorpay_refund_id = $1 AND status IN ('sent', 'sending') RETURNING id`,
      [razorpayRefundId],
    );
    return !!r.rowCount;
  }

  /**
   * Razorpay could not complete a refund it had accepted. It is not retried by itself (Razorpay
   * already holds a refund with this reference); the team is alerted and can send a new one.
   */
  async failedAtProvider(razorpayRefundId: string, reason: string): Promise<boolean> {
    return this.db.tx(async (client) => {
      const r = await this.db.one<{ id: string; booking_id: string; amount_paise: number; razorpay_payment_id: string }>(
        client,
        `UPDATE refunds SET status = 'failed', last_error = $2 WHERE razorpay_refund_id = $1 AND status IN ('sent', 'sending', 'processed')
         RETURNING id, booking_id, amount_paise, razorpay_payment_id`,
        [razorpayRefundId, reason.slice(0, 500)],
      );
      if (!r) return false;
      await client.query(`UPDATE payments SET status = 'failed' WHERE razorpay_refund_id = $1 AND type = 'refund'`, [razorpayRefundId]);
      await client.query(`INSERT INTO system_alerts (kind, message, data) VALUES ('refund_failed', $1, $2)`, [
        `Razorpay could not complete a refund of ₹${(r.amount_paise / 100).toLocaleString('en-IN')}: ${reason}. Retry it from Refunds.`,
        { refundId: r.id, bookingId: r.booking_id, paymentId: r.razorpay_payment_id, amountPaise: r.amount_paise },
      ]);
      return true;
    });
  }

  /** Admin: send a failed refund again as a new refund (a new reference, so it is not taken for the failed one). */
  async retry(adminId: string, refundId: string) {
    const created = await this.db.tx(async (client) => {
      const r = await this.db.one<{ booking_id: string; razorpay_payment_id: string; amount_paise: number; reason: string }>(
        client,
        `SELECT booking_id, razorpay_payment_id, amount_paise, reason FROM refunds WHERE id = $1 AND status = 'failed' AND reason NOT LIKE '%:retried' FOR UPDATE`,
        [refundId],
      );
      if (!r) throw new AppError('NOT_FOUND', 'No failed refund to retry with this id.', HttpStatus.NOT_FOUND);
      // Marked so the same failure is never retried twice.
      await client.query(`UPDATE refunds SET reason = reason || ':retried' WHERE id = $1`, [refundId]);
      const row = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO refunds (booking_id, razorpay_payment_id, amount_paise, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
        [r.booking_id, r.razorpay_payment_id, r.amount_paise, `${r.reason}:retry`],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'refund.retry', 'booking', $2, $3, $4)`,
        [adminId, r.booking_id, { refundId }, { newRefundId: row!.id, amountPaise: r.amount_paise }],
      );
      return row!.id;
    });
    await this.flush();
    return this.db.one(this.db, `SELECT id, status, amount_paise AS "amountPaise", razorpay_refund_id AS "razorpayRefundId" FROM refunds WHERE id = $1`, [created]);
  }

  async list(status?: string) {
    return (await this.db.query(
      `SELECT r.id, r.booking_id AS "bookingId", r.amount_paise AS "amountPaise", r.reason, r.status, r.attempts, r.last_error AS "lastError",
              r.razorpay_refund_id AS "razorpayRefundId", r.created_at AS "createdAt", r.sent_at AS "sentAt", r.processed_at AS "processedAt"
         FROM refunds r WHERE ($1::text IS NULL OR r.status::text = $1) ORDER BY r.created_at DESC LIMIT 200`,
      [status ?? null],
    )).rows;
  }

  private async send(r: Due): Promise<boolean> {
    try {
      const earlier = r.attempts > 0 ? await this.gateway.findRefund(r.razorpay_payment_id, r.id) : null;
      const { refundId } =
        earlier ?? (await this.gateway.refund(r.razorpay_payment_id, r.amount_paise, { bookingId: r.booking_id, reason: r.reason, refund_ref: r.id }));
      await this.db.tx(async (client) => {
        await client.query(`UPDATE refunds SET status = 'sent', razorpay_refund_id = $2, sent_at = now(), last_error = NULL WHERE id = $1`, [r.id, refundId]);
        await client.query(
          `INSERT INTO payments (booking_id, type, amount_paise, razorpay_refund_id, status) VALUES ($1, 'refund', $2, $3, 'refunded')`,
          [r.booking_id, r.amount_paise, refundId],
        );
      });
      return true;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const final = r.attempts + 1 >= RETRY_MIN.length + 1;
      await this.db.query(`UPDATE refunds SET status = $2::refund_status, last_error = $3 WHERE id = $1`, [r.id, final ? 'failed' : 'sending', message.slice(0, 500)]);
      this.logger.warn(`refund ${r.id} attempt ${r.attempts + 1} failed: ${message}`);
      if (final) {
        await this.db.query(`INSERT INTO system_alerts (kind, message, data) VALUES ('refund_failed', $1, $2)`, [
          `A refund of ₹${(r.amount_paise / 100).toLocaleString('en-IN')} could not be sent after ${r.attempts + 1} tries. Check it in Razorpay and refund by hand.`,
          { refundId: r.id, bookingId: r.booking_id, paymentId: r.razorpay_payment_id, amountPaise: r.amount_paise },
        ]);
      }
      return false;
    }
  }
}
