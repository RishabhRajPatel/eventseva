import type { Language } from '@eventseva/app-shared';
import { todayIst } from '@eventseva/app-shared';

const locale = (lang: Language) => (lang === 'hi' ? 'hi-IN' : 'en-IN');

/** "10:42 am" today, "12 Feb" before that (India time). */
export function shortTime(iso: string, lang: Language, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = todayIst(d) === todayIst(now);
  return sameDay
    ? d.toLocaleTimeString(locale(lang), { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(locale(lang), { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
}
