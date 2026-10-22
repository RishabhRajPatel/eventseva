import type { AppNotification } from '@eventseva/app-shared';

/** Where tapping a notification goes: the booking or the chat it is about. */
export function notificationTarget(n: Pick<AppNotification, 'data'>): string | null {
  if (typeof n.data.bookingId === 'string') return `/booking/${n.data.bookingId}`;
  if (typeof n.data.conversationId === 'string') return `/chat/${n.data.conversationId}`;
  return null;
}
