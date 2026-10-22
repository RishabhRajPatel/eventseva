import type { Booking, BookingStatus } from '@eventseva/app-shared';

/** A booking as the partner API returns it, with overrides. */
export function booking(id: string, status: BookingStatus, extra: Partial<Booking> = {}): Booking {
  return {
    id,
    status,
    day: '2026-12-01',
    slot: 'night',
    item: { type: 'service', id: 's1', title: 'DJ night', unit: 'per_event' },
    quantity: 1,
    note: null,
    event: { id: 'e1', title: `Event ${id}`, eventType: 'wedding', guestCount: null, venueAddress: null },
    conversationId: null,
    amountPaise: 1_000_000,
    advancePaise: 250_000,
    balancePaise: 750_000,
    refundPaise: 0,
    commissionPaise: 100_000,
    payoutPaise: 150_000,
    respondBy: null,
    payBy: null,
    cancelReason: null,
    vendor: { id: 'v1', businessName: 'Raj DJ', phone: null },
    customer: { name: 'Rahul', phone: null },
    createdAt: '2026-11-09T06:00:00Z',
    ...extra,
  };
}
