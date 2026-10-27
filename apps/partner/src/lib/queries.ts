// Every server read the app makes, as React Query hooks, plus the keys mutations invalidate.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  AppNotification,
  BankAccount,
  Booking,
  BookingStatus,
  CalendarEntry,
  Category,
  City,
  Complaint,
  Conversation,
  Earnings,
  FeaturedOverview,
  Media,
  Message,
  VendorDocument,
  OwnVendor,
  PartnerDashboard,
  Review,
} from '@eventseva/app-shared';
import { api } from './api';
import { isVendorMissing } from './errors';
import { currentLanguage } from '../i18n';

/** How long data counts as fresh (UX.md §7): catalogue 1 h, lists 30 s, rarely changing data longer. */
export const STALE = { catalogue: 60 * 60_000, list: 30_000, profile: 60_000, slow: 5 * 60_000 } as const;

export const keys = {
  vendor: ['vendor'] as const,
  categories: (lang: string) => ['categories', lang] as const,
  cities: ['cities'] as const,
  dashboard: ['dashboard'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  calendar: (month: string) => ['calendar', month] as const,
  earnings: (month: string) => ['earnings', month] as const,
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  reviews: ['reviews'] as const,
  notifications: ['notifications'] as const,
  complaints: ['complaints'] as const,
  media: ['media'] as const,
  documents: ['documents'] as const,
  bank: ['bank'] as const,
  featured: ['featured'] as const,
};

/** The vendor's own profile; null when they have not created one yet (start onboarding). */
export function useVendor() {
  return useQuery({
    queryKey: keys.vendor,
    queryFn: async () => {
      try {
        return await api.get<OwnVendor>('/v1/partner/vendor');
      } catch (e) {
        if (isVendorMissing(e)) return null;
        throw e;
      }
    },
    staleTime: STALE.profile,
  });
}

export function useCategories() {
  const lang = currentLanguage();
  return useQuery({
    queryKey: keys.categories(lang),
    queryFn: async () => (await api.get<{ items: Category[] }>('/v1/categories', undefined, { auth: false })).items,
    staleTime: STALE.catalogue,
  });
}

export function useCities() {
  return useQuery({
    queryKey: keys.cities,
    queryFn: async () => (await api.get<{ items: City[] }>('/v1/cities', undefined, { auth: false })).items,
    staleTime: STALE.catalogue,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<PartnerDashboard>('/v1/partner/dashboard'), staleTime: STALE.list });
}

export function useBookings(status?: BookingStatus) {
  return useQuery({
    queryKey: status ? [...keys.bookings, status] : keys.bookings,
    queryFn: async () => (await api.get<{ items: Booking[] }>('/v1/partner/bookings', { status })).items,
  });
}

export function useBooking(id: string | undefined) {
  return useQuery({
    queryKey: keys.booking(id ?? ''),
    queryFn: () => api.get<Booking>(`/v1/partner/bookings/${id}`),
    enabled: !!id,
  });
}

export function useCalendar(month: string) {
  return useQuery({
    queryKey: keys.calendar(month),
    queryFn: async () => (await api.get<{ month: string; items: CalendarEntry[] }>('/v1/partner/calendar', { month })).items,
  });
}

export function useEarnings(month: string) {
  return useQuery({ queryKey: keys.earnings(month), queryFn: () => api.get<Earnings>('/v1/partner/earnings', { month }), staleTime: STALE.profile });
}

export function useConversations(poll = false) {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: async () => (await api.get<{ items: Conversation[] }>('/v1/conversations')).items,
    refetchInterval: poll ? 15_000 : false,
  });
}

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
  phoneShared: boolean;
}

/** The latest messages; polled every 4 s while the thread is open. */
export function useMessages(id: string, poll: boolean) {
  return useQuery({
    queryKey: keys.messages(id),
    queryFn: () => api.get<MessagePage>(`/v1/conversations/${id}/messages`),
    refetchInterval: poll ? 4_000 : false,
  });
}

export function useReviews() {
  return useQuery({
    queryKey: keys.reviews,
    queryFn: async () => (await api.get<{ items: Review[] }>('/v1/partner/reviews')).items,
    staleTime: STALE.slow,
  });
}

export interface NotificationPage {
  items: AppNotification[];
  hasMore: boolean;
  unreadCount: number;
}

export function useNotifications() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<NotificationPage>('/v1/notifications'),
    refetchInterval: 60_000,
  });
}

export interface MediaPage {
  items: Media[];
  limits: { photos: number; videos: number };
}

/** All of the vendor's photos and videos with review status, and how many are allowed. */
export function useMedia() {
  return useQuery({ queryKey: keys.media, queryFn: () => api.get<MediaPage>('/v1/partner/media') });
}

export function useBankAccount() {
  return useQuery({
    queryKey: keys.bank,
    queryFn: async () => (await api.get<{ account: BankAccount | null }>('/v1/partner/bank-account')).account,
    staleTime: STALE.slow,
  });
}

export function useDocuments() {
  return useQuery({
    queryKey: keys.documents,
    queryFn: async () => (await api.get<{ items: VendorDocument[] }>('/v1/partner/documents')).items,
    staleTime: STALE.slow,
  });
}

/** After uploading, deleting or re-ordering photos: the list, the profile and its checklist. */
export function invalidateMedia(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.media });
  void qc.invalidateQueries({ queryKey: keys.vendor });
}

/** "Get featured": current end date, plans and past purchases. */
export function useFeatured() {
  return useQuery({ queryKey: keys.featured, queryFn: () => api.get<FeaturedOverview>('/v1/partner/featured'), staleTime: STALE.profile });
}

export function useComplaints() {
  return useQuery({
    queryKey: keys.complaints,
    queryFn: async () => (await api.get<{ items: Complaint[] }>('/v1/complaints')).items,
    staleTime: STALE.profile,
  });
}

/** After accepting, rejecting or cancelling: every list and total that counts bookings. */
export function invalidateBookings(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: keys.bookings });
  void qc.invalidateQueries({ queryKey: keys.dashboard });
  void qc.invalidateQueries({ queryKey: ['calendar'] });
  void qc.invalidateQueries({ queryKey: ['earnings'] });
  if (id) void qc.invalidateQueries({ queryKey: keys.booking(id) });
}

export function invalidateVendor(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: keys.vendor });
  void qc.invalidateQueries({ queryKey: keys.dashboard });
}
