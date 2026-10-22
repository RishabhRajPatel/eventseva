import type { Booking, BookingStatus } from '@eventseva/app-shared';

/** The four lists on the Bookings tab. */
export type Segment = 'new' | 'awaitingPayment' | 'upcoming' | 'past';
export const SEGMENTS: Segment[] = ['new', 'awaitingPayment', 'upcoming', 'past'];

export function segmentOf(status: BookingStatus): Segment {
  switch (status) {
    case 'requested':
      return 'new';
    case 'accepted':
      return 'awaitingPayment';
    case 'confirmed':
      return 'upcoming';
    default:
      return 'past';
  }
}

/**
 * Groups bookings for the tabs. A request whose 24 hours are over is already lost, so it
 * moves to Past even before the server's job marks it expired.
 */
export function groupBookings(items: Booking[], now = Date.now()): Record<Segment, Booking[]> {
  const groups: Record<Segment, Booking[]> = { new: [], awaitingPayment: [], upcoming: [], past: [] };
  for (const b of items) {
    let seg = segmentOf(b.status);
    if (seg === 'new' && b.respondBy && new Date(b.respondBy).getTime() <= now) seg = 'past';
    groups[seg].push(b);
  }
  // Most urgent first for requests and payments, nearest event first for upcoming, latest first for past.
  const deadline = (b: Booking) => new Date(b.respondBy ?? b.payBy ?? b.createdAt).getTime();
  groups.new.sort((a, b) => deadline(a) - deadline(b));
  groups.awaitingPayment.sort((a, b) => a.day.localeCompare(b.day));
  groups.upcoming.sort((a, b) => a.day.localeCompare(b.day));
  groups.past.sort((a, b) => b.day.localeCompare(a.day));
  return groups;
}

export interface Remaining {
  hours: number;
  minutes: number;
  /** Under 3 hours: show the countdown in a warning colour. */
  urgent: boolean;
}

/** Time left until a deadline (respondBy / payBy); null once it has passed. */
export function remaining(iso: string | null, now = Date.now()): Remaining | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return { hours, minutes, urgent: ms < 3 * 3_600_000 };
}

/** What the vendor gets from EventSeva: the advance minus the EventSeva fee. */
export function vendorPayout(b: Booking): number {
  return b.payoutPaise ?? b.advancePaise - (b.commissionPaise ?? 0);
}

export const isCancellable = (b: Booking, today: string) => (b.status === 'accepted' || b.status === 'confirmed') && b.day >= today;
