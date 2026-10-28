// The one API client for the app, plus a typed function for every route the customer app uses.
// Screens call `api.*`; tests mock this module.
import {
  createApiClient,
  type AppNotification,
  type Booking,
  type Category,
  type Complaint,
  type Conversation,
  type EventSummary,
  type EventType,
  type LatLng,
  type Travel,
  type Language,
  type Me,
  type Message,
  type Offer,
  type Paged,
  type PaymentOrder,
  type Quote,
  type BookingChange,
  type CheckoutResult,
  type CheckoutView,
  type CheckoutPaymentOrder,
  type CancelPreview,
  type MoneySummary,
  type DriverLicence,
  type EngineBookingRequest,
  type PayMode,
  type CashSummary,
  type Invoice,
  type PublicEngineService,
  type ServiceDay,
  type ServiceBundle,
  type TripView,
  type UploadSignature,
  type RentalCatalogue,
  type RentalView,
  type Review,
  type Slot,
  type VendorCard,
  type VendorDetail,
} from '@eventseva/app-shared';
import i18n from '../i18n';
import { API_URL, CITY } from './config';
import { trackingFetch } from './network';
import { secureTokens } from './tokens';

let sessionEndedHandler: () => void = () => undefined;

/** The session provider registers what to do when the login is gone for good. */
export function onSessionEnded(handler: () => void) {
  sessionEndedHandler = handler;
}

export const client = createApiClient({
  baseUrl: API_URL,
  tokens: secureTokens,
  getLanguage: () => (i18n.language === 'hi' ? 'hi' : 'en'),
  onSessionEnded: () => sessionEndedHandler(),
  // Network failures switch on the offline banner; the next answer from the server switches it off.
  fetchImpl: trackingFetch(),
});

export interface NewEvent {
  title: string;
  eventType: EventType;
  eventDate: string;
  venueAddress?: string;
  venueLandmark?: string;
  venueLat?: number;
  venueLng?: number;
  guestCount?: number;
}

/** PATCH /v1/events/:id: null clears a field. */
export interface EventChanges {
  venueAddress?: string | null;
  venueLandmark?: string | null;
  venueLat?: number | null;
  venueLng?: number | null;
}

export interface BookingRequest {
  eventId: string;
  vendorId: string;
  serviceId?: string;
  packageId?: string;
  slot: Slot;
  quantity?: number;
  note?: string;
  /** 'HH:MM' */
  arriveBy?: string;
  payMode?: PayMode;
}

/** POST /v1/quotes and /v1/engine-bookings: items for dates (rentals). */
export interface RentalRequest {
  eventId: string;
  serviceId: string;
  /** ISO with time zone. */
  startsAt: string;
  endsAt: string;
  lines: { itemId: string; qty: number }[];
  note?: string;
  payMode?: PayMode;
}

export type PayPart = 'advance' | 'balance' | 'deposit';

export interface MessagesPage {
  items: Message[];
  hasMore: boolean;
  phoneShared: boolean;
}

export interface NotificationsPage {
  items: AppNotification[];
  hasMore: boolean;
  unreadCount: number;
}

export type SavedVendor = Omit<VendorCard, 'isFeatured' | 'startingPricePaise'> & { savedAt: string };

