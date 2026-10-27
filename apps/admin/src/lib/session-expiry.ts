// Admin tokens last 8 hours and are never renewed. Warn a few minutes before the end, so nobody
// loses a half-written reason or refund to a sudden logout.

export const SESSION_WARN_MS = 5 * 60_000;

export type ExpiryPhase = 'active' | 'warning' | 'expired';

export function expiryPhase(expiresAt: number, now: number, warnMs: number = SESSION_WARN_MS): ExpiryPhase {
  const left = expiresAt - now;
  if (left <= 0) return 'expired';
  if (left <= warnMs) return 'warning';
  return 'active';
}

/** Milliseconds until the warning should appear (0 if it should show now). */
export function msUntilWarning(expiresAt: number, now: number, warnMs: number = SESSION_WARN_MS): number {
  return Math.max(0, expiresAt - warnMs - now);
}

/** "4 min 05 s" / "45 s" / "0 s" for the live countdown. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

/** "6:42 pm" in India time, for "Your session ends at …". */
export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
