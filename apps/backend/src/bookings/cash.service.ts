// Cash bookings: the customer pays the vendor in person. The vendor records the cash they take or
// give back (the customer is told each time), and EventSeva's commission becomes a due the vendor
// owes, taken from their next online payouts or settled with finance.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { Db, Queryable } from '../db/db.service';
import { SettingsService } from '../admin/settings.service';
import { notify } from '../notifications/notify';

export type CashKind = 'advance' | 'balance' | 'deposit' | 'deposit_return' | 'refund';
export const CASH_KINDS: CashKind[] = ['advance', 'balance', 'deposit', 'deposit_return', 'refund'];
/** Open dues older than this also stop new cash bookings. */
const DUES_MAX_AGE_DAYS = 30;

/**
 * SQL for the security deposit held on a booking (`ref` is the booking id expression): paid online,
 * or taken in cash by the vendor and not yet given back.
 */
export const depositHeldSql = (ref: string) => `(
  (SELECT COALESCE(sum(amount_paise), 0) FROM payments WHERE booking_id = ${ref} AND type = 'deposit' AND status = 'paid')
  + (SELECT COALESCE(sum(CASE kind WHEN 'deposit' THEN amount_paise ELSE -amount_paise END), 0) FROM cash_receipts
      WHERE booking_id = ${ref} AND kind IN ('deposit', 'deposit_return')))::int`;

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const KIND_TEXT: Record<CashKind, { en: string; hi: string; given: boolean }> = {
  advance: { en: 'advance', hi: 'एडवांस', given: false },
  balance: { en: 'payment', hi: 'भुगतान', given: false },
  deposit: { en: 'security deposit', hi: 'सिक्योरिटी डिपॉज़िट', given: false },
  deposit_return: { en: 'deposit returned', hi: 'डिपॉज़िट वापसी', given: true },
  refund: { en: 'refund', hi: 'रिफ़ंड', given: true },
};

export interface CashSummary {
  /** Advance and balance taken, minus refunds given back. */
  receivedPaise: number;
  /** Deposit taken minus deposit given back. */
  depositHeldPaise: number;
  receipts: { id: string; kind: CashKind; amountPaise: number; note: string | null; createdAt: Date }[];
}

