import { todayIst, type Language } from '@eventseva/app-shared';

const locale = (lang: Language) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

/** "10:42 am" for today, "12 Feb" for other days (India time). */
export function shortWhen(iso: string, lang: Language, now = new Date()): string {
  const d = new Date(iso);
  const day = new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (day === todayIst(now)) {
    return d.toLocaleTimeString(locale(lang), { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(locale(lang), { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}

export const clockTime = (iso: string, lang: Language) =>
  new Date(iso).toLocaleTimeString(locale(lang), { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
