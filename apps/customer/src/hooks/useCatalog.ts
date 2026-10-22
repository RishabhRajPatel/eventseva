import { useQuery } from '@tanstack/react-query';
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
