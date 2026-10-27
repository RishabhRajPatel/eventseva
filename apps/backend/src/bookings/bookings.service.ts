import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { BookingStatus } from '@eventseva/core';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway';
import { CouponsService } from '../coupons/coupons.service';
import { RefundsService } from '../payments/refunds.service';
import type { PricingUnit } from '../vendors/vendor.queries';
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
  eventId: string;
  vendorId: string;
  serviceId?: string;
  packageId?: string;
  slot: Slot;
  quantity?: number;
  note?: string;
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
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
/** "21 Nov" / "21 नव॰" for notifications; days are plain dates, so no time-zone shift. */
const niceDay = (day: string, lang: 'en' | 'hi') =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
/** Whole hours left until a deadline, at least 1, for notification text. */
const hoursLeft = (until: Date) => Math.max(1, Math.floor((until.getTime() - Date.now()) / 3600_000));
/** "Not free that day." for a reason typed as "Not free that day" or "Not free that day." */
const sentence = (text: string) => text.replace(/[\s.।!]+$/u, '');
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
        ? await this.db.one<{ title: string; price_paise: number; unit: PricingUnit; min_guests: number | null; max_guests: number | null }>(
            client,
            'SELECT title, price_paise, unit, min_guests, max_guests FROM services WHERE id = $1 AND vendor_id = $2 AND is_active',
            [body.serviceId, body.vendorId],
          )
        : await this.db.one<{ title: string; price_paise: number; unit: 'package'; min_guests: null; max_guests: null }>(
            client,
            `SELECT title, price_paise, 'package' AS unit, NULL AS min_guests, NULL AS max_guests FROM packages WHERE id = $1 AND vendor_id = $2 AND is_active`,
            [body.packageId, body.vendorId],
          );
      if (!item) throw new AppError('ITEM_NOT_FOUND', 'This service or package is no longer offered.', HttpStatus.NOT_FOUND);

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

      const open = await this.db.one(
        client,
        'SELECT 1 FROM bookings WHERE event_id = $1 AND vendor_id = $2 AND status = ANY($3)',
        [body.eventId, body.vendorId, ACTIVE],
      );
      if (open) throw new AppError('BOOKING_EXISTS', 'You already have a booking with this vendor for this event.', HttpStatus.CONFLICT);
      await this.assertSlotFree(client, body.vendorId, event.event_date, body.slot);

      const booking = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO bookings (event_id, customer_id, vendor_id, service_id, package_id, day, slot, quantity, details,
                               amount_paise, advance_paise, commission_paise, respond_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [body.eventId, customerId, body.vendorId, body.serviceId ?? null, body.packageId ?? null, event.event_date, body.slot,
          quantity, { note: body.note?.trim() || null }, money.amountPaise, money.advancePaise, money.commissionPaise, respondBy],
      );
      await notify(client, vendor.user_id, 'booking_requested', {
        en: { title: 'New booking request', body: `${item.title} on ${niceDay(event.event_date, 'en')}. Reply within ${hoursLeft(respondBy)} hours.` },
        hi: { title: 'नई बुकिंग रिक्वेस्ट', body: `${item.title}, ${niceDay(event.event_date, 'hi')}। ${hoursLeft(respondBy)} घंटे में जवाब दें।` },
      }, { bookingId: booking!.id }, 'partner');
      return booking!.id;
    });
  }

  /** Starts (or resumes) the advance payment: returns what the Razorpay checkout needs. */
  async startPayment(customerId: string, bookingId: string) {
    return this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { customerId });
      if (b.status !== 'accepted') {
        throw new AppError('BOOKING_BAD_STATUS', 'This booking is not waiting for payment.', HttpStatus.CONFLICT, { status: b.status });
      }
      if (b.pay_by && b.pay_by < new Date()) throw new AppError('PAYMENT_TIME_OVER', 'The time to pay has run out.', HttpStatus.CONFLICT);

      // What is paid now: the advance minus any coupon discount (EventSeva pays the discount).
      const payNow = b.advance_paise - b.discount_paise;
      // Reuse an open order: two taps on "Pay" must never create two charges. An order for a
      // different amount (the coupon changed) is dropped and a new one made.
      let payment = await this.db.one<{ id: string; razorpay_order_id: string; amount_paise: number }>(
        client,
        `SELECT id, razorpay_order_id, amount_paise FROM payments WHERE booking_id = $1 AND type = 'advance' AND status = 'created'`,
        [bookingId],
      );
      if (payment && payment.amount_paise !== payNow) {
        await client.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [payment.id]);
        payment = undefined;
      }
      if (!payment) {
        const { orderId } = await this.gateway.createOrder(payNow, bookingId, { bookingId });
        await client.query(
          `INSERT INTO payments (booking_id, type, amount_paise, razorpay_order_id) VALUES ($1, 'advance', $2, $3)`,
          [bookingId, payNow, orderId],
        );
        payment = { id: '', razorpay_order_id: orderId, amount_paise: payNow };
      }
      return { orderId: payment.razorpay_order_id, amountPaise: payNow, currency: 'INR', keyId: this.gateway.keyId };
    });
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
  async devPay(customerId: string, bookingId: string) {
    if (this.config.paymentProvider !== 'fake') throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    const { orderId } = await this.startPayment(customerId, bookingId);
    await this.paymentCaptured(orderId, `pay_dev_${Date.now()}`);
  }

  /**
   * Marks a payment as paid and confirms the booking. Safe to call twice. If the booking was
   * cancelled or expired before the money arrived, the whole amount goes straight back.
   */
  async paymentCaptured(orderId: string, paymentId: string): Promise<'confirmed' | 'refunded' | 'already_done' | 'unknown_order'> {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const p = await this.db.one<{ id: string; booking_id: string; amount_paise: number; status: string }>(
        client,
        `SELECT id, booking_id, amount_paise, status FROM payments WHERE razorpay_order_id = $1 FOR UPDATE`,
        [orderId],
      );
      if (!p) return 'unknown_order';
      if (p.status === 'paid' || p.status === 'refunded') return 'already_done';

      const b = await this.lockBooking(client, p.booking_id, {});
      await client.query(`UPDATE payments SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1`, [p.id, paymentId]);

      // A replaced order (coupon changed after checkout opened) that still got paid is refunded.
      const replaced = p.status === 'failed';
      if (b.status === 'accepted' && !replaced) {
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
    }));
  }

  async cancelByCustomer(customerId: string, bookingId: string, reason: string) {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { customerId });
      if (!ACTIVE.includes(b.status)) {
        throw new AppError('BOOKING_BAD_STATUS', 'This booking cannot be cancelled.', HttpStatus.CONFLICT, { status: b.status });
      }
      const days = daysUntil(b.day);
      if (days < 0) throw new AppError('BOOKING_BAD_STATUS', 'The event date has passed.', HttpStatus.CONFLICT, { status: b.status });

      const percent = refundPercent('customer', days);
      const refunded = b.status === 'confirmed' ? await this.refundAdvance(client, b, percent) : 0;
      await this.close(client, b.id, 'cancelled_by_customer', reason);
      const compensation = b.status === 'confirmed' ? await this.cancellationPayout(client, b, percent) : 0;
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
      return { refundPaise: refunded };
    }));
  }

  /**
   * A late customer cancellation keeps part of the advance. The vendor lost the date, so they get
   * that kept part minus EventSeva's commission (EventSeva covers any coupon), paid on the usual
   * schedule after the original event day.
   */
  private async cancellationPayout(q: Queryable, b: BookingRow, refundPercentOfAdvance: number): Promise<number> {
    const kept = b.advance_paise - refundPaise(b.advance_paise, refundPercentOfAdvance);
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

  async accept(vendorUserId: string, bookingId: string) {
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
      await this.assertSlotFree(client, b.vendor_id, b.day, b.slot);
      await client.query(
        `INSERT INTO availability (vendor_id, day, slot, status, booking_id) VALUES ($1, $2, $3, 'booked', $4)`,
        [b.vendor_id, b.day, b.slot, b.id],
      );
      const payBy = payByFor(b.day);
      await client.query(`UPDATE bookings SET status = 'accepted', pay_by = $2, updated_at = now() WHERE id = $1`, [b.id, payBy]);
      await notify(client, b.customer_id, 'booking_accepted', {
        en: { title: 'Vendor accepted', body: `Pay the advance of ${rupees(b.advance_paise - b.discount_paise)} within ${hoursLeft(payBy)} hours to confirm ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर ने मंज़ूर किया', body: `${niceDay(b.day, 'hi')} पक्का करने के लिए ${hoursLeft(payBy)} घंटे में ${rupees(b.advance_paise - b.discount_paise)} एडवांस दें।` },
      }, { bookingId: b.id }, 'customer');
    });
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
    });
  }

  /** After accepting. A confirmed booking gets the full advance back. */
  async cancelByVendor(vendorUserId: string, bookingId: string, reason: string) {
    return this.thenSendRefunds(this.db.tx(async (client) => {
      const b = await this.lockBooking(client, bookingId, { vendorUserId });
      if (!['accepted', 'confirmed'].includes(b.status) || daysUntil(b.day) < 0) {
        throw new AppError('BOOKING_BAD_STATUS', 'This booking cannot be cancelled.', HttpStatus.CONFLICT, { status: b.status });
      }
      const refunded = b.status === 'confirmed' ? await this.refundAdvance(client, b, refundPercent('vendor', daysUntil(b.day))) : 0;
      await this.close(client, b.id, 'cancelled_by_vendor', reason);
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
      return { refundPaise: refunded };
    }));
  }

  /**
   * The vendor was paused, blocked or deleted: customers waiting on a reply or about to pay are
   * told straight away instead of waiting for the deadline. Confirmed bookings stay; the returned
   * count tells the admin how many still need a call.
   */
  async closeOpenFor(q: Queryable, vendorId: string): Promise<{ closed: number; confirmed: number }> {
    const open = await q.query<{ id: string; customer_id: string; status: BookingStatus; day: string }>(
      `SELECT id, customer_id, status, day FROM bookings WHERE vendor_id = $1 AND status IN ('requested', 'accepted') FOR UPDATE`,
      [vendorId],
    );
    for (const b of open.rows) {
      await this.close(q, b.id, b.status === 'requested' ? 'rejected' : 'cancelled_by_vendor', 'Vendor is not available on EventSeva right now');
      await notify(q, b.customer_id, 'booking_cancelled', {
        en: { title: 'Vendor not available', body: `This vendor is not taking bookings right now. Please choose another vendor for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर उपलब्ध नहीं', body: `यह वेंडर अभी बुकिंग नहीं ले रहा। ${niceDay(b.day, 'hi')} के लिए दूसरा वेंडर चुनें।` },
      }, { bookingId: b.id }, 'customer');
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
  async sweep(): Promise<{ expired: number; completed: number }> {
    let expired = 0;
    const noReply = await this.db.query<{ id: string; customer_id: string; day: string }>(
      `UPDATE bookings SET status = 'expired', updated_at = now()
        WHERE status = 'requested' AND respond_by < now() RETURNING id, customer_id, day`,
    );
    for (const b of noReply.rows) {
      expired++;
      await notify(this.db, b.customer_id, 'booking_expired', {
        en: { title: 'No reply from vendor', body: `The vendor did not reply in time. Please choose another vendor for ${niceDay(b.day, 'en')}.` },
        hi: { title: 'वेंडर ने जवाब नहीं दिया', body: `वेंडर ने समय पर जवाब नहीं दिया। ${niceDay(b.day, 'hi')} के लिए दूसरा वेंडर चुनें।` },
      }, { bookingId: b.id }, 'customer');
    }

    const unpaid = await this.db.query<{ id: string; customer_id: string; vendor_user_id: string; day: string }>(
      `WITH e AS (
         UPDATE bookings SET status = 'expired', updated_at = now()
          WHERE status = 'accepted' AND pay_by < now() RETURNING id, customer_id, vendor_id, day
       ), freed AS (DELETE FROM availability WHERE booking_id IN (SELECT id FROM e))
       SELECT e.id, e.customer_id, v.user_id AS vendor_user_id, e.day FROM e JOIN vendors v ON v.id = e.vendor_id`,
    );
    for (const b of unpaid.rows) {
      expired++;
      await notify(this.db, b.customer_id, 'booking_expired', {
        en: { title: 'Booking expired', body: `The advance for ${niceDay(b.day, 'en')} was not paid in time.` },
        hi: { title: 'बुकिंग की समय-सीमा ख़त्म', body: `${niceDay(b.day, 'hi')} का एडवांस समय पर नहीं दिया गया।` },
      }, { bookingId: b.id }, 'customer');
      await notify(this.db, b.vendor_user_id, 'booking_expired', {
        en: { title: 'Date free again', body: `The customer did not pay for ${niceDay(b.day, 'en')}, so the date is free again.` },
        hi: { title: 'तारीख़ फिर खाली', body: `ग्राहक ने ${niceDay(b.day, 'hi')} का भुगतान नहीं किया, इसलिए तारीख़ फिर खाली है।` },
      }, { bookingId: b.id }, 'partner');
    }

    // Payout = advance − commission. Newer vendors are paid 3 days after the event (time for
    // complaints), regular vendors the next day, at 10 am India time.
    const done = await this.db.query<{ id: string; vendor_user_id: string; payout_paise: number; release_after: Date }>(
      `WITH c AS (
         UPDATE bookings SET status = 'completed', updated_at = now()
          WHERE status = 'confirmed' AND day < (now() AT TIME ZONE 'Asia/Kolkata')::date
          RETURNING id, vendor_id, day, advance_paise - commission_paise - payout_deduction_paise AS payout_paise
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
    // Coupons held by bookings that ended unpaid (expired above) can be used again.
    await this.db.query(
      `WITH r AS (
         UPDATE coupon_redemptions cr SET status = 'released' FROM bookings b
          WHERE cr.booking_id = b.id AND cr.status = 'applied' AND b.status NOT IN ('requested', 'accepted')
          RETURNING cr.booking_id
       )
       UPDATE bookings SET discount_paise = 0 WHERE id IN (SELECT booking_id FROM r)`,
    );
    return { expired, completed: done.rows.length };
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
              b.amount_paise, b.advance_paise, b.commission_paise, b.discount_paise, b.refund_paise, b.payout_deduction_paise, b.respond_by, b.pay_by
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
  }

  /** Ends a booking and frees the vendor's slot. */
  /** Ends a booking, frees the vendor's slot, and gives back an unpaid coupon. */
  private async close(q: Queryable, bookingId: string, status: BookingStatus, reason: string) {
    await q.query(`UPDATE bookings SET status = $2, cancel_reason = $3, updated_at = now() WHERE id = $1`, [bookingId, status, reason]);
    await q.query('DELETE FROM availability WHERE booking_id = $1', [bookingId]);
    await this.coupons.releaseFor(q, bookingId);
  }

  /** Refund by the cancellation rule, on what was actually paid (after any coupon) and not yet refunded. */
  private async refundAdvance(q: Queryable, b: BookingRow, percent: number): Promise<number> {
    const paid = await this.paidAdvance(q, b.id);
    if (!paid) return 0;
    const amount = Math.min(refundPaise(paid.amount_paise, percent), paid.amount_paise - b.refund_paise);
    if (amount <= 0) return 0;
    await this.refund(q, b.id, paid.razorpay_payment_id, amount, 'cancellation');
    return amount;
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
