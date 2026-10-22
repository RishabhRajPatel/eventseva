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
  type Language,
  type Me,
  type Message,
  type Paged,
  type PaymentOrder,
  type Review,
  type Slot,
  type VendorCard,
  type VendorDetail,
} from '@eventseva/app-shared';
import i18n from '../i18n';
import { API_URL, CITY } from './config';
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
});

export interface NewEvent {
  title: string;
  eventType: EventType;
  eventDate: string;
  venueAddress?: string;
  guestCount?: number;
}

export interface BookingRequest {
  eventId: string;
  vendorId: string;
  serviceId?: string;
  packageId?: string;
  slot: Slot;
  quantity?: number;
  note?: string;
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
  categories: () => client.get<{ items: Category[] }>('/v1/categories', undefined, { auth: false }),

  // ---- vendors ----
  vendors: (q: { category?: string; page?: number; limit?: number }) =>
    client.get<Paged<VendorCard>>('/v1/vendors', { cityId: CITY.id, ...q }, { auth: false }),
  vendor: (id: string) => client.get<VendorDetail>(`/v1/vendors/${id}`, undefined, { auth: false }),
  reviews: (id: string, page = 1) => client.get<Paged<Review>>(`/v1/vendors/${id}/reviews`, { page }, { auth: false }),
  availability: (id: string, month: string) =>
    client.get<{ month: string; busy: { day: string; slot: Slot }[] }>(`/v1/vendors/${id}/availability`, { month }, { auth: false }),

  // ---- events & bookings ----
  events: () => client.get<{ items: EventSummary[] }>('/v1/events'),
  event: (id: string) => client.get<EventSummary & { bookings: Booking[] }>(`/v1/events/${id}`),
  createEvent: (e: NewEvent) => client.post<EventSummary>('/v1/events', { ...e, cityId: CITY.id }),
  bookings: (q: { eventId?: string } = {}) => client.get<{ items: Booking[] }>('/v1/bookings', q),
  booking: (id: string) => client.get<Booking>(`/v1/bookings/${id}`),
  createBooking: (b: BookingRequest) => client.post<Booking>('/v1/bookings', b),
  startPayment: (id: string) => client.post<PaymentOrder>(`/v1/bookings/${id}/pay`),
  verifyPayment: (id: string, p: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    client.post<Booking>(`/v1/bookings/${id}/pay/verify`, p),
  devPay: (id: string) => client.post<Booking>(`/v1/bookings/${id}/pay/dev`),
  cancelBooking: (id: string, reason: string) => client.post<Booking>(`/v1/bookings/${id}/cancel`, { reason }),
  review: (id: string, rating: number, comment?: string) => client.post<Review>(`/v1/bookings/${id}/review`, { rating, comment }),

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
