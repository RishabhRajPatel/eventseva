import { todayIst, type EventType, type LatLng } from '@eventseva/app-shared';
import type { NewEvent } from './api';

export interface EventDraft {
  title: string;
  eventType: EventType;
  eventDate: string | null;
  guests: string;
  venue: string;
  landmark: string;
  pin: LatLng | null;
}

export const emptyEvent = (eventDate: string | null = null): EventDraft => ({
  title: '',
  eventType: 'wedding',
  eventDate,
  guests: '',
  venue: '',
  landmark: '',
  pin: null,
});

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
    event: {
      title,
      eventType: d.eventType,
      eventDate: d.eventDate!,
      guestCount: guests,
      venueAddress: venue || undefined,
      venueLandmark: d.landmark.trim().length >= 2 ? d.landmark.trim() : undefined,
      venueLat: d.pin?.lat,
      venueLng: d.pin?.lng,
    },
  };
}

/** Validate one field as the user leaves it (UX.md §3: validate on blur, and again on submit). */
export function validateField(d: EventDraft, field: keyof EventErrors, current: EventErrors, today = todayIst()): EventErrors {
  return { ...current, [field]: validateEvent(d, today).errors[field] };
}

/** After an edit: drop the errors that are now fixed, keep the ones that still fail. */
export function revalidate(d: EventDraft, current: EventErrors, today = todayIst()): EventErrors {
  const now = validateEvent(d, today).errors;
  const next: EventErrors = {};
  for (const k of Object.keys(current) as (keyof EventErrors)[]) if (current[k] && now[k]) next[k] = now[k];
  return next;
}

/** The first field with an error, in the order they appear on screen. */
export function firstEventError(e: EventErrors): keyof EventErrors | null {
  return (['title', 'eventDate', 'guests', 'venue'] as const).find((k) => e[k]) ?? null;
}
