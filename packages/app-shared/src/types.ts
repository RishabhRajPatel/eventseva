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
  /** Items on rent (tent, furniture, utensils …): when > 0 the vendor page offers "Rent items". */
  rentalItemCount: number;
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

/** slot: the classic day + slot booking; the rest come from the booking engine with exact times. */
export type BookingType = 'slot' | 'time_window' | 'rental' | 'per_person' | 'staffing' | 'appointment' | 'transport' | 'quote';

/**
 * Where a booking is, for the status chip. Rentals add their delivery steps:
 * pending_confirmation → awaiting_payment → confirmed → preparing → dispatched → delivered →
 * return_pending → returned_verified → completed.
 */
export type BookingStage =
  | 'pending_confirmation'
  | 'awaiting_payment'
  | 'confirmed'
  | 'preparing'
  | 'assigned'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'in_progress'
  | 'return_pending'
  | 'returned_verified'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface Booking {
  id: string;
  status: BookingStatus;
  bookingType: BookingType;
  stage: BookingStage;
  /** Engine bookings: exact start and end (ISO); null for slot bookings. */
  startsAt: string | null;
  endsAt: string | null;
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
  taxPaise: number;
  /** Refundable security deposit (rentals, self-drive), paid apart from the price. */
  depositPaise: number;
  depositSettledAt: string | null;
  /** Engine bookings: the customer's answers (menu, occasion, requirements …). */
  answers?: Record<string, unknown> | null;
  /** Extras asked for; ones needing approval wait for the vendor's answer when accepting. */
  addons?: { addonId: string; name: string; pricePaise: number; status: 'included' | 'pending_approval' | 'approved' | 'declined'; note: string | null }[];
  /** Car bookings, once the vendor may see the venue. */
  route?: { pickup: { address: string }; destination: { address: string } } | null;
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
  | 'venue_updated'
  | 'dispatched'
  | 'delivered'
  | 'returned'
  | 'return_verified';

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

// ---- rentals: vendor stock, customer catalogue, delivery and return ----

export type ItemQuality = 'basic' | 'standard' | 'premium' | 'custom';
export type ItemCondition = 'new' | 'good' | 'used' | 'needs_repair';
export type RentPer = 'booking' | 'day';

export interface ItemCategory {
  id: string;
  /** Default categories have a key (tent_decor, furniture, cooking, dining, serving, equipment); the vendor's own have null. */
  key: string | null;
  nameEn: string;
  nameHi: string;
  examplesEn?: string | null;
  examplesHi?: string | null;
  isCustom: boolean;
  itemCount: number;
}

export interface ItemPhoto {
  id: string;
  publicId: string;
  width: number;
  height: number;
  blurhash: string | null;
  status: 'pending' | 'approved' | 'rejected';
}

/** A rental item as its vendor sees it (GET /v1/partner/inventory). */
export interface InventoryItem {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryNameHi: string | null;
  /** piece, set, pair, dozen or the vendor's own word. */
  unit: string;
  rentPaise: number;
  rentPer: RentPer;
  totalQty: number;
  /** Out of use: damaged, in repair or cleaning. */
  repairQty: number;
  depositPaise: number;
  damagePaise: number;
  missingPaise: number;
  minQty: number;
  maxQty: number | null;
  minDays: number;
  maxDays: number | null;
  quality: ItemQuality;
  qualityLabel: string | null;
  condition: ItemCondition;
  attributes: Record<string, string | number | boolean>;
  isActive: boolean;
  updatedAt: string;
  photos: ItemPhoto[];
  /** List only: free right now (not held by bookings, not out at events, not in repair). */
  availableNow?: number;
  /** List only: open bookings that include this item. */
  openBookings?: number;
}

export interface InventoryInput {
  name?: string;
  description?: string | null;
  categoryId?: string;
  unit?: string;
  rentPaise?: number;
  rentPer?: RentPer;
  totalQty?: number;
  repairQty?: number;
  depositPaise?: number;
  damagePaise?: number;
  missingPaise?: number;
  minQty?: number;
  maxQty?: number | null;
  minDays?: number;
  maxDays?: number | null;
  quality?: ItemQuality;
  qualityLabel?: string | null;
  condition?: ItemCondition;
  isActive?: boolean;
}

export interface StockMovement {
  id: string;
  kind: 'dispatch' | 'return' | 'damaged' | 'missing' | 'repaired' | 'written_off' | 'added' | 'removed';
  qty: number;
  note: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface StockBlock {
  id: string;
  qty: number;
  from: string;
  until: string;
  note: string;
}

export interface RentalSettings {
  serviceId: string | null;
  deliveryFeePaise: number;
  travelFreeKm: number | null;
  travelPerKmPaise: number | null;
  minOrderPaise: number | null;
  taxPercent: number;
  leadTimeHours: number | null;
  setupMin: number;
  dismantleMin: number;
  bufferAfterMin: number;
  approval: 'vendor' | 'auto';
  instructions: string | null;
}

/** GET /v1/vendors/:id/rentals: what a customer can rent. */
export interface RentalCatalogue {
  serviceId: string | null;
  settings: Pick<RentalSettings, 'deliveryFeePaise' | 'travelFreeKm' | 'travelPerKmPaise' | 'minOrderPaise' | 'taxPercent' | 'leadTimeHours' | 'approval' | 'instructions'>;
  categories: { id: string; nameEn: string; nameHi: string; itemCount: number }[];
  items: Array<Omit<InventoryItem, 'repairQty' | 'totalQty' | 'availableNow' | 'openBookings'> & { stock: number; available: number | null }>;
}

export interface QuoteLine {
  code: string;
  label: string;
  qty: number;
  unitPaise: number;
  amountPaise: number;
  kind: 'base' | 'extra' | 'addon' | 'fee' | 'tax' | 'deposit';
}

/** POST /v1/quotes */
export interface Quote {
  lines: QuoteLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  depositPaise: number;
  priceKind: 'confirmed' | 'indicative';
  startsAt: string;
  endsAt: string;
  returnDueAt: string | null;
  approval: 'vendor' | 'auto';
  cancellation: { customer: { minDays: number; percent: number }[]; vendorPercent: number };
  notes: string[];
}

export interface RentalLine {
  id: string;
  itemId: string;
  /** Name, unit, quality and prices as booked; listing edits never change it. */
  item: { name: string; unit: string; category: string | null; quality: ItemQuality; qualityLabel: string | null; condition: ItemCondition; rentPaise: number; rentPer: RentPer };
  qty: number;
  unitPaise: number;
  amountPaise: number;
  depositPaise: number;
  damagePaise: number;
  missingPaise: number;
  loadedQty: number;
  dispatchedQty: number;
  deliveredQty: number;
  returnedQty: number;
  damagedQty: number;
  missingQty: number;
  note: string | null;
  verifiedAt: string | null;
}

export interface RentalCharge {
  id: string;
  kind: 'damage' | 'missing' | string;
  description: string;
  amountPaise: number;
  status: 'proposed' | 'accepted' | 'disputed' | 'waived' | 'resolved';
  fromDeposit: boolean;
  decisionNote: string | null;
  createdAt: string;
  /** Unanswered charges count as accepted after this. */
  replyBy: string;
}

/** GET /v1/bookings/:id/rental and /v1/partner/bookings/:id/rental */
export interface RentalView {
  fulfilment: 'scheduled' | 'preparing' | 'dispatched' | 'delivered' | 'return_pending' | 'closed';
  startsAt: string;
  endsAt: string;
  returnDueAt: string | null;
  lines: RentalLine[];
  steps: { phase: 'dispatch' | 'delivery' | 'return'; notes: string | null; photoIds: string[]; recordedAt: string }[];
  charges: RentalCharge[];
  deposit: { requiredPaise: number; paidPaise: number; keptPaise: number; settledAt: string | null };
  balancePaidPaise: number;
  /** Agreed charges the online deposit did not cover: settled directly with the vendor. */
  dueToVendorPaise: number;
}

// ---- booking engine: vendor services, resources, extras, trips, changes, checkout ----

export type Bilingual = { en: string; hi: string };
export type PricingModel = 'fixed' | 'hourly' | 'daily' | 'per_unit' | 'per_person' | 'per_trip' | 'quote';

/** A field a vendor fills (attributes) or a customer answers (questions). */
export interface FieldDef {
  key: string;
  label: Bilingual;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect';
  required?: boolean;
  options?: { value: string; label: Bilingual; pricePaise?: number; perPerson?: boolean }[];
  min?: number;
  max?: number;
  unit?: string;
  maxLength?: number;
}

export interface EnginePricing {
  model: PricingModel;
  ratePaise: number;
  minChargePaise?: number;
  includedHours?: number;
  includedKm?: number;
  overtimeHourPaise?: number;
  extraKmPaise?: number;
  driverDayPaise?: number;
  dayRatePaise?: number;
  travelFreeKm?: number;
  travelPerKmPaise?: number;
  earlyMorningPaise?: number;
  taxPercent?: 0 | 5 | 12 | 18 | 28;
}

/** Rules a vendor may set on a service (the category sets the rest). */
export interface EngineRules {
  minDurationMin?: number;
  maxDurationMin?: number;
  minQty?: number;
  maxQty?: number;
  workingHours?: { from: string; to: string };
  leadTimeHours?: number;
  setupMin?: number;
  dismantleMin?: number;
  bufferAfterMin?: number;
  approval?: 'vendor' | 'auto';
  capacity?: number;
  perPersonMin?: number;
  minAge?: number;
  instructions?: string;
  deposit?: { fixedPaise?: number; percent?: number };
}

export type ResourceKind = 'vehicle' | 'driver' | 'staff' | 'artist' | 'venue' | 'equipment';

/** GET /v1/partner/service-setup */
export interface ServiceSetup {
  bookingType: BookingType;
  pricingModels: PricingModel[];
  attributes: FieldDef[];
  questions: FieldDef[];
  resourceKind: ResourceKind | 'crew' | null;
  staffKind: string | null;
  defaultRules: EngineRules;
  vendorRuleKeys: (keyof EngineRules)[];
  resourceFields: Record<ResourceKind, FieldDef[]>;
}

/** A vendor's own service booked by time / quantity (GET /v1/partner/engine-services). */
export interface EngineService {
  id: string;
  title: string;
  description: string | null;
  bookingType: BookingType;
  pricing: EnginePricing;
  rules: EngineRules;
  attributes: Record<string, unknown>;
  resourceId: string | null;
  minGuests: number | null;
  maxGuests: number | null;
  isActive: boolean;
}

export interface VendorResource {
  id: string;
  kind: ResourceKind;
  name: string;
  attributes: Record<string, unknown>;
  status: 'active' | 'maintenance' | 'inactive';
  verification: 'not_required' | 'pending' | 'approved' | 'rejected' | 'suspended';
  rejectReason: string | null;
  documents: { id: string; docType: string; status: string; rejectReason: string | null }[];
}

export interface ServiceAddon {
  id: string;
  serviceId: string | null;
  name: string;
  kind: string;
  inclusions: string[];
  exclusions: string[];
  pricePaise: number;
  setupMinutes: number;
  requiresApproval: boolean;
  isActive: boolean;
}

export interface ServiceBundle {
  id: string;
  name: string;
  description: string | null;
  discountPercent: number;
  items: { serviceId: string; mandatory: boolean }[];
  isActive: boolean;
}

/** GET /v1/vendors/:id/engine-services: what a customer books from. */
export interface PublicEngineService {
  id: string;
  title: string;
  description: string | null;
  bookingType: BookingType;
  pricing: EnginePricing;
  attributes: Record<string, unknown>;
  minGuests: number | null;
  maxGuests: number | null;
  rules: {
    minDurationMin: number | null;
    maxDurationMin: number | null;
    minQty: number | null;
    maxQty: number | null;
    workingHours: { from: string; to: string } | null;
    leadTimeHours: number | null;
    perPersonMin: number | null;
    minAge: number | null;
    approval: 'vendor' | 'auto';
    requiredDocuments: string[];
    instructions: string | null;
  };
  questions: FieldDef[];
  resource: { id: string; kind: string; name: string; bookable: boolean; attributes: Record<string, unknown> & { registrationMasked?: string | null }; photos: MediaRef[] } | null;
  addons: ServiceAddon[];
}

export interface Place {
  address: string;
  lat: number;
  lng: number;
}

/** POST /v1/quotes and /v1/engine-bookings for every engine type. */
export interface EngineBookingRequest {
  eventId: string;
  serviceId: string;
  startsAt: string;
  endsAt?: string;
  quantity?: number;
  guestCount?: number;
  people?: number;
  lines?: { itemId: string; qty: number }[];
  addons?: { addonId: string; note?: string }[];
  answers?: Record<string, unknown>;
  route?: { pickup: Place; destination: Place; stops?: Place[] };
  mode?: 'with_driver' | 'self_drive';
  note?: string;
}

export interface TripInspection {
  phase: 'handover' | 'return';
  readings: { odometerKm: number; fuelEighths: number; km?: number };
  notes: string | null;
  photoIds: string[];
  recordedAt: string;
  customerAck: 'agreed' | 'disputed' | null;
  customerNote: string | null;
}

/** GET /v1/bookings/:id/trip and /v1/partner/bookings/:id/trip */
export interface TripView {
  fulfilment: 'scheduled' | 'assigned' | 'in_progress' | 'closed';
  mode: 'with_driver' | 'self_drive';
  startsAt: string;
  endsAt: string;
  vehicle: { name: string; registration: string | null } | null;
  driver: { id: string; name: string } | null;
  route: { pickup: Place; destination: Place } | null;
  inspections: TripInspection[];
  charges: RentalCharge[];
  deposit: { requiredPaise: number; paidPaise: number; keptPaise: number; settledAt: string | null };
  balancePaidPaise: number;
}

export interface BookingChange {
  id: string;
  kind: 'reschedule' | 'extension';
  startsAt: string;
  endsAt: string;
  priceDiffPaise: number;
  status: 'requested' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface DriverLicence {
  last4: string;
  dateOfBirth: string;
  expiresOn: string;
  status: 'pending' | 'verified' | 'rejected';
  rejectReason: string | null;
}

/** POST /v1/checkouts */
export interface CheckoutResult {
  id: string;
  eventId: string;
  createdAt: string;
  bookings: { id: string; status: BookingStatus; vendorId: string; businessName: string; title: string | null; amountPaise: number; advancePaise: number; depositPaise: number; startsAt: string; endsAt: string }[];
}
