// Booking services priced by time or quantity (DJ, decor, catering, cars, staff, makeup, planners):
// what the form asks for each kind, the request it sends, and checks that guide the customer.
// The server checks and prices everything again.
import type { BookingType, EngineBookingRequest, FieldDef, Language, Place, PublicEngineService } from '@eventseva/app-shared';
import { addDaysTo, istIso } from './rental';

/** Start times offered, India time. */
export const START_TIMES = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'] as const;

/** Which count the service is priced by: guests (catering), workers (staff), people (makeup), none. */
export type CountKind = 'guests' | 'workers' | 'people' | null;

export function countKind(type: BookingType): CountKind {
  if (type === 'per_person') return 'guests';
  if (type === 'staffing') return 'workers';
  if (type === 'appointment') return 'people';
  return null;
}

/** Appointments end when the last person is done; every other kind asks how long. */
export const asksDuration = (type: BookingType) => type !== 'appointment';

/** Hours offered, within the vendor's shortest and longest booking. */
export function durationChoices(s: Pick<PublicEngineService, 'rules'>): number[] {
  const min = Math.max(1, Math.ceil((s.rules.minDurationMin ?? 60) / 60));
  const max = Math.max(min, Math.floor((s.rules.maxDurationMin ?? 24 * 60) / 60));
  const base = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24, 48, 72];
  const out = base.filter((h) => h >= min && h <= max);
  return out.includes(min) ? out : [min, ...out];
}

export const defaultHours = (s: Pick<PublicEngineService, 'rules'>) => {
  const choices = durationChoices(s);
  return choices.includes(4) ? 4 : choices[0];
};

/** Car modes the vehicle offers. */
export function carModes(s: Pick<PublicEngineService, 'resource'>): ('with_driver' | 'self_drive')[] {
  const a = s.resource?.attributes ?? {};
  const out: ('with_driver' | 'self_drive')[] = [];
  if (a.with_driver) out.push('with_driver');
  if (a.self_drive) out.push('self_drive');
  return out.length ? out : ['with_driver'];
}

export interface EngineForm {
  eventId: string;
  eventDay: string;
  /** Days from the event day (cars can start the day before). */
  dayOffset: number;
  startTime: string;
  hours: number;
  count: string;
  mode: 'with_driver' | 'self_drive';
  pickup: Place | null;
  destination: Place | null;
  answers: Record<string, unknown>;
  addons: Record<string, { on: boolean; note: string }>;
  note: string;
}

export type FormProblem = 'count' | 'countRange' | 'route' | 'answers' | null;

/** What stops the request, checked on the phone before asking the server. */
export function formProblem(s: PublicEngineService, f: EngineForm): FormProblem {
  const kind = countKind(s.bookingType);
  if (kind) {
    const n = Number(f.count);
    if (!/^\d{1,6}$/.test(f.count.trim()) || n < 1) return 'count';
    const min = s.rules.minQty ?? (kind === 'guests' ? s.minGuests : null);
    const max = s.rules.maxQty ?? (kind === 'guests' ? s.maxGuests : null);
    if ((min !== null && n < min) || (max !== null && n > max)) return 'countRange';
  }
  if (s.bookingType === 'transport' && (!f.pickup || !f.destination)) return 'route';
  if (Object.keys(answerErrors(s.questions, f.answers)).length) return 'answers';
  return null;
}

/** Required questions not answered, numbers out of range. */
export function answerErrors(fields: FieldDef[], values: Record<string, unknown>): Record<string, 'required' | 'invalid'> {
  const out: Record<string, 'required' | 'invalid'> = {};
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (f.required) out[f.key] = 'required';
      continue;
    }
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) out[f.key] = 'invalid';
    }
  }
  return out;
}

/** The request for POST /v1/quotes and /v1/engine-bookings. */
export function toRequest(s: PublicEngineService, f: EngineForm): EngineBookingRequest {
  const day = addDaysTo(f.eventDay, f.dayOffset);
  const startsAt = istIso(day, f.startTime);
  const req: EngineBookingRequest = { eventId: f.eventId, serviceId: s.id, startsAt };
  if (asksDuration(s.bookingType)) req.endsAt = new Date(Date.parse(startsAt) + f.hours * 3_600_000).toISOString();
  const n = Number(f.count);
  const kind = countKind(s.bookingType);
  if (kind === 'guests') req.guestCount = n;
  if (kind === 'workers') req.quantity = n;
  if (kind === 'people') req.people = n;
  if (s.bookingType === 'transport' && f.pickup && f.destination) {
    req.route = { pickup: f.pickup, destination: f.destination };
    req.mode = f.mode;
  }
  const answers: Record<string, unknown> = {};
  for (const q of s.questions) {
    const v = f.answers[q.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    answers[q.key] = q.type === 'number' ? Number(v) : typeof v === 'string' ? v.trim() : v;
  }
  if (Object.keys(answers).length) req.answers = answers;
  const addons = Object.entries(f.addons)
    .filter(([, a]) => a.on)
    .map(([addonId, a]) => (a.note.trim() ? { addonId, note: a.note.trim() } : { addonId }));
  if (addons.length) req.addons = addons;
  if (f.note.trim()) req.note = f.note.trim();
  return req;
}

/** A fresh key per request, so a retried tap never makes a second booking. */
export const newKey = (prefix = 'book') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const fieldLabel = (f: Pick<FieldDef, 'label'>, lang: Language) => (lang === 'hi' ? f.label.hi : f.label.en);

const PER_MODELS = ['fixed', 'hourly', 'daily', 'per_person', 'per_trip', 'per_unit'] as const;
/** The "per …" word for a price: `t(\`engineBook.per.${perModel(model)}\`)`. */
export const perModel = (model: string): (typeof PER_MODELS)[number] => (PER_MODELS as readonly string[]).includes(model) ? (model as (typeof PER_MODELS)[number]) : 'fixed';

/** The day after the event and the day before, for a car to the venue or a mehendi the evening before. */
export const DAY_OFFSETS = [-1, 0, 1] as const;
export const offsetDay = (eventDay: string, offset: number) => addDaysTo(eventDay, offset);

// ---------- changes after booking ----------

export const EXTEND_HOURS = [1, 2, 3, 4, 6, 24] as const;

/** An extension keeps the start and moves the end later. */
export const extendedEnd = (endsAt: string, hours: number) => new Date(Date.parse(endsAt) + hours * 3_600_000).toISOString();

/** A reschedule keeps the length and moves the start to a new day and time (India time). */
export function movedTimes(startsAt: string, endsAt: string, day: string, hhmm: string): { startsAt: string; endsAt: string } {
  const length = Date.parse(endsAt) - Date.parse(startsAt);
  const start = istIso(day, hhmm);
  return { startsAt: new Date(Date.parse(start)).toISOString(), endsAt: new Date(Date.parse(start) + length).toISOString() };
}

/** The booking's day in India time, 'YYYY-MM-DD'. */
export const istDayOf = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

// ---------- driving licence (self-drive) ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Same checks as the server: "UP70 20190012345", dates as YYYY-MM-DD, not expired. */
export function licenceProblem(number: string, dob: string, expires: string, today = new Date().toISOString().slice(0, 10)): 'number' | 'dob' | 'expires' | 'expired' | null {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,14}$/.test(number.replace(/[\s-]/g, '').toUpperCase())) return 'number';
  if (!validDate(dob.trim()) || dob.trim() >= today) return 'dob';
  if (!validDate(expires.trim())) return 'expires';
  if (expires.trim() < today) return 'expired';
  return null;
}
