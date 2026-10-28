import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { BookingStatus } from '@eventseva/core';
import { AppConfig, CONFIG } from '../config';
import { AppError, assertExpectedTotal } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway';
import { CouponsService } from '../coupons/coupons.service';
import { DEFAULT_CANCELLATION } from '../engine/rules';
import { RefundsService } from '../payments/refunds.service';
import { FulfilmentService } from '../inventory/fulfilment.service';
import { TripService } from '../engine/trip.service';
import { postBookingEvent } from '../chat/booking-events';
import { pointOf, progressAllowed, REMINDER_HOUR_IST, travelBetween } from './travel';
import type { PricingUnit } from '../vendors/vendor.queries';
import { enginePayBy } from '../engine/engine.service';
import { releaseAll, renewAll, Unavailable } from '../engine/reservations';
import { CashService } from './cash.service';
import { daysBefore, refundPercentFrom } from '../engine/rules';
import type { BookingTypeKey, CancellationPolicy, Need } from '../engine/types';
import {
  daysUntil,
  GUEST_UNITS,
  lastPlannableDay,
  MAX_BOOKING_PAISE,
  MAX_OPEN_REQUESTS,
  needsQuantity,
  NEW_VENDOR_BOOKINGS,
  payByFor,
  priceBooking,
  refundPaise,
  refundPercent,
  respondByFor,
  Slot,
  todayIst,
} from './booking.rules';

export interface BookingRequest {
  /** 'HH:MM' India time: when the vendor should be at the venue (optional). */
  arriveBy?: string;
  eventId: string;
  vendorId: string;
  serviceId?: string;
  packageId?: string;
  slot: Slot;
  quantity?: number;
  note?: string;
  /** cash: the whole booking is paid to the vendor in person (only where the vendor accepts cash). */
  payMode?: PayMode;
  /** The total the customer saw; a different server total answers PRICE_CHANGED instead of booking. */
  expectedTotalPaise?: number;
}

export type PayMode = 'online' | 'cash';

export interface AcceptOptions {
  /** quote bookings: the vendor's price for the whole job (before tax), in paise. */
  pricePaise?: number;
  /** Extras that needed approval: each one approved or declined. */
  addons?: { addonId: string; approve: boolean }[];
}

interface PaymentRow {
  id: string;
  booking_id: string;
  amount_paise: number;
  status: string;
  type: 'advance' | 'final' | 'deposit';
}

interface BookingRow {
  id: string;
  event_id: string;
  customer_id: string;
  vendor_id: string;
  vendor_user_id: string;
  status: BookingStatus;
  day: string;
  slot: Slot;
  amount_paise: number;
  advance_paise: number;
  commission_paise: number;
  discount_paise: number;
  refund_paise: number;
  payout_deduction_paise: number;
  respond_by: Date;
  pay_by: Date | null;
  booking_type: BookingTypeKey;
  starts_at: Date;
  ends_at: Date;
  occupy_from: Date;
  occupy_until: Date;
  needs: Need[] | null;
  cancellation_policy: CancellationPolicy | null;
  deposit_paise: number;
  tax_paise: number;
  fulfilment: string;
  pay_mode: PayMode;
}

/** Holds stored in the snapshot come back as JSON: dates are strings again. */
export function needsOf(raw: Need[] | null | undefined): Need[] {
  return (raw ?? []).map((n) => (n.kind === 'pool' && n.period ? { ...n, period: [new Date(n.period[0]), new Date(n.period[1])] as [Date, Date] } : n));
}
const isEngine = (b: { booking_type: BookingTypeKey }) => b.booking_type !== 'slot';
/** Days before the service, by which the cancellation tier is chosen. */
const daysLeft = (b: BookingRow) => (isEngine(b) ? daysBefore(b.starts_at) : daysUntil(b.day));
/** Started (engine) or the day is over (slot): too late to cancel. */
const started = (b: BookingRow) => (isEngine(b) ? b.starts_at.getTime() <= Date.now() : daysUntil(b.day) < 0);

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
/** "21 Nov" / "21 नव॰" for notifications; days are plain dates, so no time-zone shift. */
const niceDay = (day: string, lang: 'en' | 'hi') =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
/** Whole hours left until a deadline, at least 1, for notification text. */
const hoursLeft = (until: Date) => Math.max(1, Math.floor((until.getTime() - Date.now()) / 3600_000));
/** "Not free that day." for a reason typed as "Not free that day" or "Not free that day." */
const sentence = (text: string) => text.replace(/[\s.।!]+$/u, '');
/** "5:40 pm" India time. */
const clockIst = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
/** '17:30' → "5:30 pm". */
const timeLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const SLOT_TEXT = {
  en: { full: 'Full-day', day: 'Daytime', night: 'Evening' },
  hi: { full: 'पूरे दिन', day: 'दिन', night: 'शाम' },
} as const;
const ACTIVE: BookingStatus[] = ['requested', 'accepted', 'confirmed'];

/**
 * Booking life cycle:
 *   requested ──vendor accepts──▶ accepted ──customer pays advance──▶ confirmed ──event day over──▶ completed
 *       │ vendor rejects / 24 h no reply      │ 24 h no payment                 │ cancelled (refund by policy)
 *       ▼                                     ▼                                 ▼
 *   rejected / expired                     expired                 cancelled_by_customer / _vendor
 * The vendor's slot is held from "accepted" until the booking ends or is cancelled.
 */
