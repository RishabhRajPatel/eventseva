// Response shapes of the EventSeva API (apps/backend). Money is always paise; days are
// 'YYYY-MM-DD' strings (India dates); timestamps are ISO strings.
import type { AppName, BookingStatus, Language, VendorStatus } from '@eventseva/core';

export type { AppName, BookingStatus, Language, VendorStatus };

export type Slot = 'full' | 'day' | 'night';
export type PricingUnit =
  | 'per_event'
  | 'per_day'
  | 'per_shift'
  | 'per_plate'
  | 'per_hour'
  | 'per_km'
  | 'per_room_night'
  | 'per_person'
  | 'package';
export type EventType =
  | 'wedding'
  | 'engagement'
  | 'haldi'
  | 'mehendi'
  | 'birthday'
  | 'anniversary'
  | 'puja'
  | 'griha_pravesh'
  | 'naamkaran'
  | 'corporate'
  | 'party'
  | 'other';

export const SLOTS: Slot[] = ['full', 'day', 'night'];
export const EVENT_TYPES: EventType[] = [
  'wedding', 'engagement', 'haldi', 'mehendi', 'birthday', 'anniversary', 'puja', 'griha_pravesh', 'naamkaran', 'corporate', 'party', 'other',
];
/** Units where the customer enters a count (plates, hours …). */
export const COUNTED_UNITS: PricingUnit[] = ['per_plate', 'per_person', 'per_hour', 'per_day', 'per_km', 'per_room_night'];

export interface Paged<T> {
  items: T[];
  page: number;
  hasMore: boolean;
}

// ---- auth & profile ----

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
}

export interface Me {
  id: string;
  phone: string;
  name: string | null;
  language: Language;
  cityId: number | null;
}

export interface LoginResult extends TokenPair {
  isNewUser: boolean;
  user: Omit<Me, 'cityId'>;
  vendor: { id: string; status: VendorStatus } | null;
}

export interface City {
  id: number;
  name: string;
  state: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  icon: string;
  defaultUnit: PricingUnit;
}

// ---- vendors ----

export interface MediaRef {
  publicId: string;
  width: number;
  height: number;
  blurhash: string | null;
}

export interface Media extends MediaRef {
  id: string;
  type: 'photo' | 'video';
  durationSec: number | null;
  isCover: boolean;
  coverCrop: unknown;
  sortOrder: number;
  /** Owner / admin views only. */
  status?: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
}

export interface VendorCard {
  id: string;
  businessName: string;
  area: string | null;
  category: { slug: string; name: string };
  ratingAvg: number;
  ratingCount: number;
  isFeatured: boolean;
  startingPricePaise: number | null;
  cover: MediaRef | null;
}

export interface Service {
  id: string;
  title: string;
  description: string | null;
  pricePaise: number;
  unit: PricingUnit;
  minGuests: number | null;
  maxGuests: number | null;
  isActive: boolean;
}

export interface Package {
  id: string;
  title: string;
  items: string[];
  pricePaise: number;
  isActive: boolean;
}

export interface VendorDetail {
  id: string;
  businessName: string;
  category: { id: number; slug: string; name: string };
  city: { id: number; name: string };
  area: string | null;
  /** null for the public. */
  address: string | null;
  location: { lat: number; lng: number } | null;
  about: string | null;
  rating: { avg: number; count: number };
  services: Service[];
  packages: Package[];
  media: Media[];
  /** Owner and admin views only. */
  status?: VendorStatus;
  rejectReason?: string | null;
  approvedAt?: string | null;
  createdAt?: string;
}

/** GET /v1/partner/vendor */
export interface OwnVendor extends VendorDetail {
  status: VendorStatus;
  missingForReview: Array<'area' | 'about' | 'services_or_packages'>;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  vendorReply: string | null;
  createdAt: string;
  customerName: string;
  eventType?: EventType;
  day?: string;
}

// ---- events & bookings ----

export interface EventSummary {
  id: string;
  title: string;
  eventType: EventType;
  eventDate: string;
  cityId: number;
  venueAddress: string | null;
  guestCount: number | null;
  budgetPaise: number | null;
  createdAt: string;
  confirmedCount?: number;
  pendingCount?: number;
  committedPaise?: number;
}

export interface Booking {
  id: string;
  status: BookingStatus;
  day: string;
  slot: Slot;
  item: { type: 'service' | 'package'; id: string; title: string; unit: PricingUnit };
  quantity: number;
  note: string | null;
  event: { id: string; title: string; eventType: EventType };
  amountPaise: number;
  advancePaise: number;
  balancePaise: number;
  refundPaise: number;
  /** Partner app only. */
  commissionPaise?: number;
  payoutPaise?: number;
  respondBy: string | null;
  payBy: string | null;
  cancelReason: string | null;
  /** phone is null until the advance is paid. */
  vendor: { id: string; businessName: string; phone: string | null };
  customer?: { name: string | null; phone: string | null };
  createdAt: string;
}

export interface PaymentOrder {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  /** Razorpay public key for the checkout. */
  keyId: string;
}

export interface CalendarEntry {
  day: string;
  slot: Slot;
  status: 'booked' | 'blocked';
  bookingId: string | null;
}

// ---- chat, notifications ----

export interface Conversation {
  id: string;
  lastMessageAt: string | null;
  vendorId: string;
  vendorName: string;
  customerName: string;
  lastMessage: string | null;
  unreadCount: number;
  hasBooking: boolean;
}

export interface Message {
  id: number;
  senderId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  mine: boolean;
}

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: { bookingId?: string; conversationId?: string; vendorId?: string; [k: string]: unknown };
  readAt: string | null;
  createdAt: string;
}

export interface Complaint {
  id: string;
  bookingId: string | null;
  subject: string;
  details: string;
  status: 'open' | 'in_progress' | 'resolved';
  resolution: string | null;
  createdAt: string;
}

// ---- partner home ----

export interface PartnerDashboard {
  month: string;
  status: VendorStatus;
  ratingAvg: number;
  ratingCount: number;
  newRequests: number;
  awaitingPayment: number;
  monthBookings: number;
  monthEarningsPaise: number;
  pendingPayoutPaise: number;
  unreadChats: number;
  upcoming: Array<{ id: string; day: string; slot: Slot; status: BookingStatus; eventTitle: string; itemTitle: string }>;
}

export interface Earnings {
  month: string;
  bookings: number;
  grossPaise: number;
  commissionPaise: number;
  payoutPaise: number;
  /** The rest of the price, which the customer pays the vendor directly after the event. */
  collectAtEventPaise: number;
  payouts: Array<{
    id: string;
    amountPaise: number;
    status: 'scheduled' | 'processing' | 'paid' | 'failed' | 'held';
    releaseAfter: string;
    bookingId: string;
    day: string;
    eventTitle: string;
    eventType: EventType;
  }>;
}

// ---- errors ----

/** Every API error: { error: { code, message, ...details } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; [detail: string]: unknown };
}
