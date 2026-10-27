// Distance, travel time and Google Maps links shared by both apps (no Maps API key needed).
import type { LatLng } from './types';

/** Opens Google Maps with directions to the venue, starting from wherever the phone is. */
export const directionsUrl = (to: LatLng | string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(typeof to === 'string' ? to : `${to.lat},${to.lng}`)}`;

/** Opens Google Maps at a pin, to check that it is in the right place. */
export const pinUrl = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`;

/** "6.5 km" / "6.5 किमी"; under 1 km in metres. */
export function formatDistance(km: number, lang: 'en' | 'hi' = 'en'): string {
  if (km < 1) return lang === 'hi' ? `${Math.max(100, Math.round(km * 10) * 100)} मीटर` : `${Math.max(100, Math.round(km * 10) * 100)} m`;
  const n = Number.isInteger(km) ? String(km) : km.toFixed(1);
  return lang === 'hi' ? `${n} किमी` : `${n} km`;
}

/** "20 min", "1 h 10 min" / "20 मिनट", "1 घंटा 10 मिनट". */
export function formatMinutes(min: number, lang: 'en' | 'hi' = 'en'): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (lang === 'hi') return [h ? `${h} घंटा` : '', m || !h ? `${m} मिनट` : ''].filter(Boolean).join(' ');
  return [h ? `${h} h` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** '17:30' → "5:30 pm". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** An ISO time as "5:40 pm" in India time. */
export const formatTimeIst = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

/** Whole minutes from now until an ISO time (never below 0). */
export const minutesUntil = (iso: string, now = Date.now()) => Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
