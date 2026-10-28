import type { AppNotification } from '@eventseva/app-shared';

/** Where tapping a notification goes: the booking, the chat, or the car / driver it is about. */
export function notificationTarget(n: Pick<AppNotification, 'data'>): string | null {
  if (typeof n.data.bookingId === 'string') return `/booking/${n.data.bookingId}`;
  if (typeof n.data.conversationId === 'string') return `/chat/${n.data.conversationId}`;
  if (typeof n.data.resourceId === 'string') return `/engine/resource/${n.data.resourceId}`;
  return null;
}
