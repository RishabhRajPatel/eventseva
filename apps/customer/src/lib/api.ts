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
}

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
  startPayment: (id: string) => client.post<PaymentOrder>(`/v1/bookings/${id}/pay`),
  verifyPayment: (id: string, p: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    client.post<Booking>(`/v1/bookings/${id}/pay/verify`, p),
  devPay: (id: string) => client.post<Booking>(`/v1/bookings/${id}/pay/dev`),
  cancelBooking: (id: string, reason: string) => client.post<Booking>(`/v1/bookings/${id}/cancel`, { reason }),
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
