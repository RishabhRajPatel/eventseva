// Booking updates in the chat (`kind: 'booking'` messages), worded for the vendor.
import type { TFunction } from 'i18next';
import { formatDay, type BookingEventData } from '@eventseva/app-shared';

export function bookingEventText(t: TFunction, d: BookingEventData | null, lang: 'en' | 'hi'): string {
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
