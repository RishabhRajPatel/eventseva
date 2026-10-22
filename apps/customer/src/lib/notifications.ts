import type { AppNotification } from '@eventseva/app-shared';

/** Where a notification leads, from its data. */
export function notificationTarget(n: Pick<AppNotification, 'data'>) {
  if (n.data.bookingId) return { pathname: '/booking/[id]', params: { id: n.data.bookingId } } as const;
  if (n.data.conversationId) return { pathname: '/chat/[id]', params: { id: n.data.conversationId } } as const;
  if (n.data.vendorId) return { pathname: '/vendor/[id]', params: { id: n.data.vendorId } } as const;
  return null;
}
