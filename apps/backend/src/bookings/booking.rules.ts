// Booking money and calendar rules, kept free of the database so they are easy to test and change.
import type { PricingUnit } from '../vendors/vendor.queries';

export const SLOTS = ['full', 'day', 'night'] as const;
export type Slot = (typeof SLOTS)[number];

export const EVENT_TYPES = [
  'wedding',
  'engagement',
  'haldi',
  'mehendi',
  'birthday',
  'anniversary',
  'puja',
  'griha_pravesh',
  'naamkaran',
  'corporate',
  'party',
  'other',
] as const;

/** Vendor has this long to accept or reject a request. */
export const RESPOND_HOURS = 24;
/** After acceptance, the customer has this long to pay the advance. */
export const PAY_HOURS = 24;
/**
 * Everything (reply and payment) must finish before the event day starts (midnight, India).
 * The vendor's reply deadline stops this long before that, so the customer still has time to pay.
 */
export const PAY_WINDOW_MIN_HOURS = 1;
/** Events can be planned this far ahead at most (also the vendor calendar limit). */
export const MAX_DAYS_AHEAD = 730;
/** Unanswered requests one customer can have at a time (stops request spam to vendors). */
export const MAX_OPEN_REQUESTS = 15;
export const MAX_BOOKING_PAISE = 500_000_000; // ₹50 lakh
/** Vendors with fewer completed bookings than this get paid 3 days after the event, not 1. */
export const NEW_VENDOR_BOOKINGS = 5;

/** Units where the customer says how many (plates, hours …); the rest are a fixed price. */
const COUNTED_UNITS: PricingUnit[] = ['per_plate', 'per_person', 'per_hour', 'per_day', 'per_km', 'per_room_night'];
export const needsQuantity = (unit: PricingUnit | 'package') => COUNTED_UNITS.includes(unit as PricingUnit);

export interface Money {
  amountPaise: number;
  advancePaise: number;
  commissionPaise: number;
}

/** The server always works out the price; the app never sends an amount. */
export function priceBooking(unitPricePaise: number, quantity: number, advancePercent: number, commissionPercent: number): Money {
  const amountPaise = unitPricePaise * quantity;
  return {
    amountPaise,
    advancePaise: Math.round((amountPaise * advancePercent) / 100),
    commissionPaise: Math.round((amountPaise * commissionPercent) / 100),
  };
}

/** A whole-day booking clashes with everything that day; day and night can both be booked. */
export const slotsClash = (a: Slot, b: Slot) => a === b || a === 'full' || b === 'full';

/**
 * Refund of the advance when a confirmed booking is cancelled.
 * Customer: 15+ days before the event 90%, 7–14 days 50%, less than 7 days nothing.
 * Vendor: always 100% (the customer did nothing wrong).
 */
export function refundPercent(cancelledBy: 'customer' | 'vendor', daysBeforeEvent: number): number {
  if (cancelledBy === 'vendor') return 100;
  if (daysBeforeEvent >= 15) return 90;
  if (daysBeforeEvent >= 7) return 50;
  return 0;
}

export const refundPaise = (advancePaise: number, percent: number) => Math.round((advancePaise * percent) / 100);

/** Today's date in India, whatever time zone the server runs in. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Midnight at the start of an India date. */
export const eventStart = (day: string) => new Date(`${day}T00:00:00+05:30`);

/**
 * When the vendor must reply by: RESPOND_HOURS from now, but never so late that the customer
 * has less than PAY_WINDOW_MIN_HOURS left to pay before the event day starts. null = too late
 * to book online (the vendor would get less than an hour to reply).
 */
export function respondByFor(day: string, now = new Date()): Date | null {
  const latest = eventStart(day).getTime() - PAY_WINDOW_MIN_HOURS * 3600_000;
  const respondBy = Math.min(now.getTime() + RESPOND_HOURS * 3600_000, latest);
  return respondBy - now.getTime() < 3600_000 ? null : new Date(respondBy);
}

/** Pay deadline after the vendor accepts: PAY_HOURS, but always before the event day starts. */
export const payByFor = (day: string, now = new Date()) =>
  new Date(Math.min(now.getTime() + PAY_HOURS * 3600_000, eventStart(day).getTime()));

/** The last day that can be planned or blocked: today + MAX_DAYS_AHEAD (India). */
export const lastPlannableDay = (now = new Date()) => todayIst(new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000));

/** Units where the count is people, so the service's min / max guests apply. */
export const GUEST_UNITS: PricingUnit[] = ['per_plate', 'per_person'];

/** Whole days from today (India) to the event day; 0 on the day itself. */
export function daysUntil(day: string, now = new Date()): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayIst(now)}T00:00:00Z`)) / 86_400_000);
}
