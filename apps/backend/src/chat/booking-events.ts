import { Queryable } from '../db/db.service';

/** Booking updates that appear in the chat between the customer and the vendor. */
export type BookingEvent =
  | 'requested'
  | 'accepted'
  | 'confirmed'
  | 'rejected'
  | 'cancelled_by_customer'
  | 'cancelled_by_vendor'
  | 'expired'
  | 'on_the_way'
  | 'reached'
  | 'venue_updated'
  | 'dispatched'
  | 'delivered'
  | 'returned'
  | 'return_verified';

/** English fallback; the apps show their own translated line from `data.event`. */
const FALLBACK: Record<BookingEvent, string> = {
  requested: 'Booking requested',
  accepted: 'Vendor accepted. Waiting for the advance.',
  confirmed: 'Booking confirmed',
  rejected: 'Vendor is not available',
  cancelled_by_customer: 'Customer cancelled the booking',
  cancelled_by_vendor: 'Vendor cancelled the booking',
  expired: 'Booking expired',
  on_the_way: 'Vendor is on the way',
  reached: 'Vendor has reached the venue',
  venue_updated: 'Venue details updated',
  dispatched: 'Items are on the way',
  delivered: 'Items delivered at the venue',
  returned: 'Items picked up; return counted',
  return_verified: 'Return checked. Deposit being settled.',
};

/**
 * Adds a booking update to the pair's chat (creating the chat if needed), so the whole story of a
 * booking is in one place. It is not pushed separately: every update already sends its own
 * notification. `actorId` is who caused it (null for the system, e.g. an expiry).
 */
export async function postBookingEvent(
  q: Queryable,
  b: { id: string; customer_id: string; vendor_id: string },
  event: BookingEvent,
  actorId: string | null,
  data: Record<string, unknown> = {},
) {
  const conv = await q.query<{ id: string }>(
    `INSERT INTO conversations (customer_id, vendor_id, last_message_at) VALUES ($1, $2, now())
     ON CONFLICT (customer_id, vendor_id) DO UPDATE SET last_message_at = now() RETURNING id`,
    [b.customer_id, b.vendor_id],
  );
  await q.query(`INSERT INTO messages (conversation_id, sender_id, body, kind, data) VALUES ($1, $2, $3, 'booking', $4)`, [
    conv.rows[0].id,
    actorId,
    FALLBACK[event],
    { event, bookingId: b.id, ...data },
  ]);
}
