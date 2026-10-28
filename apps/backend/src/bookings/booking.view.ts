import type { BookingStatus } from '@eventseva/core';
import { Queryable } from '../db/db.service';
import { pointOf, travelBetween } from './travel';

/** Phone numbers are shared only once the advance is paid (design: "visible after confirmation"). */
const SHARES_PHONE: BookingStatus[] = ['confirmed', 'completed'];

const SELECT = `
  SELECT b.id, b.status, b.state, b.pay_mode, b.group_id, b.day, b.slot, b.quantity, b.details, b.amount_paise, b.advance_paise, b.commission_paise,
         b.refund_paise, b.discount_paise, b.payout_deduction_paise, b.respond_by, b.pay_by, b.cancel_reason, b.created_at,
         b.progress, b.progress_at, b.eta_at, b.booking_type, b.starts_at, b.ends_at, b.fulfilment, b.deposit_paise, b.tax_paise,
         b.charges_paise, b.deposit_settled_at, b.snapshot->'answers' AS answers, b.snapshot->'route' AS route,
         COALESCE(b.snapshot->'questions'->'fields', cat.template->'questions') AS questions, b.snapshot->'plan' AS plan,
         (SELECT json_agg(json_build_object('addonId', ba.addon_id, 'name', a.name, 'pricePaise', ba.price_paise, 'status', ba.status, 'note', ba.request_note)
                          ORDER BY a.name)
            FROM booking_addons ba JOIN service_addons a ON a.id = ba.addon_id WHERE ba.booking_id = b.id) AS addons,
         e.id AS event_id, e.title AS event_title, e.event_type, e.guest_count, e.venue_address,
         e.venue_lat, e.venue_lng, e.venue_landmark, v.lat AS vendor_lat, v.lng AS vendor_lng, v.service_radius_km,
         (SELECT cp.code FROM coupon_redemptions r JOIN coupons cp ON cp.id = r.coupon_id
           WHERE r.booking_id = b.id AND r.status <> 'released') AS coupon_code,
         (SELECT c.id FROM conversations c WHERE c.customer_id = b.customer_id AND c.vendor_id = b.vendor_id) AS conversation_id,
         v.id AS vendor_id, v.business_name, vu.phone AS vendor_phone, cat.slug AS category_slug, cat.icon AS category_icon,
         EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS reviewed,
         cu.name AS customer_name, cu.phone AS customer_phone,
         COALESCE(s.title, p.title) AS item_title, CASE WHEN s.id IS NULL THEN 'package' ELSE 'service' END AS item_type,
         COALESCE(s.id, p.id) AS item_id, COALESCE(s.unit::text, 'package') AS unit
    FROM bookings b
    JOIN events e ON e.id = b.event_id
    JOIN vendors v ON v.id = b.vendor_id
    JOIN categories cat ON cat.id = v.category_id
    JOIN users vu ON vu.id = v.user_id
    JOIN users cu ON cu.id = b.customer_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN packages p ON p.id = b.package_id`;

type Bilingual = { en: string; hi: string };

/** Labels only (key, question and option names), from the category template. */
function questionLabels(raw: unknown): { key: string; label: Bilingual; options?: { value: string; label: Bilingual }[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is { key: string; label: Bilingual; options?: { value: string; label: Bilingual }[] } => !!q && typeof q.key === 'string' && !!q.label)
    .map((q) => ({ key: q.key, label: q.label, ...(q.options?.length ? { options: q.options.map((o) => ({ value: o.value, label: o.label })) } : {}) }));
}

/**
 * One word for where a booking is, for the apps' status chip. Rentals go through their delivery steps:
 * pending_confirmation → awaiting_payment → confirmed → preparing → dispatched → delivered →
 * return_pending (event over) → returned_verified → completed; or cancelled / rejected / expired.
 */
