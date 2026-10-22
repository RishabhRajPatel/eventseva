import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@eventseva/app-shared';

/** Query keys in one place, so mutations invalidate the right ones. */
export const keys = {
  me: ['me'] as const,
  categories: ['categories'] as const,
  vendors: (category?: string) => ['vendors', category ?? 'all'] as const,
  vendor: (id: string) => ['vendor', id] as const,
  reviews: (id: string) => ['vendor', id, 'reviews'] as const,
  availability: (id: string, month: string) => ['vendor', id, 'availability', month] as const,
  events: ['events'] as const,
  event: (id: string) => ['events', id] as const,
  bookings: (eventId?: string) => ['bookings', eventId ?? 'all'] as const,
  allBookings: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  shortlist: ['shortlist'] as const,
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  notifications: ['notifications'] as const,
  complaints: ['complaints'] as const,
};

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Client errors (404, 403, validation) will not fix themselves; only retry network trouble and 5xx.
        retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = makeQueryClient();
