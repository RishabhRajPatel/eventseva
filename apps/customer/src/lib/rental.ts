// Renting items (tent, chairs, utensils …): dates and times in India time, quantity rules, and the
// cart the screen keeps. The server checks and prices everything again; these only guide the customer.
import type { RentalCatalogue } from '@eventseva/app-shared';

export type RentalItem = RentalCatalogue['items'][number];
export type Cart = Record<string, number>;

/** Delivery / pickup times offered (India time). */
export const RENTAL_TIMES = ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'] as const;

/** 'YYYY-MM-DD' + 'HH:MM' India time → ISO with the +05:30 offset the API wants. */
export const istIso = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;

/** The day `n` days after `day`. */
export function addDaysTo(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days the rent is charged for: every started 24 hours, at least one. */
export function rentalDays(startsAt: string, endsAt: string): number {
  const hours = (Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000;
  return Math.max(1, Math.ceil(hours / 24));
}

/** Most the customer may pick: what is free for the dates, and the vendor's per-booking limit. */
export function maxQty(item: Pick<RentalItem, 'available' | 'stock' | 'maxQty'>): number {
  const free = item.available ?? item.stock;
  return Math.max(0, item.maxQty !== null ? Math.min(free, item.maxQty) : free);
}

/**
 * The next quantity for a +/- tap: jumps to the minimum when starting, drops to 0 below it, never
 * above what can be booked.
 */
export function stepQty(item: Pick<RentalItem, 'minQty' | 'available' | 'stock' | 'maxQty'>, current: number, delta: number): number {
  const max = maxQty(item);
  if (delta > 0 && current === 0) {
    const start = Math.max(item.minQty, 1);
    return start <= max ? start : 0;
  }
  const next = current + delta;
  if (next < item.minQty) return 0;
  return Math.min(next, max);
}

/** Problem with one cart line, or null. */
export function lineProblem(item: Pick<RentalItem, 'minQty' | 'available' | 'stock' | 'maxQty' | 'minDays' | 'maxDays'>, qty: number, days: number): 'min' | 'max' | 'notFree' | 'days' | null {
  if (!qty) return null;
  if (qty < item.minQty) return 'min';
  if (item.maxQty !== null && qty > item.maxQty) return 'max';
  if (item.available !== null && qty > item.available) return 'notFree';
  if (days < item.minDays || (item.maxDays !== null && days > item.maxDays)) return 'days';
  return null;
}

/** Cart lines to send: only items with a quantity. */
export const cartLines = (cart: Cart) => Object.entries(cart).filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty }));

/** A fresh key per checkout, so a retried tap never makes a second booking. */
export const newIdempotencyKey = () => `rent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
