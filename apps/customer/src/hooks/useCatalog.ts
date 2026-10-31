import { useQuery } from '@tanstack/react-query';
import type { EventType } from '@eventseva/app-shared';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { keys } from '../lib/queryClient';

/** Categories come back in the app language, so the language is part of the cache key. */
export function useCategories() {
  const { i18n } = useTranslation();
  return useQuery({ queryKey: [...keys.categories, i18n.language], queryFn: api.categories, staleTime: 60 * 60_000 });
}

export function useNotificationsBadge() {
  const q = useQuery({ queryKey: keys.notifications, queryFn: api.notifications, refetchInterval: 60_000 });
  return q.data?.unreadCount ?? 0;
}

/** Public coupons (home banner, Offers page, payment screen). Titles come in the app language. */
export function useOffers() {
  const { i18n } = useTranslation();
  return useQuery({ queryKey: [...keys.offers, i18n.language], queryFn: api.offers, staleTime: 10 * 60_000 });
}

/** EventSeva's packages for one occasion. Catalogue, so it is cached like the rest of it. */
export function usePackages(eventType?: EventType) {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: [...keys.packages, eventType ?? 'all', i18n.language],
    queryFn: () => api.packages(eventType),
    staleTime: 10 * 60_000,
  });
}
