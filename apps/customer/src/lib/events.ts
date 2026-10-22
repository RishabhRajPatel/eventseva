import { todayIst, type EventType } from '@eventseva/app-shared';
import type { NewEvent } from './api';

export interface EventDraft {
  title: string;
  eventType: EventType;
  eventDate: string | null;
  guests: string;
  venue: string;
}

export const emptyEvent = (eventDate: string | null = null): EventDraft => ({ title: '', eventType: 'wedding', eventDate, guests: '', venue: '' });

export type EventErrors = Partial<Record<'title' | 'eventDate' | 'guests' | 'venue', 'titleShort' | 'dateMissing' | 'datePast' | 'guestsBad' | 'venueShort'>>;

/** Same limits as the API (POST /v1/events), checked before sending. */
export function validateEvent(d: EventDraft, today = todayIst()): { errors: EventErrors; event: NewEvent | null } {
  const errors: EventErrors = {};
  const title = d.title.trim();
  if (title.length < 2) errors.title = 'titleShort';
  if (!d.eventDate) errors.eventDate = 'dateMissing';
  else if (d.eventDate < today) errors.eventDate = 'datePast';
  const guests = d.guests.trim() ? Number(d.guests.trim()) : undefined;
  if (guests !== undefined && (!Number.isInteger(guests) || guests < 1 || guests > 100_000)) errors.guests = 'guestsBad';
  const venue = d.venue.trim();
  if (venue && venue.length < 5) errors.venue = 'venueShort';
  if (Object.keys(errors).length) return { errors, event: null };
  return {
    errors,
    event: { title, eventType: d.eventType, eventDate: d.eventDate!, guestCount: guests, venueAddress: venue || undefined },
  };
}
