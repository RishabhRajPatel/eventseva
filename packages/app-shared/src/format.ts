import type { Language } from '@eventseva/core';

/** ₹1,35,000 — Indian digit grouping; paise shown only when there are any. */
export function rupees(paise: number): string {
  const r = paise / 100;
  return '₹' + r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 });
}

const locale = (lang: Language) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

/** "12 Feb 2027" / "12 फ़र॰ 2027" for a 'YYYY-MM-DD' day (no time-zone shifting). */
export function formatDay(day: string, lang: Language = 'en', withWeekday = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(locale(lang), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  });
}

/** Date and time in India time, for timestamps such as "pay by". */
export function formatDateTime(iso: string, lang: Language = 'en'): string {
  return new Date(iso).toLocaleString(locale(lang), {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Today in India as 'YYYY-MM-DD'. */
export function todayIst(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "+91 98765 43210" */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** Hours and minutes left until a deadline, e.g. "5h 20m"; null when it has passed. */
export function timeLeft(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}
