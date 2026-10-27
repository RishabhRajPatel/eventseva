// Booking updates in the chat (`kind: 'booking'` messages), in the app's language.
import type { TFunction } from 'i18next';
import { formatDay, type BookingEventData, type Language } from '@eventseva/app-shared';

export function bookingEventText(t: TFunction, d: BookingEventData | null, lang: Language): string {
  if (!d) return '';
  switch (d.event) {
    case 'requested':
      return d.item && d.day ? t('chatEvents.requested', { item: d.item, day: formatDay(d.day, lang) }) : t('chatEvents.requestedShort');
    case 'expired':
      return t(d.why === 'not_paid' ? 'chatEvents.expired_not_paid' : 'chatEvents.expired_no_reply');
    case 'on_the_way':
      return d.minutes ? t('chatEvents.on_the_way_eta', { min: d.minutes }) : t('chatEvents.on_the_way');
    default:
      return t(`chatEvents.${d.event}`);
  }
}