@Injectable()
export class BookingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Bookings');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly coupons: CouponsService,
    private readonly refunds: RefundsService,
    private readonly fulfilment: FulfilmentService,
    private readonly trips: TripService,
    private readonly cash: CashService,
  ) {}

  onModuleInit() {
    if (this.config.bookingSweepSec > 0) {
      this.timer = setInterval(() => {
        this.sweep().catch((err) => this.logger.error(`sweep failed: ${err.stack ?? err}`));
      }, this.config.bookingSweepSec * 1000);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- customer ----------

  async request(customerId: string, body: BookingRequest): Promise<string> {
    if (!body.serviceId === !body.packageId) {
      throw new AppError('VALIDATION', 'Choose either a service or a package.');
    }
    return this.db.tx(async (client) => {
      const event = await this.db.one<{ event_date: string }>(
        client,
        'SELECT event_date FROM events WHERE id = $1 AND customer_id = $2',
        [body.eventId, customerId],
      );
      if (!event) throw new AppError('EVENT_NOT_FOUND', 'Event not found.', HttpStatus.NOT_FOUND);
      if (event.event_date < todayIst()) throw new AppError('EVENT_IN_PAST', 'This event date has already passed.');
      const respondBy = respondByFor(event.event_date);
      if (!respondBy) {
        throw new AppError('TOO_LATE_TO_BOOK', 'This event is too soon to book in the app. Please call or chat with the vendor.', HttpStatus.CONFLICT);
      }
      const waiting = await this.db.one<{ n: number }>(
        client,
        `SELECT count(*)::int AS n FROM bookings WHERE customer_id = $1 AND status = 'requested' AND respond_by > now()`,
        [customerId],
      );
      if (waiting!.n >= MAX_OPEN_REQUESTS) {
        throw new AppError('TOO_MANY_OPEN_REQUESTS', `You already have ${MAX_OPEN_REQUESTS} requests waiting for a reply. Wait for some answers first.`,
          HttpStatus.TOO_MANY_REQUESTS, { max: MAX_OPEN_REQUESTS });
      }

      // Locking the vendor row puts all bookings for one vendor in a queue, so two customers
      // can never get the same slot.
      const vendor = await this.db.one<{ user_id: string; business_name: string }>(
        client,
        `SELECT user_id, business_name FROM vendors WHERE id = $1 AND status = 'approved' FOR UPDATE`,
        [body.vendorId],
      );
      if (!vendor) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
      if (vendor.user_id === customerId) throw new AppError('OWN_VENDOR', 'You cannot book your own business.');

      const item = body.serviceId
        ? await this.db.one<{ title: string; price_paise: number; unit: PricingUnit; min_guests: number | null; max_guests: number | null; cash_allowed: boolean }>(
            client,
            `SELECT title, price_paise, unit, min_guests, max_guests, cash_allowed FROM services WHERE id = $1 AND vendor_id = $2 AND is_active AND booking_type = 'slot'`,
            [body.serviceId, body.vendorId],
          )
        : await this.db.one<{ title: string; price_paise: number; unit: 'package'; min_guests: null; max_guests: null; cash_allowed: boolean }>(
            client,
            `SELECT title, price_paise, 'package' AS unit, NULL AS min_guests, NULL AS max_guests, cash_allowed FROM packages WHERE id = $1 AND vendor_id = $2 AND is_active`,
            [body.packageId, body.vendorId],
          );
      if (!item) throw new AppError('ITEM_NOT_FOUND', 'This service or package is no longer offered.', HttpStatus.NOT_FOUND);
      const payMode = body.payMode ?? 'online';
      if (payMode === 'cash') {
        if (!item.cash_allowed) throw new AppError('CASH_NOT_ACCEPTED', 'This vendor takes only online payment for this.', HttpStatus.BAD_REQUEST);
        await this.cash.assertVendorMayTakeCash(client, body.vendorId);
      }

      let quantity = 1;
      if (needsQuantity(item.unit)) {
        if (!body.quantity) throw new AppError('QUANTITY_REQUIRED', 'Tell us how many (plates, hours, rooms …).');
        quantity = body.quantity;
        const { min_guests: min, max_guests: max } = item;
        if (GUEST_UNITS.includes(item.unit as PricingUnit) && ((min && quantity < min) || (max && quantity > max))) {
          throw new AppError('QUANTITY_OUT_OF_RANGE', max ? `This vendor takes ${min ?? 1} to ${max} guests.` : `This vendor takes at least ${min} guests.`, HttpStatus.BAD_REQUEST, {
            min: min ?? null,
            max: max ?? null,
          });
        }
      }
      const money = priceBooking(item.price_paise, quantity, this.config.advancePercent, this.config.commissionPercent);
      if (money.amountPaise > MAX_BOOKING_PAISE) throw new AppError('AMOUNT_TOO_HIGH', 'Please split this into smaller bookings.');
      assertExpectedTotal(body.expectedTotalPaise, money.amountPaise);

      const open = await this.db.one(
        client,
        `SELECT 1 FROM bookings WHERE event_id = $1 AND vendor_id = $2 AND status = ANY($3) AND booking_type = 'slot'`,
        [body.eventId, body.vendorId, ACTIVE],
      );
      if (open) throw new AppError('BOOKING_EXISTS', 'You already have a booking with this vendor for this event.', HttpStatus.CONFLICT);
      await this.assertSlotFree(client, body.vendorId, event.event_date, body.slot);

      const booking = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO bookings (event_id, customer_id, vendor_id, service_id, package_id, day, slot, quantity, details,
                               amount_paise, advance_paise, commission_paise, respond_by, starts_at, ends_at, occupy_from, occupy_until,
                               cancellation_policy, pay_mode)
         SELECT v.*, t.s, t.e, t.s, t.e, $14::jsonb, $15 FROM (VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::date, $7, $8::int, $9::jsonb,
                 $10::int, $11::int, $12::int, $13::timestamptz)) v,
           LATERAL (SELECT ($6::date + CASE $7 WHEN 'day' THEN time '10:00' WHEN 'night' THEN time '18:00' ELSE time '06:00' END) AT TIME ZONE 'Asia/Kolkata' AS s,
                           ($6::date + CASE $7 WHEN 'day' THEN time '16:00' WHEN 'night' THEN time '23:00' ELSE time '23:59' END) AT TIME ZONE 'Asia/Kolkata' AS e) t
         RETURNING id`,
        [body.eventId, customerId, body.vendorId, body.serviceId ?? null, body.packageId ?? null, event.event_date, body.slot,
          quantity, { note: body.note?.trim() || null, arriveBy: body.arriveBy ?? null }, money.amountPaise, money.advancePaise, money.commissionPaise, respondBy,
          DEFAULT_CANCELLATION, payMode],
      );
      await notify(client, vendor.user_id, 'booking_requested', {
        en: { title: 'New booking request', body: `${item.title} on ${niceDay(event.event_date, 'en')}. Reply within ${hoursLeft(respondBy)} hours.` },
        hi: { title: 'नई बुकिंग रिक्वेस्ट', body: `${item.title}, ${niceDay(event.event_date, 'hi')}। ${hoursLeft(respondBy)} घंटे में जवाब दें।` },
      }, { bookingId: booking!.id }, 'partner');
      await postBookingEvent(client, { id: booking!.id, customer_id: customerId, vendor_id: body.vendorId }, 'requested', customerId, {
        item: item.title,
        day: event.event_date,
        slot: body.slot,
      });
      return booking!.id;
    });
  }

  /**
   * Starts (or resumes) a payment: returns what the Razorpay checkout needs. `part` is the advance
   * (confirms an accepted booking), or for a confirmed engine booking the balance or the security deposit.
   */
  async startPayment(customerId: string, bookingId: string, part: 'advance' | 'balance' | 'deposit' = 'advance') {
    return this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { customerId });
      if (b.pay_mode === 'cash') throw new AppError('CASH_BOOKING', 'This booking is paid in cash to the vendor.', HttpStatus.CONFLICT);
      const type = part === 'advance' ? 'advance' : part === 'balance' ? 'final' : 'deposit';
      let payNow: number;
      if (part === 'advance') {
        if (b.status !== 'accepted') {
          throw new AppError('BOOKING_BAD_STATUS', 'This booking is not waiting for payment.', HttpStatus.CONFLICT, { status: b.status });
        }
        if (b.pay_by && b.pay_by < new Date()) throw new AppError('PAYMENT_TIME_OVER', 'The time to pay has run out.', HttpStatus.CONFLICT);
        // What is paid now: the advance minus any coupon discount (EventSeva pays the discount).
        payNow = b.advance_paise - b.discount_paise;
      } else {
        // A completed booking can still owe its balance (extra charges agreed after the return).
        const open = b.status === 'confirmed' || (b.status === 'completed' && part === 'balance');
        if (!open || !isEngine(b)) {
          throw new AppError('BOOKING_BAD_STATUS', 'This booking is not waiting for this payment.', HttpStatus.CONFLICT, { status: b.status });
        }
        const done = await this.db.one<{ paid: number }>(
          client,
          `SELECT COALESCE(sum(amount_paise), 0)::int AS paid FROM payments WHERE booking_id = $1 AND type = $2 AND status = 'paid'`,
          [b.id, type],
        );
        // The balance also covers agreed extra charges (km, hours, damage …) that the deposit does not.
        const extra = part === 'balance' ? await this.chargesBeyondDeposit(client, b.id) : 0;
        payNow = (part === 'balance' ? b.amount_paise - b.advance_paise + extra : b.deposit_paise) - done!.paid;
        if (payNow <= 0) throw new AppError('NOTHING_TO_PAY', 'This is already paid.', HttpStatus.CONFLICT);
      }

      // Reuse an open order: two taps on "Pay" must never create two charges. An order for a
      // different amount (the coupon changed) is dropped and a new one made.
      let payment = await this.db.one<{ id: string; razorpay_order_id: string; amount_paise: number }>(
        client,
        `SELECT id, razorpay_order_id, amount_paise FROM payments WHERE booking_id = $1 AND type = $2 AND status = 'created' AND order_group_id IS NULL`,
        [bookingId, type],
      );
      if (payment && payment.amount_paise !== payNow) {
        await client.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [payment.id]);
        payment = undefined;
      }
      if (!payment) {
        const { orderId } = await this.gateway.createOrder(payNow, bookingId, { bookingId });
        await client.query(
          `INSERT INTO payments (booking_id, type, amount_paise, razorpay_order_id) VALUES ($1, $4::payment_type, $2, $3)`,
          [bookingId, payNow, orderId, type],
        );
        payment = { id: '', razorpay_order_id: orderId, amount_paise: payNow };
      }
      return { orderId: payment.razorpay_order_id, amountPaise: payNow, currency: 'INR', keyId: this.gateway.keyId };
    });
  }

  /**
   * One Razorpay order for every booking of a checkout that a vendor accepted and that waits for its
   * advance. Each booking gets its own share (a payment row); a second call with the same bookings and
   * amounts returns the same order, and a changed set replaces the open order (if the old one is paid
   * anyway, its shares are refunded).
   */
  async startCheckoutPayment(customerId: string, checkoutId: string) {
    return this.db.tx(async (client) => {
      const c = await this.db.one(client, 'SELECT id FROM checkouts WHERE id = $1 AND customer_id = $2 FOR UPDATE', [checkoutId, customerId]);
      if (!c) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      const due = (await client.query<{ id: string; amount: number }>(
        `SELECT id, (advance_paise - discount_paise)::int AS amount FROM bookings
          WHERE group_id = $1 AND status = 'accepted' AND pay_mode = 'online' AND (pay_by IS NULL OR pay_by > now())
          ORDER BY id FOR UPDATE`,
        [checkoutId],
      )).rows.filter((r) => r.amount > 0);
      if (!due.length) throw new AppError('NOTHING_TO_PAY', 'Nothing in this checkout is waiting for payment.', HttpStatus.CONFLICT);
      const total = due.reduce((sum, r) => sum + r.amount, 0);
      const open = await this.db.one<{ id: string; razorpay_order_id: string; shares: { booking_id: string; amount_paise: number }[] }>(
        client,
        `SELECT o.id, o.razorpay_order_id,
                (SELECT json_agg(json_build_object('booking_id', p.booking_id, 'amount_paise', p.amount_paise) ORDER BY p.booking_id)
                   FROM payments p WHERE p.order_group_id = o.id) AS shares
           FROM payment_orders o WHERE o.checkout_id = $1 AND o.status = 'created' FOR UPDATE`,
        [checkoutId],
      );
      const same = open && JSON.stringify(open.shares) === JSON.stringify(due.map((d) => ({ booking_id: d.id, amount_paise: d.amount })));
      let orderId: string;
      if (same) {
        orderId = open!.razorpay_order_id;
      } else {
        if (open) {
          await client.query(`UPDATE payment_orders SET status = 'replaced' WHERE id = $1`, [open.id]);
          await client.query(`UPDATE payments SET status = 'failed' WHERE order_group_id = $1 AND status = 'created'`, [open.id]);
        }
        ({ orderId } = await this.gateway.createOrder(total, checkoutId, { checkoutId }));
        const g = await this.db.one<{ id: string }>(
          client,
          `INSERT INTO payment_orders (customer_id, checkout_id, razorpay_order_id, amount_paise) VALUES ($1, $2, $3, $4) RETURNING id`,
          [customerId, checkoutId, orderId, total],
        );
        for (const d of due) {
          await client.query(`INSERT INTO payments (booking_id, type, amount_paise, order_group_id) VALUES ($1, 'advance', $2, $3)`, [d.id, d.amount, g!.id]);
        }
      }
      return {
        orderId,
        amountPaise: total,
        currency: 'INR',
        keyId: this.gateway.keyId,
        bookings: due.map((d) => ({ bookingId: d.id, amountPaise: d.amount })),
      };
    });
  }

  async verifyCheckoutPayment(customerId: string, checkoutId: string, orderId: string, paymentId: string, signature: string) {
    if (!this.gateway.verifyPayment(orderId, paymentId, signature)) {
      throw new AppError('PAYMENT_INVALID', 'We could not verify this payment.');
    }
    const owner = await this.db.one(this.db, 'SELECT 1 FROM payment_orders WHERE razorpay_order_id = $1 AND checkout_id = $2 AND customer_id = $3', [orderId, checkoutId, customerId]);
    if (!owner) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found.', HttpStatus.NOT_FOUND);
    return this.paymentCaptured(orderId, paymentId);
  }

  /** Development only (PAYMENT_PROVIDER=fake): pays the checkout's open order without a checkout screen. */
  async devPayCheckout(customerId: string, checkoutId: string) {
    if (this.config.paymentProvider !== 'fake') throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    const { orderId } = await this.startCheckoutPayment(customerId, checkoutId);
    return this.paymentCaptured(orderId, `pay_dev_${Date.now()}`);
  }

  /** Called by the app after checkout. The webhook confirms the same payment too; whichever comes first wins. */
  async verifyPayment(customerId: string, bookingId: string, orderId: string, paymentId: string, signature: string) {
    if (!this.gateway.verifyPayment(orderId, paymentId, signature)) {
      throw new AppError('PAYMENT_INVALID', 'We could not verify this payment.');
    }
    const owner = await this.db.one(
      this.db,
      'SELECT 1 FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.razorpay_order_id = $1 AND b.id = $2 AND b.customer_id = $3',
      [orderId, bookingId, customerId],
    );
    if (!owner) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found.', HttpStatus.NOT_FOUND);
    await this.paymentCaptured(orderId, paymentId);
  }

  /**
   * Development only (PAYMENT_PROVIDER=fake): pays the open order without a checkout, so the
   * apps can be tested end to end before Razorpay keys exist. Production refuses fake mode.
   */
  async devPay(customerId: string, bookingId: string, part: 'advance' | 'balance' | 'deposit' = 'advance') {
    if (this.config.paymentProvider !== 'fake') throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    const { orderId } = await this.startPayment(customerId, bookingId, part);
    await this.paymentCaptured(orderId, `pay_dev_${Date.now()}`);
  }

  /**
   * Marks a payment as paid and confirms the booking. Safe to call twice. If the booking was
   * cancelled or expired before the money arrived, the whole amount goes straight back.
   */
  async paymentCaptured(orderId: string, paymentId: string): Promise<'confirmed' | 'refunded' | 'already_done' | 'unknown_order'> {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const p = await this.db.one<PaymentRow>(
        client,
        `SELECT id, booking_id, amount_paise, status, type FROM payments WHERE razorpay_order_id = $1 FOR UPDATE`,
        [orderId],
      );
      if (p) {
        if (p.status === 'paid' || p.status === 'refunded') return 'already_done';
        return this.applyPayment(client, p, paymentId);
      }
      // One order for several bookings of a checkout: each booking's share is applied on its own,
      // so a booking that can no longer be confirmed gets its share back and the others go ahead.
      const g = await this.db.one<{ id: string; status: string }>(client, 'SELECT id, status FROM payment_orders WHERE razorpay_order_id = $1 FOR UPDATE', [orderId]);
      if (!g) return 'unknown_order';
      if (g.status === 'paid') return 'already_done';
      await client.query(`UPDATE payment_orders SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1`, [g.id, paymentId]);
      const shares = (await client.query<PaymentRow>(
        `SELECT id, booking_id, amount_paise, status, type FROM payments WHERE order_group_id = $1 ORDER BY booking_id FOR UPDATE`,
        [g.id],
      )).rows;
      const results: string[] = [];
      for (const share of shares) {
        if (share.status === 'paid' || share.status === 'refunded') continue;
        results.push(await this.applyPayment(client, share, paymentId));
      }
      return results.includes('confirmed') ? 'confirmed' : 'refunded';
    }));
  }

  /**
   * Applies money that arrived for one payment row (a booking's advance, balance or deposit, or its
   * share of a checkout order) inside the caller's transaction: confirms or records it, or refunds it
   * when the booking can no longer take it.
   */
  private async applyPayment(client: Queryable, p: PaymentRow, paymentId: string): Promise<'confirmed' | 'refunded'> {
    const b = await this.lockBooking(client, p.booking_id, {});
    await client.query(`UPDATE payments SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1`, [p.id, paymentId]);

    // A replaced order (coupon changed after checkout opened) that still got paid is refunded.
    const replaced = p.status === 'failed';
    // Balance or security deposit for a confirmed booking; a late balance for a completed one.
    const lateBalance = p.type === 'final' && b.status === 'completed';
    if (p.type !== 'advance' && (b.status === 'confirmed' || lateBalance) && !replaced) {
      await client.query(`INSERT INTO booking_events (booking_id, event, data) VALUES ($1, $2, $3)`, [
        b.id, p.type === 'deposit' ? 'deposit_paid' : 'balance_paid', { amountPaise: p.amount_paise },
      ]);
      // The payout was made at completion: the late balance is added to it, or flagged if already sent.
      if (lateBalance) {
        const payout = await client.query(
          `UPDATE payouts SET amount_paise = amount_paise + $2 WHERE booking_id = $1 AND status IN ('scheduled', 'held', 'failed') RETURNING id`,
          [b.id, p.amount_paise],
        );
        if (!payout.rowCount) {
          await client.query(`INSERT INTO system_alerts (kind, message, data) VALUES ('payout_extra_due', $1, $2)`, [
            `The customer paid ${rupees(p.amount_paise)} more after the vendor's payout was sent. Transfer it to the vendor separately.`,
            { bookingId: b.id, vendorId: b.vendor_id, amountPaise: p.amount_paise },
          ]);
        }
      }
      const what = p.type === 'deposit' ? { en: 'security deposit', hi: 'सिक्योरिटी डिपॉज़िट' } : { en: 'balance', hi: 'बाकी रकम' };
      await notify(client, b.vendor_user_id, 'payment_received', {
        en: { title: 'Payment received', body: `The customer paid the ${what.en} of ${rupees(p.amount_paise)} for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'पेमेंट मिला', body: `ग्राहक ने ${niceDay(b.day, 'hi')} की ${what.hi} ${rupees(p.amount_paise)} दे दी।` },
      }, { bookingId: b.id }, 'partner');
      return 'confirmed';
    }
    if (p.type === 'advance' && b.status === 'accepted' && !replaced && isEngine(b)) {
      // The holds become bookings. If one ran out and someone else took it meanwhile, nothing is confirmed.
      try {
        await renewAll(client, needsOf(b.needs), { ...this.holding(b), status: 'active', expiresAt: null });
      } catch (err) {
        if (!(err instanceof Unavailable)) throw err;
        await this.refund(client, b.id, paymentId, p.amount_paise, 'not_available', false);
        await client.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [p.id]);
        await this.close(client, b.id, 'expired', 'No longer available when the payment arrived');
        await notify(client, b.customer_id, 'payment_refunded', {
          en: { title: 'Payment refunded', body: `The time to pay had run out and this is no longer available, so ${rupees(p.amount_paise)} is being refunded in full.` },
          hi: { title: 'पैसा वापस', body: `भुगतान का समय निकल चुका था और यह अब उपलब्ध नहीं है, इसलिए ${rupees(p.amount_paise)} पूरा वापस किया जा रहा है।` },
        }, { bookingId: b.id }, 'customer');
        await postBookingEvent(client, b, 'expired', null, { why: 'not_available' });
        return 'refunded';
      }
    }
    if (p.type === 'advance' && b.status === 'accepted' && !replaced) {
      await client.query(`UPDATE bookings SET status = 'confirmed', updated_at = now() WHERE id = $1`, [b.id]);
      await this.coupons.markUsed(client, b.id);
      await notify(client, b.customer_id, 'booking_confirmed', {
        en: { title: 'Booking confirmed', body: `Advance of ${rupees(p.amount_paise)} received. Your booking for ${niceDay(b.day, 'en')} is confirmed.` },
        hi: { title: 'बुकिंग पक्की हो गई', body: `${rupees(p.amount_paise)} एडवांस मिल गया। ${niceDay(b.day, 'hi')} की बुकिंग पक्की है।` },
      }, { bookingId: b.id }, 'customer');
      await notify(client, b.vendor_user_id, 'booking_confirmed', {
        en: { title: 'Booking confirmed', body: `The customer paid the advance for ${niceDay(b.day, 'en')}. Their phone number is now visible.` },
        hi: { title: 'बुकिंग पक्की हो गई', body: `ग्राहक ने ${niceDay(b.day, 'hi')} का एडवांस दे दिया। अब उनका फ़ोन नंबर दिख रहा है।` },
      }, { bookingId: b.id }, 'partner');
      await postBookingEvent(client, b, 'confirmed', b.customer_id);
      return 'confirmed';
    }

    await this.refund(client, b.id, paymentId, p.amount_paise, replaced ? 'replaced_order' : 'late_payment', !replaced || b.status !== 'accepted');
    // Not the booking's payment: keeps "the paid advance" unique for later refunds.
    await client.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [p.id]);
    await notify(client, b.customer_id, 'payment_refunded', {
      en: { title: 'Payment refunded', body: `This payment could not be used for the booking, so ${rupees(p.amount_paise)} is being refunded in full.` },
      hi: { title: 'पैसा वापस', body: `यह पेमेंट बुकिंग में इस्तेमाल नहीं हो सका, इसलिए ${rupees(p.amount_paise)} पूरा वापस किया जा रहा है।` },
    }, { bookingId: b.id }, 'customer');
    return 'refunded';
  }

  /**
   * The money of one booking in one place, for its customer, its vendor or an admin: what is due, what
   * was paid online (and how), the deposit, refunds by state, cash recorded, and what is still open.
   */
  async moneySummary(bookingId: string, who: { customerId?: string; vendorUserId?: string }) {
    const b = await this.db.one<{ status: BookingStatus; pay_mode: PayMode; amount_paise: number; advance_paise: number; discount_paise: number; deposit_paise: number; charges_paise: number }>(
      this.db,
      `SELECT b.status, b.pay_mode, b.amount_paise, b.advance_paise, b.discount_paise, b.deposit_paise, b.charges_paise
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR b.customer_id = $2) AND ($3::uuid IS NULL OR v.user_id = $3)`,
      [bookingId, who.customerId ?? null, who.vendorUserId ?? null],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const paid = (await this.db.query<{ type: string; sum: number; shared: boolean }>(
      `SELECT type, COALESCE(sum(amount_paise), 0)::int AS sum, bool_or(order_group_id IS NOT NULL) AS shared
         FROM payments WHERE booking_id = $1 AND status IN ('paid', 'refunded') GROUP BY type`,
      [bookingId],
    )).rows;
    const refunds = (await this.db.query<{ status: string; sum: number }>(
      `SELECT status::text, COALESCE(sum(amount_paise), 0)::int AS sum FROM refunds WHERE booking_id = $1 GROUP BY status`,
      [bookingId],
    )).rows;
    const charges = (await this.db.one<{ agreed: number }>(
      this.db,
      `SELECT COALESCE(sum(amount_paise), 0)::int AS agreed FROM booking_charges WHERE booking_id = $1 AND status IN ('accepted', 'resolved')`,
      [bookingId],
    ))!.agreed;
    const cash = b.pay_mode === 'cash' ? await this.cash.summary(this.db, bookingId) : null;
    const of = (t: string) => paid.find((p) => p.type === t)?.sum ?? 0;
    const refundOf = (...st: string[]) => refunds.filter((r) => st.includes(r.status)).reduce((x, r) => x + r.sum, 0);
    const pricePaid = cash ? cash.receivedPaise : of('advance') + of('final') + b.discount_paise;
    const refunded = refundOf('sent', 'processed');
    const refundPending = refundOf('pending', 'sending');
    const refundFailed = refundOf('failed');
    const open = ['accepted', 'confirmed', 'completed'].includes(b.status);
    return {
      currency: 'INR',
      payMode: b.pay_mode,
      /** The agreed price, plus extra charges the customer accepted (or an admin upheld). */
      pricePaise: b.amount_paise,
      chargesPaise: charges,
      advancePaise: b.advance_paise,
      /** EventSeva's coupon share: counted as paid towards the price. */
      couponPaise: b.discount_paise,
      paidOnline: { advancePaise: of('advance'), balancePaise: of('final'), depositPaise: of('deposit'), sharedOrder: paid.some((p) => p.shared) },
      cash: cash && { receivedPaise: cash.receivedPaise, depositHeldPaise: cash.depositHeldPaise },
      deposit: { requiredPaise: b.deposit_paise, heldPaise: cash ? cash.depositHeldPaise : of('deposit'), keptPaise: b.charges_paise },
      refunds: { refundedPaise: refunded, pendingPaise: refundPending, failedPaise: refundFailed },
      /** Still to pay towards the price and agreed charges (0 once settled or when the booking is closed). */
      outstandingPaise: open ? Math.max(0, b.amount_paise + charges - pricePaid) : 0,
      paymentState: !open ? (b.status === 'requested' ? 'not_due' : 'closed')
        : b.status === 'accepted' ? 'awaiting_payment'
        : b.amount_paise + charges - pricePaid <= 0 ? 'paid' : pricePaid > 0 ? 'partly_paid' : 'unpaid',
      refundState: refundFailed ? 'failed' : refundPending ? 'pending' : refunded ? 'refunded' : 'none',
    };
  }

  /**
   * What cancelling now would mean, worked out by the same rules as the cancellation itself and
   * shown before the customer confirms. Nothing changes.
   */
  async cancelPreview(customerId: string, bookingId: string) {
    const b = await this.lockBooking(this.db, bookingId, { customerId });
    const blocked = !ACTIVE.includes(b.status) || started(b) ? 'BOOKING_BAD_STATUS'
      : isEngine(b) && b.fulfilment !== 'scheduled' ? 'BOOKING_IN_PROGRESS' : null;
    const days = daysLeft(b);
    const percent = isEngine(b) ? refundPercentFrom(b.cancellation_policy, 'customer', days) : refundPercent('customer', days);
    let paid = 0;
    let back = 0;
    let depositBack = 0;
    if (b.status === 'confirmed' && b.pay_mode === 'online') {
      const { rows } = await this.db.query<{ type: string; amount_paise: number }>(
        `SELECT type, amount_paise FROM payments WHERE booking_id = $1 AND type IN ('advance', 'final', 'deposit') AND status = 'paid'`,
        [b.id],
      );
      for (const p of rows) {
        if (p.type === 'deposit') depositBack += p.amount_paise;
        else {
          paid += p.amount_paise;
          back += p.type === 'advance' ? Math.min(refundPaise(p.amount_paise, percent), p.amount_paise - b.refund_paise) : refundPaise(p.amount_paise, percent);
        }
      }
    }
    if (b.status === 'confirmed' && b.pay_mode === 'cash') {
      const cash = await this.cash.summary(this.db, b.id);
      paid = cash.receivedPaise;
      back = refundPaise(cash.receivedPaise, percent);
      depositBack = cash.depositHeldPaise;
    }
    return {
      allowed: !blocked,
      reason: blocked,
      payMode: b.pay_mode,
      daysBefore: days,
      percent,
      /** Price paid so far (advance and balance; cash bookings: cash the vendor recorded). */
      paidPaise: paid,
      refundPaise: back,
      keptPaise: paid - back,
      /** A security deposit always comes back in full. */
      depositBackPaise: depositBack,
      /** online: refunded to the payment method; cash: given back by the vendor. */
      refundBy: b.pay_mode === 'cash' ? 'vendor_cash' : 'original_payment',
    };
  }

  async cancelByCustomer(customerId: string, bookingId: string, reason: string) {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { customerId });
      if (!ACTIVE.includes(b.status)) {
        throw new AppError('BOOKING_BAD_STATUS', 'This booking cannot be cancelled.', HttpStatus.CONFLICT, { status: b.status });
      }
      if (started(b)) throw new AppError('BOOKING_BAD_STATUS', 'The event date has passed.', HttpStatus.CONFLICT, { status: b.status });
      if (isEngine(b) && b.fulfilment !== 'scheduled') {
        throw new AppError('BOOKING_IN_PROGRESS', 'This booking is already being delivered. Please talk to the vendor.', HttpStatus.CONFLICT);
      }
      const percent = isEngine(b) ? refundPercentFrom(b.cancellation_policy, 'customer', daysLeft(b)) : refundPercent('customer', daysLeft(b));
      const online = b.status === 'confirmed' && b.pay_mode === 'online';
      const refunded = online ? await this.refundAdvance(client, b, percent) : 0;
      await this.close(client, b.id, 'cancelled_by_customer', reason);
      const compensation = online ? await this.cancellationPayout(client, b, percent) : 0;
      if (b.pay_mode === 'cash') await this.cashCancelled(client, b, percent);
      await notify(client, b.vendor_user_id, 'booking_cancelled', {
        en: {
          title: 'Booking cancelled',
          body: `The customer cancelled the booking for ${niceDay(b.day, 'en')}. Your calendar is free again.` +
            (compensation ? ` You still get ${rupees(compensation)} for the late cancellation.` : ''),
        },
        hi: {
          title: 'बुकिंग रद्द',
          body: `ग्राहक ने ${niceDay(b.day, 'hi')} की बुकिंग रद्द कर दी। आपकी तारीख़ फिर खाली है।` +
            (compensation ? ` देर से रद्द होने के कारण आपको फिर भी ${rupees(compensation)} मिलेंगे।` : ''),
        },
      }, { bookingId: b.id }, 'partner');
      await postBookingEvent(client, b, 'cancelled_by_customer', b.customer_id, { reason, refundPaise: refunded });
      return { refundPaise: refunded };
    }));
  }

  /**
   * A cancelled cash booking: no money passed through EventSeva, so the vendor gives back the share of
   * the cash they took that the cancellation tier refunds. Both sides are told the amount.
   */
  private async cashCancelled(q: Queryable, b: BookingRow, refundPercentOfCash: number) {
    const { receivedPaise } = await this.cash.summary(q, b.id);
    const back = refundPaise(receivedPaise, refundPercentOfCash);
    if (back <= 0) return;
    const msg = {
      en: { title: 'Cash to give back', body: `${rupees(back)} of the cash paid for ${niceDay(b.day, 'en')} goes back to the customer. Record it in the booking once given.` },
      hi: { title: 'नकद लौटाना है', body: `${niceDay(b.day, 'hi')} के लिए दिए नकद में से ${rupees(back)} ग्राहक को लौटाने हैं। देने के बाद बुकिंग में दर्ज करें।` },
    };
    await notify(q, b.vendor_user_id, 'cash_refund_due', msg, { bookingId: b.id }, 'partner');
    await notify(q, b.customer_id, 'cash_refund_due', {
      en: { title: 'Cash refund', body: `The vendor gives you back ${rupees(back)} in cash for ${niceDay(b.day, 'en')}. Tell us from the booking if it does not reach you.` },
      hi: { title: 'नकद वापसी', body: `वेंडर ${niceDay(b.day, 'hi')} के लिए आपको ${rupees(back)} नकद लौटाएँगे। न मिले तो बुकिंग से हमें बताएँ।` },
    }, { bookingId: b.id }, 'customer');
    await q.query(`INSERT INTO booking_events (booking_id, event, data) VALUES ($1, 'cash_refund_due', $2)`, [b.id, { amountPaise: back }]);
  }

  /**
   * A late customer cancellation keeps part of the advance. The vendor lost the date, so they get
   * that kept part minus EventSeva's commission (EventSeva covers any coupon), paid on the usual
   * schedule after the original event day.
   */
  private async cancellationPayout(q: Queryable, b: BookingRow, refundPercentOfAdvance: number): Promise<number> {
    const balance = await this.db.one<{ paid: number }>(
      q,
      `SELECT COALESCE(sum(amount_paise), 0)::int AS paid FROM payments WHERE booking_id = $1 AND type = 'final' AND status IN ('paid', 'refunded')`,
      [b.id],
    );
    const kept = b.advance_paise - refundPaise(b.advance_paise, refundPercentOfAdvance) + balance!.paid - refundPaise(balance!.paid, refundPercentOfAdvance);
    const amount = kept - b.commission_paise - b.payout_deduction_paise;
    if (amount <= 0) return 0;
    await q.query(
      `INSERT INTO payouts (booking_id, vendor_id, amount_paise, release_after)
       SELECT $1, $2, $3,
              (($4::date + CASE WHEN (SELECT count(*) FROM bookings x WHERE x.vendor_id = $2 AND x.status = 'completed') < $5 THEN 3 ELSE 1 END)
                + time '10:00') AT TIME ZONE 'Asia/Kolkata'
       ON CONFLICT (booking_id) DO NOTHING`,
      [b.id, b.vendor_id, amount, b.day, NEW_VENDOR_BOOKINGS],
    );
    return amount;
  }

  // ---------- vendor ----------

  /**
   * Accepting holds the date (slot bookings) or renews the engine's holds until the advance is due.
   * Engine bookings may need the vendor's price (custom quotation) and a yes/no on each extra that
   * needed approval; the booking's amounts are recalculated from the snapshot before payment.
   */
  async accept(vendorUserId: string, bookingId: string, opts: AcceptOptions = {}) {
    return this.db.tx(async (client) => {
      const vendor = await this.db.one<{ id: string; status: string }>(
        client,
        'SELECT id, status FROM vendors WHERE user_id = $1 FOR UPDATE',
        [vendorUserId],
      );
      const b = await this.lockBooking(client, bookingId, { vendorUserId });
      if (vendor!.status !== 'approved') {
        throw new AppError('VENDOR_NOT_ACTIVE', 'Your profile is not live, so you cannot accept bookings.', HttpStatus.CONFLICT);
      }
      this.assertRequested(b);
      let payBy: Date;
      let advance = b.advance_paise;
      if (!isEngine(b)) {
        await this.assertSlotFree(client, b.vendor_id, b.day, b.slot);
        await client.query(
          `INSERT INTO availability (vendor_id, day, slot, status, booking_id) VALUES ($1, $2, $3, 'booked', $4)`,
          [b.vendor_id, b.day, b.slot, b.id],
        );
        payBy = payByFor(b.day);
      } else {
        advance = await this.settleOnAccept(client, b, opts);
        payBy = enginePayBy(b.starts_at);
        // Cash: nothing to wait for, so the holds become the booking now.
        await renewAll(client, needsOf(b.needs), b.pay_mode === 'cash' ? { ...this.holding(b), status: 'active', expiresAt: null } : { ...this.holding(b), status: 'hold', expiresAt: payBy });
      }
      if (b.pay_mode === 'cash') {
        await client.query(`UPDATE bookings SET status = 'confirmed', pay_by = NULL, updated_at = now() WHERE id = $1`, [b.id]);
        const total = (await this.db.one<{ amount: number }>(client, 'SELECT amount_paise AS amount FROM bookings WHERE id = $1', [b.id]))!.amount;
        await notify(client, b.customer_id, 'booking_confirmed', {
          en: { title: 'Booking confirmed', body: `The vendor accepted ${niceDay(b.day, 'en')}. Pay ${rupees(total)} to the vendor in cash, as you agree with them.` },
          hi: { title: 'बुकिंग पक्की हो गई', body: `वेंडर ने ${niceDay(b.day, 'hi')} मंज़ूर किया। ${rupees(total)} वेंडर को नकद दें, जैसे आप दोनों तय करें।` },
        }, { bookingId: b.id }, 'customer');
        await postBookingEvent(client, b, 'confirmed', vendorUserId, { payMode: 'cash' });
        return;
      }
      await client.query(`UPDATE bookings SET status = 'accepted', pay_by = $2, updated_at = now() WHERE id = $1`, [b.id, payBy]);
      await notify(client, b.customer_id, 'booking_accepted', {
        en: { title: 'Vendor accepted', body: `Pay the advance of ${rupees(advance - b.discount_paise)} within ${hoursLeft(payBy)} hours to confirm ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर ने मंज़ूर किया', body: `${niceDay(b.day, 'hi')} पक्का करने के लिए ${hoursLeft(payBy)} घंटे में ${rupees(advance - b.discount_paise)} एडवांस दें।` },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'accepted', vendorUserId, { payBy });
    });
  }

  /** Agreed extra charges the paid deposit cannot cover. */
  private async chargesBeyondDeposit(q: Queryable, bookingId: string): Promise<number> {
    const r = await this.db.one<{ agreed: number; deposit: number }>(
      q,
      `SELECT COALESCE((SELECT sum(amount_paise) FROM booking_charges WHERE booking_id = $1 AND status IN ('accepted', 'resolved')), 0)::int AS agreed,
              COALESCE((SELECT sum(amount_paise) FROM payments WHERE booking_id = $1 AND type = 'deposit' AND status IN ('paid', 'refunded')), 0)::int AS deposit`,
      [bookingId],
    );
    return Math.max(0, r!.agreed - r!.deposit);
  }

  private holding(b: BookingRow) {
    return { bookingId: b.id, vendorId: b.vendor_id, from: b.occupy_from, until: b.occupy_until };
  }

  /** Vendor's answer to extras needing approval and to a custom quotation; returns the new advance. */
  private async settleOnAccept(q: Queryable, b: BookingRow, opts: AcceptOptions): Promise<number> {
    const pending = (await q.query<{ addon_id: string; price_paise: number }>(
      `SELECT addon_id, price_paise FROM booking_addons WHERE booking_id = $1 AND status = 'pending_approval'`,
      [b.id],
    )).rows;
    const decisions = new Map((opts.addons ?? []).map((a) => [a.addonId, a.approve]));
    const undecided = pending.filter((a) => !decisions.has(a.addon_id)).map((a) => a.addon_id);
    if (undecided.length) {
      throw new AppError('ADDON_DECISION_REQUIRED', 'Approve or decline each extra the customer asked for.', HttpStatus.BAD_REQUEST, { addonIds: undecided });
    }
    const isQuote = b.booking_type === 'quote';
    if (isQuote && !opts.pricePaise) throw new AppError('QUOTE_PRICE_REQUIRED', 'Enter your price for this request.', HttpStatus.BAD_REQUEST);
    if (!isQuote && opts.pricePaise !== undefined) throw new AppError('VALIDATION', 'The price of this booking is already set.', HttpStatus.BAD_REQUEST);
    if (!pending.length && !isQuote) return b.advance_paise;

    let declined = 0;
    for (const a of pending) {
      const ok = decisions.get(a.addon_id) === true;
      if (!ok) declined += a.price_paise;
      await q.query(`UPDATE booking_addons SET status = $3, decided_at = now() WHERE booking_id = $1 AND addon_id = $2`, [b.id, a.addon_id, ok ? 'approved' : 'declined']);
    }
    const snap = (await this.db.one<{ subtotal: number; tax: number | null; advance: { percent?: number; fixedPaise?: number } | null }>(
      q,
      `SELECT (snapshot->'quote'->>'subtotalPaise')::int AS subtotal, (snapshot->'service'->'pricing'->>'taxPercent')::int AS tax,
              snapshot->'rules'->'advance' AS advance FROM bookings WHERE id = $1`,
      [b.id],
    ))!;
    const subtotal = snap.subtotal - declined + (isQuote ? opts.pricePaise! : 0);
    const tax = snap.tax ? Math.round((subtotal * snap.tax) / 100) : 0;
    const total = subtotal + tax;
    if (total > MAX_BOOKING_PAISE) throw new AppError('AMOUNT_TOO_HIGH', 'Please split this into smaller bookings.');
    const advance = total === 0 ? 0 : snap.advance?.fixedPaise ? Math.min(snap.advance.fixedPaise, total) : Math.round((total * (snap.advance?.percent ?? this.config.advancePercent)) / 100);
    const commission = Math.round((subtotal * this.config.commissionPercent) / 100);
    await q.query(
      `UPDATE bookings SET amount_paise = $2, advance_paise = $3, commission_paise = $4, tax_paise = $5,
              snapshot = jsonb_set(snapshot, '{accepted}', $6::jsonb) WHERE id = $1`,
      [b.id, total, advance, commission, tax, { quotedPaise: isQuote ? opts.pricePaise : null, declinedPaise: declined, totalPaise: total }],
    );
    return advance;
  }

  async reject(vendorUserId: string, bookingId: string, reason: string) {
    await this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { vendorUserId });
      this.assertRequested(b);
      await this.close(client, b.id, 'rejected', reason);
      await notify(client, b.customer_id, 'booking_rejected', {
        en: { title: 'Vendor is not available', body: `${sentence(reason)}. You can book another vendor for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर उपलब्ध नहीं', body: `${sentence(reason)}। आप ${niceDay(b.day, 'hi')} के लिए दूसरा वेंडर चुन सकते हैं।` },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'rejected', vendorUserId, { reason });
    });
  }

  /** After accepting. A confirmed booking gets the full advance back. */
  async cancelByVendor(vendorUserId: string, bookingId: string, reason: string) {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { vendorUserId });
      if (!['accepted', 'confirmed'].includes(b.status) || started(b)) {
        throw new AppError('BOOKING_BAD_STATUS', 'This booking cannot be cancelled.', HttpStatus.CONFLICT, { status: b.status });
      }
      if (isEngine(b) && !['scheduled', 'preparing'].includes(b.fulfilment)) {
        throw new AppError('BOOKING_IN_PROGRESS', 'Items are already on the way. Contact EventSeva support to cancel.', HttpStatus.CONFLICT);
      }
      const percent = isEngine(b) ? refundPercentFrom(b.cancellation_policy, 'vendor', daysLeft(b)) : refundPercent('vendor', daysLeft(b));
      const refunded = b.status === 'confirmed' && b.pay_mode === 'online' ? await this.refundAdvance(client, b, percent) : 0;
      await this.close(client, b.id, 'cancelled_by_vendor', reason);
      if (b.pay_mode === 'cash') await this.cashCancelled(client, b, percent);
      await notify(client, b.customer_id, 'booking_cancelled', {
        en: {
          title: 'Vendor cancelled',
          body: refunded ? `${rupees(refunded)} is being refunded in full. Sorry! Please book another vendor.` : 'Sorry! Please book another vendor.',
        },
        hi: {
          title: 'वेंडर ने रद्द किया',
          body: refunded ? `${rupees(refunded)} पूरा वापस किया जा रहा है। माफ़ कीजिए! दूसरा वेंडर चुनें।` : 'माफ़ कीजिए! दूसरा वेंडर चुनें।',
        },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'cancelled_by_vendor', vendorUserId, { reason, refundPaise: refunded });
      return { refundPaise: refunded };
    }));
  }

  /**
   * The vendor was paused, blocked or deleted: customers waiting on a reply or about to pay are
   * told straight away instead of waiting for the deadline. Confirmed bookings stay; the returned
   * count tells the admin how many still need a call.
   */
  async closeOpenFor(q: Queryable, vendorId: string): Promise<{ closed: number; confirmed: number }> {
    const open = await q.query<{ id: string; customer_id: string; vendor_id: string; status: BookingStatus; day: string }>(
      `SELECT id, customer_id, vendor_id, status, day FROM bookings WHERE vendor_id = $1 AND status IN ('requested', 'accepted') FOR UPDATE`,
      [vendorId],
    );
    for (const b of open.rows) {
      await this.close(q, b.id, b.status === 'requested' ? 'rejected' : 'cancelled_by_vendor', 'Vendor is not available on EventSeva right now');
      await notify(q, b.customer_id, 'booking_cancelled', {
        en: { title: 'Vendor not available', body: `This vendor is not taking bookings right now. Please choose another vendor for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर उपलब्ध नहीं', body: `यह वेंडर अभी बुकिंग नहीं ले रहा। ${niceDay(b.day, 'hi')} के लिए दूसरा वेंडर चुनें।` },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(q, b, b.status === 'requested' ? 'rejected' : 'cancelled_by_vendor', null, { reason: 'not_available' });
    }
    const confirmed = await this.db.one<{ n: number }>(q, `SELECT count(*)::int AS n FROM bookings WHERE vendor_id = $1 AND status = 'confirmed'`, [vendorId]);
    return { closed: open.rows.length, confirmed: confirmed!.n };
  }

  // ---------- calendar ----------

  async block(vendorUserId: string, day: string, slot: Slot) {
    if (day < todayIst()) throw new AppError('DATE_IN_PAST', 'This date has already passed.');
    if (day > lastPlannableDay()) throw new AppError('DATE_TOO_FAR', 'This date is too far ahead.', HttpStatus.BAD_REQUEST, { lastDay: lastPlannableDay() });
    await this.db.tx(async (client) => {
      const vendor = await this.db.one<{ id: string }>(client, 'SELECT id FROM vendors WHERE user_id = $1 FOR UPDATE', [vendorUserId]);
      if (!vendor) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
      await this.assertSlotFree(client, vendor!.id, day, slot);
      await client.query(`INSERT INTO availability (vendor_id, day, slot, status) VALUES ($1, $2, $3, 'blocked')`, [vendor!.id, day, slot]);
    });
  }

  async unblock(vendorUserId: string, day: string, slot: Slot) {
    const res = await this.db.query(
      `DELETE FROM availability a USING vendors v
        WHERE a.vendor_id = v.id AND v.user_id = $1 AND a.day = $2 AND a.slot = $3 AND a.status = 'blocked'`,
      [vendorUserId, day, slot],
    );
    if (!res.rowCount) throw new AppError('NOT_FOUND', 'This date is not blocked.', HttpStatus.NOT_FOUND);
  }

  // ---------- background job ----------

  /**
   * Runs every minute: expires unanswered requests and unpaid acceptances, and completes
   * bookings whose event day is over (which schedules the vendor payout).
   */
  async sweep(now = new Date()): Promise<{ expired: number; completed: number; reminded: number }> {
    let expired = 0;
    const noReply = await this.db.query<{ id: string; customer_id: string; vendor_id: string; day: string }>(
      `UPDATE bookings SET status = 'expired', updated_at = now()
        WHERE status = 'requested' AND respond_by < now() RETURNING id, customer_id, vendor_id, day`,
    );
    for (const b of noReply.rows) {
      expired++;
      await releaseAll(this.db, b.id);
      await postBookingEvent(this.db, b, 'expired', null, { why: 'no_reply' });
      await notify(this.db, b.customer_id, 'booking_expired', {
        en: { title: 'No reply from vendor', body: `The vendor did not reply in time. Please choose another vendor for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर ने जवाब नहीं दिया', body: `वेंडर ने समय पर जवाब नहीं दिया। ${niceDay(b.day, 'hi')} के लिए दूसरा वेंडर चुनें।` },
      }, { bookingId: b.id }, 'customer');
    }

    const unpaid = await this.db.query<{ id: string; customer_id: string; vendor_id: string; vendor_user_id: string; day: string }>(
      `WITH e AS (
         UPDATE bookings SET status = 'expired', updated_at = now()
          WHERE status = 'accepted' AND pay_by < now() RETURNING id, customer_id, vendor_id, day
       ), freed AS (DELETE FROM availability WHERE booking_id IN (SELECT id FROM e))
       SELECT e.id, e.customer_id, e.vendor_id, v.user_id AS vendor_user_id, e.day FROM e JOIN vendors v ON v.id = e.vendor_id`,
    );
    for (const b of unpaid.rows) {
      expired++;
      await releaseAll(this.db, b.id);
      await postBookingEvent(this.db, b, 'expired', null, { why: 'not_paid' });
      await notify(this.db, b.customer_id, 'booking_expired', {
        en: { title: 'Booking expired', body: `The advance for ${niceDay(b.day, 'en')} was not paid in time.` },
        hi: { title: 'बुकिंग की समय-सीमा ख़त्म', body: `${niceDay(b.day, 'hi')} का एडवांस समय पर नहीं दिया गया।` },
      }, { bookingId: b.id }, 'customer');
      await notify(this.db, b.vendor_user_id, 'booking_expired', {
        en: { title: 'Date free again', body: `The customer did not pay for ${niceDay(b.day, 'en')}, so the date is free again.` },
        hi: { title: 'तारीख़ फिर खाली', body: `ग्राहक ने ${niceDay(b.day, 'hi')} का भुगतान नहीं किया, इसलिए तारीख़ फिर खाली है।` },
      }, { bookingId: b.id }, 'partner');
    }

    // Rentals: once the event is over, the vendor collects the items (return pending).
    await this.db.query(
      `UPDATE bookings SET fulfilment = 'return_pending', updated_at = now()
        WHERE booking_type = 'rental' AND status = 'confirmed' AND fulfilment = 'delivered' AND ends_at < now()`,
    );
    // Returned rentals: charges agreed (or unanswered for 48 h) come off the deposit, the rest goes back.
    await this.fulfilment.settle();
    // Payout = advance − commission. Newer vendors are paid 3 days after the event (time for
    // complaints), regular vendors the next day, at 10 am India time.
    const done = await this.db.query<{ id: string; vendor_user_id: string; payout_paise: number; release_after: Date }>(
      `WITH c AS (
         UPDATE bookings SET status = 'completed', updated_at = now()
          WHERE status = 'confirmed' AND (
                  (booking_type = 'slot' AND day < (now() AT TIME ZONE 'Asia/Kolkata')::date)
                  -- Rentals and vehicles end when the return is checked, not by the clock.
               OR (booking_type NOT IN ('slot', 'rental', 'transport') AND ends_at < now())
               OR (booking_type IN ('rental', 'transport') AND fulfilment = 'closed' AND deposit_settled_at IS NOT NULL))
          RETURNING id, vendor_id, day, pay_mode, commission_paise,
                    -- Cash bookings: the vendor already has the money; EventSeva's commission becomes a due.
                    CASE WHEN pay_mode = 'cash' THEN 0 ELSE
                    advance_paise + charges_paise - commission_paise - payout_deduction_paise
                      + COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.booking_id = bookings.id AND p.type = 'final' AND p.status = 'paid'), 0)::int
                    END AS payout_paise
       ), d AS (
         INSERT INTO commission_dues (booking_id, vendor_id, amount_paise, remaining_paise)
         SELECT id, vendor_id, commission_paise, commission_paise FROM c WHERE pay_mode = 'cash' AND commission_paise > 0
         ON CONFLICT (booking_id) DO NOTHING
       ), p AS (
         INSERT INTO payouts (booking_id, vendor_id, amount_paise, release_after)
         SELECT c.id, c.vendor_id, c.payout_paise,
                ((c.day + CASE WHEN (SELECT count(*) FROM bookings x WHERE x.vendor_id = c.vendor_id AND x.status = 'completed'
                                       AND x.id NOT IN (SELECT id FROM c)) < $1 THEN 3 ELSE 1 END)
                  + time '10:00') AT TIME ZONE 'Asia/Kolkata'
           FROM c WHERE c.payout_paise > 0  -- fully refunded from the vendor's share: nothing to pay
         ON CONFLICT (booking_id) DO NOTHING
         RETURNING booking_id, release_after
       )
       SELECT c.id, v.user_id AS vendor_user_id, c.payout_paise, p.release_after
         FROM c JOIN vendors v ON v.id = c.vendor_id JOIN p ON p.booking_id = c.id`,
      [NEW_VENDOR_BOOKINGS],
    );
    for (const b of done.rows) {
      const when = new Date(b.release_after).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
      await notify(this.db, b.vendor_user_id, 'payout_scheduled', {
        en: { title: 'Payout scheduled', body: `${rupees(b.payout_paise)} will reach your bank on ${when}.` },
        hi: { title: 'पेमेंट तय', body: `${rupees(b.payout_paise)} ${when} को आपके बैंक में आएगा।` },
      }, { bookingId: b.id }, 'partner');
    }
    // Commission owed on cash bookings comes off the vendor's payouts that are not sent yet.
    await this.cash.applyDuesToPayouts();
    // Coupons held by bookings that ended unpaid (expired above) can be used again.
    await this.db.query(
      `WITH r AS (
         UPDATE coupon_redemptions cr SET status = 'released' FROM bookings b
          WHERE cr.booking_id = b.id AND cr.status = 'applied' AND b.status NOT IN ('requested', 'accepted')
          RETURNING cr.booking_id
       )
       UPDATE bookings SET discount_paise = 0 WHERE id IN (SELECT booking_id FROM r)`,
    );
    await this.trips.remindUnassigned();
    const reminded = await this.sendReminders(now);
    return { expired, completed: done.rows.length, reminded };
  }

  /** The customer changed the venue: vendors with an open booking for this event hear about it. */
  async venueChanged(q: Queryable, eventId: string, customerId: string) {
    const { rows } = await q.query<{ id: string; customer_id: string; vendor_id: string; vendor_user_id: string; status: BookingStatus; day: string }>(
      `SELECT b.id, b.customer_id, b.vendor_id, v.user_id AS vendor_user_id, b.status, b.day
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.event_id = $1 AND b.status IN ('requested', 'accepted', 'confirmed')`,
      [eventId],
    );
    for (const b of rows) {
      await postBookingEvent(q, b, 'venue_updated', customerId);
      // Only a confirmed vendor can see the venue, so only they get a push about it.
      if (b.status === 'confirmed') {
        await notify(q, b.vendor_user_id, 'venue_updated', {
          en: { title: 'Venue updated', body: `The customer changed the venue details for ${niceDay(b.day, 'en')}. Check the booking before you leave.` },
          hi: { title: 'वेन्यू बदला', body: `ग्राहक ने ${niceDay(b.day, 'hi')} के वेन्यू की जानकारी बदली है। निकलने से पहले बुकिंग देख लें।` },
        }, { bookingId: b.id }, 'partner');
      }
    }
  }

  // ---------- event day ----------

  /**
   * The vendor tells the customer they are on the way (with an ETA) or have reached. The ETA is what
   * the vendor says, or else our estimate from the two pins. Allowed on the event day and the
   * evening before (for long trips).
   */
  async progress(vendorUserId: string, bookingId: string, status: 'on_the_way' | 'reached', etaMinutes?: number) {
    return this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { vendorUserId });
      if (b.status !== 'confirmed') {
        throw new AppError('BOOKING_BAD_STATUS', 'Only confirmed bookings can be updated.', HttpStatus.CONFLICT, { status: b.status });
      }
      if (!progressAllowed(daysUntil(b.day))) {
        throw new AppError('PROGRESS_NOT_ALLOWED', 'You can share this on the event day, or the evening before.', HttpStatus.CONFLICT);
      }
      const t = await this.db.one<{ business_name: string; lat: string | null; lng: string | null; venue_lat: string | null; venue_lng: string | null; progress: string | null }>(
        client,
        `SELECT v.business_name, v.lat, v.lng, e.venue_lat, e.venue_lng, b.progress
           FROM bookings b JOIN vendors v ON v.id = b.vendor_id JOIN events e ON e.id = b.event_id WHERE b.id = $1`,
        [b.id],
      );
      if (status === 'on_the_way' && t!.progress === 'reached') {
        throw new AppError('BOOKING_BAD_STATUS', 'You have already marked that you reached.', HttpStatus.CONFLICT, { status: b.status });
      }
      const estimate = travelBetween(pointOf(t!.lat, t!.lng), pointOf(t!.venue_lat, t!.venue_lng));
      const minutes = status === 'on_the_way' ? (etaMinutes ?? estimate?.minutes ?? null) : null;
      const etaAt = minutes ? new Date(Date.now() + minutes * 60_000) : null;
      await client.query(`UPDATE bookings SET progress = $2, progress_at = now(), eta_at = $3, updated_at = now() WHERE id = $1`, [b.id, status, etaAt]);
      const name = t!.business_name;
      const at = etaAt ? clockIst(etaAt) : null;
      await notify(client, b.customer_id, `vendor_${status}`, status === 'on_the_way'
        ? {
            en: { title: `${name} is on the way`, body: minutes ? `Expected in about ${minutes} min (by ${at}).` : 'They will reach soon.' },
            hi: { title: `${name} रास्ते में हैं`, body: minutes ? `लगभग ${minutes} मिनट में पहुँचेंगे (${at} तक)।` : 'जल्द ही पहुँचेंगे।' },
          }
        : {
            en: { title: `${name} has reached`, body: 'The vendor is at your venue.' },
            hi: { title: `${name} पहुँच गए`, body: 'वेंडर आपके वेन्यू पर पहुँच गए हैं।' },
          }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, status, vendorUserId, { minutes, etaAt });
    });
  }

  /**
   * The evening before (from 5 pm India time) both sides get a reminder: what, where, how far and
   * when to arrive. Each booking is reminded once.
   */
  async sendReminders(now = new Date()): Promise<number> {
    const istHour = Number(new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(11, 13));
    if (istHour < REMINDER_HOUR_IST) return 0;
    const tomorrow = new Date(Date.parse(`${todayIst(now)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const { rows } = await this.db.query<{
      id: string; customer_id: string; vendor_user_id: string; slot: Slot; details: { arriveBy?: string | null };
      business_name: string; event_title: string; venue_address: string | null; venue_lat: string | null; venue_lng: string | null;
      lat: string | null; lng: string | null;
    }>(
      `UPDATE bookings b SET reminder_sent_at = now()
         FROM events e, vendors v
        WHERE e.id = b.event_id AND v.id = b.vendor_id AND b.status = 'confirmed' AND b.reminder_sent_at IS NULL AND b.day = $1
        RETURNING b.id, b.customer_id, v.user_id AS vendor_user_id, b.slot, b.details, v.business_name, e.title AS event_title,
                  e.venue_address, e.venue_lat, e.venue_lng, v.lat, v.lng`,
      [tomorrow],
    );
    for (const r of rows) {
      const trip = travelBetween(pointOf(r.lat, r.lng), pointOf(r.venue_lat, r.venue_lng));
      const arrive = r.details?.arriveBy ? timeLabel(r.details.arriveBy) : null;
      const noPin = !r.venue_lat;
      await notify(this.db, r.customer_id, 'booking_reminder', {
        en: {
          title: `Tomorrow: ${r.business_name}`,
          body: `${SLOT_TEXT.en[r.slot]} booking tomorrow.` + (noPin ? ' Add your venue location so the vendor can find you easily.' : ' The vendor has your venue details.'),
        },
        hi: {
          title: `कल: ${r.business_name}`,
          body: `कल ${SLOT_TEXT.hi[r.slot]} की बुकिंग है।` + (noPin ? ' वेन्यू की लोकेशन जोड़ें, ताकि वेंडर आसानी से पहुँच सकें।' : ' वेंडर के पास आपके वेन्यू की जानकारी है।'),
        },
      }, { bookingId: r.id }, 'customer');
      await notify(this.db, r.vendor_user_id, 'booking_reminder', {
        en: {
          title: `Tomorrow: ${r.event_title}`,
          body: [r.venue_address ? `At ${r.venue_address}.` : 'Ask the customer for the venue address.',
            trip ? `About ${trip.roadKm} km, ${trip.minutes} min.` : '', arrive ? `Reach by ${arrive}.` : ''].filter(Boolean).join(' '),
        },
        hi: {
          title: `कल: ${r.event_title}`,
          body: [r.venue_address ? `पता: ${r.venue_address}।` : 'ग्राहक से वेन्यू का पता पूछ लें।',
            trip ? `लगभग ${trip.roadKm} किमी, ${trip.minutes} मिनट।` : '', arrive ? `${arrive} तक पहुँचें।` : ''].filter(Boolean).join(' '),
        },
      }, { bookingId: r.id }, 'partner');
    }
    return rows.length;
  }

  // ---------- helpers ----------

  private async lockBooking(
    client: Queryable,
    bookingId: string,
    who: { customerId?: string; vendorUserId?: string },
  ): Promise<BookingRow> {
    const b = await this.db.one<BookingRow>(
      client,
      `SELECT b.id, b.event_id, b.customer_id, b.vendor_id, v.user_id AS vendor_user_id, b.status, b.day, b.slot,
              b.amount_paise, b.advance_paise, b.commission_paise, b.discount_paise, b.refund_paise, b.payout_deduction_paise, b.respond_by, b.pay_by,
              b.booking_type, b.starts_at, b.ends_at, b.occupy_from, b.occupy_until, b.snapshot->'needs' AS needs, b.cancellation_policy,
              b.deposit_paise, b.tax_paise, b.fulfilment, b.pay_mode
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR b.customer_id = $2) AND ($3::uuid IS NULL OR v.user_id = $3)
        FOR UPDATE OF b`,
      [bookingId, who.customerId ?? null, who.vendorUserId ?? null],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }

  private assertRequested(b: BookingRow) {
    if (b.status === 'requested' && b.respond_by < new Date()) {
      throw new AppError('BOOKING_EXPIRED', 'This request has expired.', HttpStatus.CONFLICT);
    }
    if (b.status !== 'requested') {
      throw new AppError('BOOKING_BAD_STATUS', 'This request has already been answered.', HttpStatus.CONFLICT, { status: b.status });
    }
  }

  private async assertSlotFree(q: Queryable, vendorId: string, day: string, slot: Slot) {
    const taken = await this.db.one<{ status: string }>(
      q,
      `SELECT status FROM availability
        WHERE vendor_id = $1 AND day = $2 AND (slot = $3 OR slot = 'full' OR $3 = 'full') LIMIT 1`,
      [vendorId, day, slot],
    );
    if (taken) throw new AppError('SLOT_TAKEN', 'The vendor is not free at this time.', HttpStatus.CONFLICT);
    // Their team may also be booked by the hour through the booking engine.
    const crew = await this.db.one(
      q,
      `SELECT 1 FROM reservations r JOIN resources x ON x.id = r.resource_id
        WHERE x.vendor_id = $1 AND x.kind = 'crew' AND (r.status = 'active' OR (r.status = 'hold' AND r.expires_at > now()))
          AND r.period && tstzrange(
                ($2::date + CASE $3 WHEN 'day' THEN time '10:00' WHEN 'night' THEN time '18:00' ELSE time '00:00' END) AT TIME ZONE 'Asia/Kolkata',
                ($2::date + CASE $3 WHEN 'day' THEN time '16:00' ELSE time '23:59' END) AT TIME ZONE 'Asia/Kolkata')
        LIMIT 1`,
      [vendorId, day, slot],
    );
    if (crew) throw new AppError('SLOT_TAKEN', 'The vendor is not free at this time.', HttpStatus.CONFLICT);
  }

  /** Ends a booking and frees the vendor's slot. */
  /** Ends a booking, frees the vendor's slot, and gives back an unpaid coupon. */
  private async close(q: Queryable, bookingId: string, status: BookingStatus, reason: string) {
    await q.query(`UPDATE bookings SET status = $2, cancel_reason = $3, updated_at = now() WHERE id = $1`, [bookingId, status, reason]);
    await q.query('DELETE FROM availability WHERE booking_id = $1', [bookingId]);
    await releaseAll(q, bookingId);
    await this.coupons.releaseFor(q, bookingId);
  }

  /** Refund by the cancellation rule, on what was actually paid (after any coupon) and not yet refunded. */
  private async refundAdvance(q: Queryable, b: BookingRow, percent: number): Promise<number> {
    const paid = await this.paidAdvance(q, b.id);
    if (!paid) return 0;
    let total = 0;
    const amount = Math.min(refundPaise(paid.amount_paise, percent), paid.amount_paise - b.refund_paise);
    if (amount > 0) {
      await this.refund(q, b.id, paid.razorpay_payment_id, amount, 'cancellation');
      total += amount;
    }
    // Engine bookings: a paid balance follows the same tier; the security deposit always comes back.
    const others = await q.query<{ id: string; type: string; razorpay_payment_id: string; amount_paise: number }>(
      `SELECT id, type, razorpay_payment_id, amount_paise FROM payments WHERE booking_id = $1 AND type IN ('final', 'deposit') AND status = 'paid'`,
      [b.id],
    );
    for (const o of others.rows) {
      const back = o.type === 'deposit' ? o.amount_paise : refundPaise(o.amount_paise, percent);
      if (back <= 0) continue;
      await this.refunds.queue(q, b.id, o.razorpay_payment_id, back, o.type === 'deposit' ? 'deposit_return' : 'cancellation');
      if (o.type === 'final') await q.query('UPDATE bookings SET refund_paise = refund_paise + $2 WHERE id = $1', [b.id, back]);
      if (back === o.amount_paise) await q.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [o.id]);
      total += back;
    }
    return total;
  }

  private paidAdvance(q: Queryable, bookingId: string) {
    return this.db.one<{ razorpay_payment_id: string; amount_paise: number }>(
      q,
      `SELECT razorpay_payment_id, amount_paise FROM payments WHERE booking_id = $1 AND type = 'advance' AND status = 'paid'`,
      [bookingId],
    );
  }

  /**
   * Admin goodwill or partial refund (e.g. the vendor came late). Any amount up to what is left of
   * the payment. With `fromVendorPayout` the same amount comes off the vendor's payout, which must
   * not be paid yet; otherwise EventSeva bears it.
   */
  async adminRefund(adminId: string, bookingId: string, amountPaise: number, reason: string, fromVendorPayout: boolean) {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, {});
      const paid = await this.paidAdvance(client, bookingId);
      if (!paid) throw new AppError('NOTHING_TO_REFUND', 'No payment has been made for this booking.', HttpStatus.CONFLICT);
      const left = paid.amount_paise - b.refund_paise;
      if (amountPaise > left) {
        throw new AppError('REFUND_TOO_HIGH', `At most ${rupees(left)} can still be refunded.`, HttpStatus.BAD_REQUEST, { maxPaise: left });
      }
      if (fromVendorPayout) {
        const payout = await this.db.one<{ id: string; status: string; amount_paise: number }>(
          client,
          'SELECT id, status, amount_paise FROM payouts WHERE booking_id = $1 FOR UPDATE',
          [bookingId],
        );
        // Confirmed bookings get their payout later (created with the deduction); cancelled ones only
        // have one when a late cancellation paid the vendor something.
        if (!payout && b.status !== 'confirmed') {
          throw new AppError('NO_VENDOR_PAYOUT', 'This booking has no vendor payout to take the refund from.', HttpStatus.CONFLICT, { status: b.status });
        }
        if (payout && !['scheduled', 'held', 'failed'].includes(payout.status)) {
          throw new AppError('PAYOUT_ALREADY_PAID', 'The vendor has already been paid for this booking.', HttpStatus.CONFLICT);
        }
        const maxDeduction = payout ? payout.amount_paise : b.advance_paise - b.commission_paise - b.payout_deduction_paise;
        if (amountPaise > maxDeduction) {
          throw new AppError('DEDUCTION_TOO_HIGH', `At most ${rupees(Math.max(0, maxDeduction))} can come off the vendor's payout.`, HttpStatus.BAD_REQUEST, {
            maxPaise: Math.max(0, maxDeduction),
          });
        }
        await client.query('UPDATE bookings SET payout_deduction_paise = payout_deduction_paise + $2 WHERE id = $1', [bookingId, amountPaise]);
        // Already scheduled payouts shrink now; later ones are created with the deduction.
        if (payout) {
          // Cut to ₹0: nothing is left to transfer, so the payout is closed instead of waiting for finance.
          await client.query(
            `UPDATE payouts SET amount_paise = amount_paise - $2,
                    status = CASE WHEN amount_paise - $2 = 0 THEN 'paid'::payout_status ELSE status END,
                    razorpay_transfer_id = CASE WHEN amount_paise - $2 = 0 THEN 'NOTHING_TO_PAY' ELSE razorpay_transfer_id END
              WHERE id = $1`,
            [payout.id, amountPaise],
          );
        }
      }
      await this.refund(client, bookingId, paid.razorpay_payment_id, amountPaise, 'admin');
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'booking.refund', 'booking', $2, $3, $4)`,
        [adminId, bookingId, { refundPaise: b.refund_paise }, { refundPaise: b.refund_paise + amountPaise, amountPaise, reason, fromVendorPayout }],
      );
      await notify(client, b.customer_id, 'payment_refunded', {
        en: { title: 'Refund on its way', body: `${rupees(amountPaise)} is being refunded to you: ${reason}` },
        hi: { title: 'पैसा वापस आ रहा है', body: `${rupees(amountPaise)} आपको वापस किया जा रहा है: ${reason}` },
      }, { bookingId }, 'customer');
      if (fromVendorPayout) {
        await notify(client, b.vendor_user_id, 'payout_adjusted', {
          en: { title: 'Payout reduced', body: `${rupees(amountPaise)} was refunded to the customer from your payout: ${reason}` },
          hi: { title: 'पेमेंट में कटौती', body: `${rupees(amountPaise)} आपके पेमेंट से ग्राहक को वापस किया गया: ${reason}` },
        }, { bookingId }, 'partner');
      }
      return { refundPaise: b.refund_paise + amountPaise };
    }));
  }

  /** Refunds queued by a transaction go out once it has committed (failures are retried by the queue). */
  private async thenSendRefunds<T>(work: Promise<T>): Promise<T> {
    const result = await work;
    await this.refunds.flush();
    return result;
  }

  /**
   * Queues a refund (sent after the transaction commits, see RefundsService).
   * `track`: count it in the booking's refund total (not for a stray duplicate payment on a still-open booking).
   */
  private async refund(q: Queryable, bookingId: string, paymentId: string, amountPaise: number, why: string, track = true) {
    await this.refunds.queue(q, bookingId, paymentId, amountPaise, why);
    if (track) await q.query('UPDATE bookings SET refund_paise = refund_paise + $2 WHERE id = $1', [bookingId, amountPaise]);
  }

}
