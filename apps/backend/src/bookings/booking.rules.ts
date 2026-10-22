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

/** Whole days from today (India) to the event day; 0 on the day itself. */
export function daysUntil(day: string, now = new Date()): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayIst(now)}T00:00:00Z`)) / 86_400_000);
}