@Injectable()
export class CashService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  /** A vendor with too much (or too old) unpaid commission cannot take new cash bookings. */
  async assertVendorMayTakeCash(q: Queryable, vendorId: string) {
    const d = await this.db.one<{ open: number; oldest: Date | null }>(
      q,
      `SELECT COALESCE(sum(remaining_paise), 0)::int AS open, min(created_at) AS oldest FROM commission_dues WHERE vendor_id = $1 AND status = 'open'`,
      [vendorId],
    );
    const tooOld = d!.oldest && Date.now() - new Date(d!.oldest).getTime() > DUES_MAX_AGE_DAYS * 86_400_000;
    if (d!.open > (await this.settings.get()).cashDuesLimitPaise || tooOld) {
      throw new AppError('CASH_NOT_AVAILABLE', 'This vendor cannot take cash bookings right now. Please pay online.', HttpStatus.CONFLICT);
    }
  }

  async summary(q: Queryable, bookingId: string): Promise<CashSummary> {
    const { rows } = await q.query<{ id: string; kind: CashKind; amountPaise: number; note: string | null; createdAt: Date }>(
      `SELECT id, kind, amount_paise AS "amountPaise", note, created_at AS "createdAt" FROM cash_receipts WHERE booking_id = $1 ORDER BY created_at`,
      [bookingId],
    );
    const sum = (kinds: CashKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.amountPaise, 0);
    return {
      receivedPaise: sum(['advance', 'balance']) - sum(['refund']),
      depositHeldPaise: sum(['deposit']) - sum(['deposit_return']),
      receipts: rows,
    };
  }

  /** Cash taken or given back, as the vendor records it. The customer gets a notification each time. */
  async record(vendorUserId: string, bookingId: string, kind: CashKind, amountPaise: number, note?: string) {
    await this.db.tx(async (client) => {
      const b = await this.db.one<{ id: string; customer_id: string; status: string; pay_mode: string; amount_paise: number; deposit_paise: number }>(
        client,
        `SELECT b.id, b.customer_id, b.status, b.pay_mode, b.amount_paise, b.deposit_paise
           FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND v.user_id = $2 FOR UPDATE OF b`,
        [bookingId, vendorUserId],
      );
      if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
      if (b.pay_mode !== 'cash') throw new AppError('NOT_CASH_BOOKING', 'This booking is paid online, not in cash.', HttpStatus.CONFLICT);
      const giving = KIND_TEXT[kind].given;
      const open = giving ? ['confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_vendor'] : ['confirmed', 'completed'];
      if (!open.includes(b.status) || (kind === 'deposit' && b.status !== 'confirmed')) {
        throw new AppError('BOOKING_BAD_STATUS', 'Cash cannot be recorded for this booking now.', HttpStatus.CONFLICT, { status: b.status });
      }
      const s = await this.summary(client, b.id);
      const charges = (await this.db.one<{ sum: number }>(
        client,
        `SELECT COALESCE(sum(amount_paise), 0)::int AS sum FROM booking_charges WHERE booking_id = $1 AND status IN ('accepted', 'resolved')`,
        [b.id],
      ))!.sum;
      // Never more than the booking (with agreed charges) or the deposit; never give back more than was taken.
      const max = kind === 'advance' || kind === 'balance' ? b.amount_paise + charges - s.receivedPaise
        : kind === 'deposit' ? b.deposit_paise - s.depositHeldPaise
        : kind === 'deposit_return' ? s.depositHeldPaise
        : s.receivedPaise;
      if (amountPaise > max) {
        throw new AppError('CASH_TOO_MUCH', max > 0 ? `At most ${rupees(max)} can be recorded here.` : 'Nothing is left to record here.', HttpStatus.BAD_REQUEST, { maxPaise: Math.max(0, max) });
      }
      await client.query(`INSERT INTO cash_receipts (booking_id, kind, amount_paise, note, recorded_by) VALUES ($1, $2, $3, $4, $5)`, [
        b.id, kind, amountPaise, note?.trim() || null, vendorUserId,
      ]);
      await client.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, 'cash_recorded', $2, $3)`, [b.id, vendorUserId, { kind, amountPaise }]);
      const t = KIND_TEXT[kind];
      await notify(client, b.customer_id, 'cash_recorded', {
        en: {
          title: giving ? 'Cash given back' : 'Cash payment recorded',
          body: giving
            ? `The vendor recorded giving you ${rupees(amountPaise)} in cash (${t.en}). If this is wrong, tell us from the booking.`
            : `The vendor recorded ${rupees(amountPaise)} received from you in cash (${t.en}). If this is wrong, tell us from the booking.`,
        },
        hi: {
          title: giving ? 'नकद वापस मिला' : 'नकद भुगतान दर्ज',
          body: giving
            ? `वेंडर ने आपको ${rupees(amountPaise)} नकद (${t.hi}) देना दर्ज किया। गलत हो तो बुकिंग से हमें बताएँ।`
            : `वेंडर ने आपसे ${rupees(amountPaise)} नकद (${t.hi}) मिलना दर्ज किया। गलत हो तो बुकिंग से हमें बताएँ।`,
        },
      }, { bookingId: b.id }, 'customer');
    });
  }

  /**
   * Takes open commission dues off the vendor's scheduled (not yet sent) payouts, oldest due first.
   * Runs from the booking sweep. Returns how much was taken.
   */
  async applyDuesToPayouts(): Promise<number> {
    const vendors = await this.db.query<{ vendor_id: string }>(
      `SELECT DISTINCT d.vendor_id FROM commission_dues d
        WHERE d.status = 'open' AND EXISTS (SELECT 1 FROM payouts p WHERE p.vendor_id = d.vendor_id AND p.status = 'scheduled' AND p.amount_paise > 0)`,
    );
    let total = 0;
    for (const { vendor_id } of vendors.rows) {
      total += await this.db.tx(async (client) => {
        const payouts = (await client.query<{ id: string; amount_paise: number }>(
          `SELECT id, amount_paise FROM payouts WHERE vendor_id = $1 AND status = 'scheduled' AND amount_paise > 0 ORDER BY release_after FOR UPDATE`,
          [vendor_id],
        )).rows;
        const dues = (await client.query<{ id: string; remaining_paise: number }>(
          `SELECT id, remaining_paise FROM commission_dues WHERE vendor_id = $1 AND status = 'open' ORDER BY created_at FOR UPDATE`,
          [vendor_id],
        )).rows;
        let taken = 0;
        for (const p of payouts) {
          let left = p.amount_paise;
          for (const d of dues) {
            if (!left || !d.remaining_paise) continue;
            const take = Math.min(left, d.remaining_paise);
            d.remaining_paise -= take;
            left -= take;
            await client.query(
              `UPDATE commission_dues SET remaining_paise = $2,
                      status = CASE WHEN $2 = 0 THEN 'settled' ELSE 'open' END,
                      settled_at = CASE WHEN $2 = 0 THEN now() END,
                      reference = CASE WHEN $2 = 0 THEN 'payout:' || $3 ELSE reference END
                WHERE id = $1`,
              [d.id, d.remaining_paise, p.id],
            );
          }
          const cut = p.amount_paise - left;
          if (!cut) continue;
          // A payout taken to zero has nothing left to send.
          await client.query(
            `UPDATE payouts SET amount_paise = $2, dues_deducted_paise = dues_deducted_paise + $3,
                    status = CASE WHEN $2 = 0 THEN 'paid'::payout_status ELSE status END WHERE id = $1`,
            [p.id, left, cut],
          );
          taken += cut;
        }
        return taken;
      });
    }
    return total;
  }

  /** What the vendor owes EventSeva for cash bookings (Partner app → Earnings). */
  async vendorDues(vendorUserId: string) {
    const { rows } = await this.db.query(
      `SELECT d.id, d.booking_id AS "bookingId", d.amount_paise AS "amountPaise", d.remaining_paise AS "remainingPaise", d.status,
              d.reference, d.created_at AS "createdAt", d.settled_at AS "settledAt"
         FROM commission_dues d JOIN vendors v ON v.id = d.vendor_id WHERE v.user_id = $1 ORDER BY d.created_at DESC LIMIT 100`,
      [vendorUserId],
    );
    const openPaise = rows.filter((r) => r.status === 'open').reduce((a, r) => a + Number(r.remainingPaise), 0);
    return { openPaise, limitPaise: (await this.settings.get()).cashDuesLimitPaise, items: rows };
  }
}
