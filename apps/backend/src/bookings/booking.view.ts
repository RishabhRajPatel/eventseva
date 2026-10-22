import type { BookingStatus } from '@eventseva/core';
import { Queryable } from '../db/db.service';

/** Phone numbers are shared only once the advance is paid (design: "visible after confirmation"). */
const SHARES_PHONE: BookingStatus[] = ['confirmed', 'completed'];

const SELECT = `
  SELECT b.id, b.status, b.day, b.slot, b.quantity, b.details, b.amount_paise, b.advance_paise, b.commission_paise,
         b.refund_paise, b.discount_paise, b.payout_deduction_paise, b.respond_by, b.pay_by, b.cancel_reason, b.created_at,
         e.id AS event_id, e.title AS event_title, e.event_type, e.guest_count, e.venue_address,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(r: any, viewer: 'customer' | 'vendor') {
  const share = SHARES_PHONE.includes(r.status);
  // A deleted account keeps its bookings, but not its phone number.
  const phone = (p: string) => (share && !p.startsWith('deleted:') ? p : null);
  return {
    id: r.id,
    status: r.status,
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
      // The customer always sees their own venue; the vendor only once the booking is paid.
      venueAddress: viewer === 'customer' || share ? r.venue_address : null,
    },
    conversationId: r.conversation_id,
    amountPaise: r.amount_paise,
    advancePaise: r.advance_paise,
    balancePaise: r.amount_paise - r.advance_paise,
    refundPaise: r.refund_paise,
    // Coupon discount, paid by EventSeva: lowers what is paid in the app, never the vendor's share.
    discountPaise: r.discount_paise,
    couponCode: viewer === 'customer' ? r.coupon_code : null,
    payNowPaise: r.advance_paise - r.discount_paise,
    // The vendor sees what reaches their bank; the customer never sees EventSeva's commission.
    ...(viewer === 'vendor' ? {
          commissionPaise: r.commission_paise,
          payoutDeductionPaise: r.payout_deduction_paise,
          payoutPaise: r.advance_paise - r.commission_paise - r.payout_deduction_paise,
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