export const api = {
  // ---- login ----
  sendOtp: (phone: string) => client.sendOtp(phone),
  verifyOtp: (phone: string, code: string) => client.verifyOtp(phone, code, 'customer'),
  logout: () => client.logout(),
  logoutAll: async () => {
    await client.post('/v1/auth/logout-all').catch(() => undefined);
    await secureTokens.set(null);
  },

  // ---- profile & catalog ----
  me: () => client.get<Me>('/v1/me'),
  updateMe: (body: { name?: string; language?: Language }) => client.patch<Me>('/v1/me', body),
  /** Google Play requires in-app account deletion; the API refuses while bookings are open. */
  deleteAccount: () => client.delete<void>('/v1/me', { confirm: 'DELETE' }),
  categories: () => client.get<{ items: Category[] }>('/v1/categories', undefined, { auth: false }),

  // ---- vendors ----
  vendors: (q: { category?: string; page?: number; limit?: number; lat?: number; lng?: number; sort?: 'nearest' }) =>
    client.get<Paged<VendorCard>>('/v1/vendors', { cityId: CITY.id, ...q }, { auth: false }),
  vendor: (id: string) => client.get<VendorDetail>(`/v1/vendors/${id}`, undefined, { auth: false }),
  vendorTravel: (id: string, p: LatLng) => client.get<{ travel: Travel | null }>(`/v1/vendors/${id}/travel`, { lat: p.lat, lng: p.lng }, { auth: false }),
  reviews: (id: string, page = 1) => client.get<Paged<Review>>(`/v1/vendors/${id}/reviews`, { page }, { auth: false }),
  availability: (id: string, month: string) =>
    client.get<{ month: string; busy: { day: string; slot: Slot }[] }>(`/v1/vendors/${id}/availability`, { month }, { auth: false }),

  // ---- events & bookings ----
  events: () => client.get<{ items: EventSummary[] }>('/v1/events'),
  event: (id: string) => client.get<EventSummary & { bookings: Booking[] }>(`/v1/events/${id}`),
  createEvent: (e: NewEvent) => client.post<EventSummary>('/v1/events', { ...e, cityId: CITY.id }),
  updateEvent: (id: string, e: EventChanges) => client.patch<EventSummary>(`/v1/events/${id}`, e),
  bookings: (q: { eventId?: string } = {}) => client.get<{ items: Booking[] }>('/v1/bookings', q),
  booking: (id: string) => client.get<Booking>(`/v1/bookings/${id}`),
  createBooking: (b: BookingRequest) => client.post<Booking>('/v1/bookings', b),
  startPayment: (id: string, part: PayPart = 'advance') => client.post<PaymentOrder>(`/v1/bookings/${id}/pay`, undefined, part === 'advance' ? {} : { query: { part } }),
  verifyPayment: (id: string, p: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    client.post<Booking>(`/v1/bookings/${id}/pay/verify`, p),
  devPay: (id: string, part: PayPart = 'advance') => client.post<Booking>(`/v1/bookings/${id}/pay/dev`, undefined, part === 'advance' ? {} : { query: { part } }),
  /** What cancelling now would refund, by the same rules as the cancel. Changes nothing. */
  cancelPreview: (id: string) => client.get<CancelPreview>(`/v1/bookings/${id}/cancel-preview`),
  cancelBooking: (id: string, reason: string) => client.post<Booking>(`/v1/bookings/${id}/cancel`, { reason }),
  // ---- rentals (tent, furniture, utensils …) ----
  rentals: (vendorId: string, q: { from?: string; until?: string; q?: string; categoryId?: string } = {}) =>
    client.get<RentalCatalogue>(`/v1/vendors/${vendorId}/rentals`, q, { auth: false }),
  quote: (body: RentalRequest) => client.post<Quote>('/v1/quotes', body),
  /** The same key on a retry returns the booking already made, never a second one. */
  requestRental: (body: RentalRequest, idempotencyKey: string) =>
    client.post<{ id: string }>('/v1/engine-bookings', body, { headers: { 'Idempotency-Key': idempotencyKey } }),
  rental: (bookingId: string) => client.get<RentalView>(`/v1/bookings/${bookingId}/rental`),
  answerCharge: (bookingId: string, chargeId: string, decision: 'accept' | 'dispute', note?: string) =>
    client.post<RentalView>(`/v1/bookings/${bookingId}/charges/${chargeId}`, { decision, note }),
  // ---- services booked by time / quantity (DJ, catering, cars, staff …) ----
  engineServices: (vendorId: string) => client.get<{ items: PublicEngineService[] }>(`/v1/vendors/${vendorId}/engine-services`, undefined, { auth: false }),
  bundles: (vendorId: string) => client.get<{ items: ServiceBundle[] }>(`/v1/vendors/${vendorId}/bundles`, undefined, { auth: false }),
  /** One day of a service: offered or not, the notice, and when the vendor is already taken. */
  serviceDay: (vendorId: string, serviceId: string, date: string, planId?: string) =>
    client.get<ServiceDay>(`/v1/vendors/${vendorId}/engine-services/${serviceId}/day`, { date, ...(planId ? { planId } : {}) }, { auth: false }),
  engineQuote: (body: EngineBookingRequest) => client.post<Quote>('/v1/quotes', body),
  /** The same key on a retry returns the booking already made, never a second one. */
  requestEngine: (body: EngineBookingRequest, idempotencyKey: string) =>
    client.post<{ id: string }>('/v1/engine-bookings', body, { headers: { 'Idempotency-Key': idempotencyKey } }),
  checkoutQuote: (items: EngineBookingRequest[], bundleId?: string) =>
    client.post<{ items: Quote[]; totalPaise: number; advancePaise: number; depositPaise: number }>('/v1/checkouts/quote', bundleId ? { items, bundleId } : { items }),
  /** All the bookings or none. */
  /** `expectedTotalPaise`: the total the customer saw; a different server total answers PRICE_CHANGED. */
  checkout: (items: EngineBookingRequest[], bundleId: string | undefined, idempotencyKey: string, expectedTotalPaise?: number) =>
    client.post<CheckoutResult>('/v1/checkouts', { items, ...(bundleId ? { bundleId } : {}), ...(expectedTotalPaise !== undefined ? { expectedTotalPaise } : {}) }, { headers: { 'Idempotency-Key': idempotencyKey } }),
  checkoutView: (id: string) => client.get<CheckoutView>(`/v1/checkouts/${id}`),
  /** One Razorpay order for every accepted booking of the checkout waiting for its advance. */
  checkoutPay: (id: string) => client.post<CheckoutPaymentOrder>(`/v1/checkouts/${id}/pay`),
  checkoutPayVerify: (id: string, p: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    client.post<CheckoutView>(`/v1/checkouts/${id}/pay/verify`, p),
  checkoutDevPay: (id: string) => client.post<CheckoutView>(`/v1/checkouts/${id}/pay/dev`),
  money: (bookingId: string) => client.get<MoneySummary>(`/v1/bookings/${bookingId}/money`),
  licence: async () => (await client.get<{ licence: DriverLicence | null }>('/v1/me/licence')).licence,
  signLicencePhoto: () => client.post<UploadSignature>('/v1/me/licence/upload'),
  /** A private upload for a photo or PDF answer to a vendor's question. */
  signAnswerUpload: () => client.post<UploadSignature>('/v1/me/answer-upload'),
  /** A 10-minute link to a file attached to the booking. */
  answerFile: (bookingId: string, key: string) => client.get<{ url: string }>(`/v1/bookings/${bookingId}/answer-files/${encodeURIComponent(key)}`),
  saveLicence: (body: { number: string; dateOfBirth: string; expiresOn: string; photo?: { publicId: string; version: number; signature: string; format: string } }) =>
    client.put<DriverLicence>('/v1/me/licence', body),
  trip: (bookingId: string) => client.get<TripView>(`/v1/bookings/${bookingId}/trip`),
  cash: (bookingId: string) => client.get<CashSummary>(`/v1/bookings/${bookingId}/cash`),
  handoverCode: (bookingId: string) => client.get<{ code: string; phase: 'handover' | 'delivery' | 'return'; expiresAt: string }>(`/v1/bookings/${bookingId}/handover-code`),
  ackInspection: (bookingId: string, phase: 'handover' | 'return', decision: 'agreed' | 'disputed', note?: string) =>
    client.post<TripView>(`/v1/bookings/${bookingId}/inspections/${phase}/ack`, note ? { decision, note } : { decision }),
  changes: (bookingId: string) => client.get<{ items: BookingChange[] }>(`/v1/bookings/${bookingId}/changes`),
  requestChange: (bookingId: string, body: { kind: 'reschedule' | 'extension'; startsAt?: string; endsAt: string; reason?: string }) =>
    client.post<BookingChange>(`/v1/bookings/${bookingId}/changes`, body),
  cancelChange: (bookingId: string, changeId: string) => client.post<void>(`/v1/bookings/${bookingId}/changes/${changeId}/cancel`),
  invoice: (bookingId: string) => client.get<Invoice>(`/v1/bookings/${bookingId}/invoice`),
  review: (id: string, rating: number, comment?: string) => client.post<Review>(`/v1/bookings/${id}/review`, { rating, comment }),

  // ---- coupons & offers ----
  /** Public coupons (no login), in the app language. */
  offers: () => client.get<{ items: Offer[] }>('/v1/offers', undefined, { auth: false }),
  /** Only before paying; the server checks the code and returns the booking with the new pay-now amount. */
  applyCoupon: (id: string, code: string) => client.post<Booking>(`/v1/bookings/${id}/coupon`, { code }),
  removeCoupon: (id: string) => client.delete<Booking>(`/v1/bookings/${id}/coupon`),

  // ---- saved vendors ----
  shortlist: () => client.get<{ items: SavedVendor[] }>('/v1/shortlist'),
  save: (vendorId: string) => client.put<void>(`/v1/shortlist/${vendorId}`),
  unsave: (vendorId: string) => client.delete<void>(`/v1/shortlist/${vendorId}`),

  // ---- chat ----
  startChat: (vendorId: string) => client.post<{ id: string }>('/v1/conversations', { vendorId }),
  conversations: () => client.get<{ items: Conversation[] }>('/v1/conversations'),
  messages: (id: string, beforeId?: number) => client.get<MessagesPage>(`/v1/conversations/${id}/messages`, { beforeId }),
  sendMessage: (id: string, body: string) => client.post<Message>(`/v1/conversations/${id}/messages`, { body }),

  // ---- help & notifications ----
  complaints: () => client.get<{ items: Complaint[] }>('/v1/complaints'),
  createComplaint: (c: { bookingId?: string; subject: string; details: string }) => client.post<Complaint>('/v1/complaints', c),
  notifications: () => client.get<NotificationsPage>('/v1/notifications'),
  markNotificationsRead: (ids?: number[]) => client.post<void>('/v1/notifications/read', ids ? { ids } : {}),
};

export type Api = typeof api;
