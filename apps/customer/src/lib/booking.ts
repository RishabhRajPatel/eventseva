// Booking rules the app shows before the server decides. The server always prices a booking and
// works out refunds; these numbers are previews and are labelled as estimates on screen.
import { COUNTED_UNITS, todayIst, type Booking, type BookingStatus, type PricingUnit } from '@eventseva/app-shared';

/** Share of the price paid in the app to confirm a booking; the rest is paid to the vendor after the event. */
export const ADVANCE_PERCENT = 25;
export const MAX_QUANTITY = 100_000;

/** Units where the customer says how many (plates, hours, rooms …). */
export const needsQuantity = (unit: PricingUnit) => COUNTED_UNITS.includes(unit);

/** A whole number from 1 to 100,000, or null. */
export function parseQuantity(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

export interface Estimate {
  amountPaise: number;
  advancePaise: number;
  balancePaise: number;
}

/**
 * Unit price × quantity, split into the advance and the balance. Fixed-price units ignore the
 * quantity; counted units return null until a valid quantity is entered.
 */
export function estimate(unitPricePaise: number, unit: PricingUnit, quantity: number | null): Estimate | null {
  const qty = needsQuantity(unit) ? quantity : 1;
  if (!qty || qty < 1) return null;
  const amountPaise = unitPricePaise * qty;
  const advancePaise = Math.round((amountPaise * ADVANCE_PERCENT) / 100);
  return { amountPaise, advancePaise, balancePaise: amountPaise - advancePaise };
}

/** Whole days from `today` to `day` (both 'YYYY-MM-DD'); 0 on the day itself. */
export function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

const ACTIVE: BookingStatus[] = ['requested', 'accepted', 'confirmed'];

/** Rentals on their way (preparing onwards) are cancelled through support, not in the app. */
const CANCELLABLE_STAGES = ['pending_confirmation', 'awaiting_payment', 'confirmed'];
export const canCancel = (b: Pick<Booking, 'status' | 'day'> & Partial<Pick<Booking, 'stage'>>, today = todayIst()) =>
  ACTIVE.includes(b.status) && daysBetween(today, b.day) >= 0 && (!b.stage || CANCELLABLE_STAGES.includes(b.stage));

/** Customer refund policy: 15+ days before the event 90%, 7–14 days 50%, under 7 days nothing. */
export function refundPercent(daysBefore: number): number {
  if (daysBefore >= 15) return 90;
  if (daysBefore >= 7) return 50;
  return 0;
}

export interface RefundPreview {
  /** false when nothing has been paid yet, so there is nothing to refund. */
  paid: boolean;
  percent: number;
  refundPaise: number;
  daysBefore: number;
}

/**
 * What the customer would get back if they cancelled today; null when the booking cannot be cancelled.
 * Worked out on what was actually paid (`payNowPaise`: the advance minus any coupon discount).
 */
export function refundPreview(b: Pick<Booking, 'status' | 'day' | 'payNowPaise'>, today = todayIst()): RefundPreview | null {
  if (!canCancel(b, today)) return null;
  const daysBefore = daysBetween(today, b.day);
  if (b.status !== 'confirmed') return { paid: false, percent: 0, refundPaise: 0, daysBefore };
  const percent = refundPercent(daysBefore);
  return { paid: true, percent, refundPaise: Math.round((b.payNowPaise * percent) / 100), daysBefore };
}

export type StatusTone = 'lavender' | 'peach' | 'mint' | 'ink' | 'muted';

/** Pill colour for each status, from the colour board (Main.dc.html). */
export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  requested: 'lavender',
  accepted: 'peach',
  confirmed: 'mint',
  completed: 'mint',
  rejected: 'muted',
  expired: 'muted',
  cancelled_by_customer: 'ink',
  cancelled_by_vendor: 'ink',
};

export const isPending = (s: BookingStatus) => s === 'requested' || s === 'accepted';
export const isConfirmed = (s: BookingStatus) => s === 'confirmed' || s === 'completed';
