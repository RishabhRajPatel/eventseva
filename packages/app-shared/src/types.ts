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
  category: { slug: string; name: string; icon: string };
  ratingAvg: number;
  ratingCount: number;
  isFeatured: boolean;
  startingPricePaise: number | null;
  cover: MediaRef | null;
  /** Only when the search had the venue's lat/lng: estimated road km (nearest 0.5), or null. */
  distanceKm?: number | null;
  serviceRadiusKm?: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Estimated trip from the vendor to the venue. */
export interface Travel {
  roadKm: number;
  minutes: number;
  serviceRadiusKm: number | null;
  outsideServiceArea: boolean;
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
  category: { id: number; slug: string; name: string; icon: string };
  city: { id: number; name: string };
  area: string | null;
  /** null for the public. */
  address: string | null;
  /** null for the public (customers only see distances). */
  location: LatLng | null;
  /** How far the vendor usually travels, in km. */
  serviceRadiusKm: number | null;
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
  /** Owner and admin views: end of the current featured period, or null. */
  featuredUntil?: string | null;
}

/** GET /v1/partner/vendor */
export interface OwnVendor extends VendorDetail {
  status: VendorStatus;
  missingForReview: Array<'area' | 'about' | 'services_or_packages' | 'photos'>;
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

// ---- uploads (Cloudinary signed upload) ----

export type UploadKind = 'photo' | 'video' | 'document';

/** POST /v1/partner/uploads/sign — send `params` exactly as given, plus file, api_key and signature. */
export interface UploadSignature {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  params: Record<string, string | number>;
  signature: string;
  maxBytes: number;
}

/** The parts of Cloudinary's upload response the API needs. */
export interface CloudinaryUploadResult {
  public_id: string;
  version: number;
  signature: string;
  width?: number;
  height?: number;
  bytes: number;
  etag: string;
  format: string;
  duration?: number;
}

export type DocType = 'aadhaar' | 'pan' | 'gst' | 'shop_photo';

export interface VendorDocument {
  id: string;
  docType: DocType;
  last4: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason: string | null;
  createdAt: string;
  /** Admin (verifier) only: a link that works for 10 minutes. */
  viewUrl?: string | null;
}

// ---- events & bookings ----

export interface EventSummary {
  id: string;
  title: string;
  eventType: EventType;
  eventDate: string;
  cityId: number;
  venueAddress: string | null;
  venueLandmark: string | null;
  venueLocation: LatLng | null;
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
  event: {
    id: string;
    title: string;
    eventType: EventType;
    guestCount: number | null;
    /** Partner app: null until the booking is confirmed (same for the landmark and the pin). */
    venueAddress: string | null;
    venueLandmark: string | null;
    venueLocation: LatLng | null;
  };
  /** Estimated trip from the vendor to the venue; null until both pins are known. */
  travel: Travel | null;
  /** Partner app, once paid: Google Maps directions to the venue. */
  directionsUrl: string | null;
  /** 'HH:MM' India time the vendor should arrive by. */
  arriveBy: string | null;
  /** Event-day updates from the vendor. */
  progress: { status: 'on_the_way' | 'reached'; at: string; etaAt: string | null } | null;
  /** Chat between this customer and vendor, if one exists. */
  conversationId: string | null;
  amountPaise: number;
  advancePaise: number;
  balancePaise: number;
  refundPaise: number;
  /** Coupon discount (paid by EventSeva): lowers what is paid in the app. */
  discountPaise: number;
  /** Customer app only: the applied coupon code, or null. */
  couponCode: string | null;
  /** What the customer pays in the app now: advancePaise − discountPaise. */
  payNowPaise: number;
  /** Partner app only. */
  commissionPaise?: number;
  /** Partner app only: taken off the payout by an admin refund. */
  payoutDeductionPaise?: number;
  payoutPaise?: number;
  respondBy: string | null;
  payBy: string | null;
  cancelReason: string | null;
  /** phone is null until the advance is paid. */
  vendor: { id: string; businessName: string; categorySlug: string; categoryIcon: string; phone: string | null };
  /** Whether the customer already reviewed this (completed) booking. */
  reviewed: boolean;
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
  lastKind: 'text' | 'booking' | null;
  lastData: BookingEventData | null;
  unreadCount: number;
  hasBooking: boolean;
}

export type BookingEventName =
  | 'requested'
  | 'accepted'
  | 'confirmed'
  | 'rejected'
  | 'cancelled_by_customer'
  | 'cancelled_by_vendor'
  | 'expired'
  | 'on_the_way'
  | 'reached'
  | 'venue_updated';

/** `data` of a `kind: 'booking'` chat line. */
export interface BookingEventData {
  event: BookingEventName;
  bookingId: string;
  item?: string;
  day?: string;
  slot?: Slot;
  reason?: string;
  refundPaise?: number;
  minutes?: number | null;
  etaAt?: string | null;
  payBy?: string;
  why?: 'no_reply' | 'not_paid';
}

export interface Message {
  id: number;
  /** null for system lines (e.g. an expiry). */
  senderId: string | null;
  body: string;
  /** 'booking' = an automatic booking update; show it centred, translated from `data`. */
  kind: 'text' | 'booking';
  data: BookingEventData | null;
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

// ---- vendor bank account (payouts) ----

/** GET/PUT /v1/partner/bank-account → { account }. Only the last 4 digits ever come back. */
export interface BankAccount {
  holderName: string;
  accountLast4: string;
  ifsc: string;
  upiId: string | null;
  status: 'pending' | 'verified' | 'rejected';
  rejectReason: string | null;
  updatedAt: string;
}

// ---- offers and coupons ----

/** GET /v1/offers: public coupons for the home banner and the payment screen. */
export interface Offer {
  code: string;
  title: string;
  /** "10% off, up to ₹500", in the request language. */
  summary: string;
  discountType: 'percent' | 'flat';
  /** Percent, or paise for flat. */
  discountValue: number;
  maxDiscountPaise: number | null;
  minAmountPaise: number;
  firstBookingOnly: boolean;
  validUntil: string | null;
  category: { slug: string; icon: string; name: string } | null;
}

// ---- featured listings (Partner app) ----

export interface FeaturedPlan {
  id: number;
  name: string;
  days: number;
  pricePaise: number;
}

export interface FeaturedPurchase {
  id: string;
  days: number;
  amountPaise: number;
  /** 'granted' = free days from EventSeva. */
  status: 'paid' | 'granted';
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

/** GET /v1/partner/featured */
export interface FeaturedOverview {
  /** null when not featured right now. */
  featuredUntil: string | null;
  /** Only live (approved) vendors can buy. */
  canBuy: boolean;
  plans: FeaturedPlan[];
  history: FeaturedPurchase[];
}

/** POST /v1/partner/featured/plans/:planId/order */
export interface FeaturedOrder extends PaymentOrder {
  purchaseId: string;
}

// ---- errors ----

/** Every API error: { error: { code, message, ...details } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; [detail: string]: unknown };
}
