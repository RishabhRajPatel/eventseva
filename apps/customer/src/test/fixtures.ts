import { addDays, todayIst, type Booking, type EventSummary, type VendorDetail } from '@eventseva/app-shared';

export const inDays = (n: number) => addDays(todayIst(), n);

export const vendor: VendorDetail = {
  id: 'v1',
  businessName: 'Shree Ram Caterers',
  category: { id: 3, slug: 'catering', name: 'Cook & Catering', icon: 'catering' },
  city: { id: 1, name: 'Prayagraj' },
  area: 'Civil Lines',
  address: null,
  location: null,
  about: 'Pure veg food for weddings.',
  rating: { avg: 4.6, count: 12 },
  services: [
    { id: 's1', title: 'Veg thali', description: 'Puri, sabzi, raita', pricePaise: 45_000, unit: 'per_plate', minGuests: null, maxGuests: null, isActive: true },
  ],
  packages: [{ id: 'p1', title: 'Haldi lunch', items: ['5 dishes', 'Sweet'], pricePaise: 2_500_000, isActive: true }],
  media: [],
};

export const event: EventSummary = {
  id: 'e1',
  title: "Rahul's Wedding",
  eventType: 'wedding',
  eventDate: inDays(40),
  cityId: 1,
  venueAddress: null,
  guestCount: 300,
  budgetPaise: null,
  createdAt: '2026-10-01T00:00:00Z',
  confirmedCount: 0,
  pendingCount: 0,
  committedPaise: 0,
};

export function booking(over: Partial<Booking> = {}): Booking {
  const advancePaise = over.advancePaise ?? 3_375_000;
  const discountPaise = over.discountPaise ?? 0;
  return {
    id: 'b1',
    status: 'requested',
    day: inDays(40),
    slot: 'night',
    item: { type: 'service', id: 's1', title: 'Veg thali', unit: 'per_plate' },
    quantity: 300,
    note: null,
    event: { id: 'e1', title: "Rahul's Wedding", eventType: 'wedding', guestCount: 300, venueAddress: 'Civil Lines' },
    conversationId: null,
    amountPaise: 13_500_000,
    advancePaise: 3_375_000,
    balancePaise: 10_125_000,
    refundPaise: 0,
    discountPaise: 0,
    couponCode: null,
    payNowPaise: advancePaise - discountPaise,
    respondBy: new Date(Date.now() + 5 * 3600_000 + 20 * 60_000).toISOString(),
    payBy: null,
    cancelReason: null,
    vendor: { id: 'v1', businessName: 'Shree Ram Caterers', categorySlug: 'catering', categoryIcon: 'catering', phone: null },
    reviewed: false,
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}