export function stageOf(status: BookingStatus, fulfilment: string | null): string {
  if (status === 'requested') return 'pending_confirmation';
  if (status === 'accepted') return 'awaiting_payment';
  if (status === 'confirmed') {
    if (fulfilment === 'closed') return 'returned_verified';
    if (fulfilment && fulfilment !== 'scheduled') return fulfilment;
    return 'confirmed';
  }
  if (status === 'cancelled_by_customer' || status === 'cancelled_by_vendor') return 'cancelled';
  return status;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(r: any, viewer: 'customer' | 'vendor') {
  const share = SHARES_PHONE.includes(r.status);
  // A deleted account keeps its bookings, but not its phone number.
  const phone = (p: string) => (share && !p.startsWith('deleted:') ? p : null);
  // The customer always sees their own venue; the vendor only once the booking is paid.
  const showVenue = viewer === 'customer' || share;
  const venue = pointOf(r.venue_lat, r.venue_lng);
  return {
    id: r.id,
    status: r.status,
    /** Lifecycle state from the database state machine (pending_vendor … completed, disputed). */
    state: r.state,
    /** online, or cash: the whole booking is paid to the vendor in person. */
    payMode: r.pay_mode,
    /** The cart checkout this booking was made in (accepted bookings of one checkout can be paid together). */
    checkoutId: viewer === 'customer' ? (r.group_id ?? null) : null,
    /** slot (day + slot) or a booking-engine type (rental, transport …); engine bookings have exact times. */
    bookingType: r.booking_type,
    stage: stageOf(r.status, r.booking_type === 'slot' ? null : r.fulfilment),
    startsAt: r.booking_type === 'slot' ? null : r.starts_at,
    endsAt: r.booking_type === 'slot' ? null : r.ends_at,
    day: r.day,
    slot: r.slot,
    item: { type: r.item_type, id: r.item_id, title: r.item_title, unit: r.unit },
    quantity: r.quantity,
    note: r.details?.note ?? null,
    event: {
      id: r.event_id,
      title: r.event_title,
      eventType: r.event_type,
      guestCount: r.guest_count,
      venueAddress: showVenue ? r.venue_address : null,
      venueLandmark: showVenue ? r.venue_landmark : null,
      venueLocation: showVenue ? venue : null,
    },
    /** Estimated trip from the vendor to the venue (both sides see it; neither pin is revealed by it). */
    travel: travelBetween(pointOf(r.vendor_lat, r.vendor_lng), venue, r.service_radius_km),
    /** Vendor app, once the venue is shared: opens Google Maps with directions from where the phone is. */
    directionsUrl:
      viewer === 'vendor' && share && (venue || r.venue_address)
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue ? `${venue.lat},${venue.lng}` : r.venue_address)}`
        : null,
    /** 'HH:MM' India time the customer asked the vendor to arrive by. */
    arriveBy: r.details?.arriveBy ?? null,
    /** Event-day updates from the vendor. */
    progress: r.progress ? { status: r.progress, at: r.progress_at, etaAt: r.eta_at } : null,
    conversationId: r.conversation_id,
    amountPaise: r.amount_paise,
    advancePaise: r.advance_paise,
    balancePaise: r.amount_paise - r.advance_paise,
    refundPaise: r.refund_paise,
    taxPaise: r.tax_paise,
    /** Refundable security deposit (rentals, self-drive cars), paid apart from the price. */
    depositPaise: r.deposit_paise,
    depositSettledAt: r.deposit_settled_at,
    /** Engine bookings: what the customer answered (menu, occasion, needs …), extras asked for, and the trip route. */
    answers: r.answers ?? null,
    /** The category's questions, so the apps show the customer's answers with their labels (both languages). */
    questions: r.answers ? questionLabels(r.questions) : [],
    /** The rate plan booked (name in both languages), when the service had several. */
    plan: r.plan ?? null,
    addons: r.addons ?? [],
    route: showVenue ? (r.route ?? null) : null,
    // Coupon discount, paid by EventSeva: lowers what is paid in the app, never the vendor's share.
    discountPaise: r.discount_paise,
    couponCode: viewer === 'customer' ? r.coupon_code : null,
    payNowPaise: r.advance_paise - r.discount_paise,
    // The vendor sees what reaches their bank; the customer never sees EventSeva's commission.
    ...(viewer === 'vendor' ? {
          commissionPaise: r.commission_paise,
          payoutDeductionPaise: r.payout_deduction_paise,
          payoutPaise: r.advance_paise + r.charges_paise - r.commission_paise - r.payout_deduction_paise,
        } : {}),
    respondBy: r.status === 'requested' ? r.respond_by : null,
    payBy: r.status === 'accepted' ? r.pay_by : null,
    cancelReason: r.cancel_reason,
    vendor: {
      id: r.vendor_id,
      businessName: r.business_name,
      categorySlug: r.category_slug,
      categoryIcon: r.category_icon,
      phone: viewer === 'customer' ? phone(r.vendor_phone) : null,
    },
    /** Completed bookings: whether the customer has already written a review. */
    reviewed: r.reviewed,
    customer: viewer === 'vendor' ? { name: r.customer_name, phone: phone(r.customer_phone) } : undefined,
    createdAt: r.created_at,
  };
}

export type BookingView = ReturnType<typeof toView>;

export async function loadBookings(
  q: Queryable,
  viewer: 'customer' | 'vendor',
  where: { customerId?: string; vendorUserId?: string; bookingId?: string; eventId?: string; status?: string },
): Promise<BookingView[]> {
  const { rows } = await q.query(
    `${SELECT}
      WHERE ($1::uuid IS NULL OR b.customer_id = $1)
        AND ($2::uuid IS NULL OR v.user_id = $2)
        AND ($3::uuid IS NULL OR b.id = $3)
        AND ($4::uuid IS NULL OR b.event_id = $4)
        AND ($5::booking_status IS NULL OR b.status = $5)
      ORDER BY b.day, b.created_at
      LIMIT 200`,
    [where.customerId ?? null, where.vendorUserId ?? null, where.bookingId ?? null, where.eventId ?? null, where.status ?? null],
  );
  return rows.map((r) => toView(r, viewer));
}
