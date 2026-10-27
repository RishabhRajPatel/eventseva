// Every error the admin API can return, as a full sentence that says what happened and what to do
// (UX.md §5). Codes from docs/API.md and apps/backend/src/admin/*.controller.ts. Unknown codes fall
// back to the API's own message, which is always written for people; raw codes are never shown.

/** The shape of ApiError from @eventseva/app-shared (duck-typed so node tests need no workspace import). */
interface ApiErrorLike {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function isApiError(e: unknown): e is ApiErrorLike {
  return typeof e === 'object' && e !== null && typeof (e as ApiErrorLike).code === 'string' && typeof (e as ApiErrorLike).status === 'number';
}

const RETRY = 'Please try again.';
const SERVER_DOWN = 'The EventSeva server is not responding. Wait a minute and try again; if it keeps happening, check that the API is running.';

type Describe = string | ((e: ApiErrorLike) => string);

/** Server message plus what to do next. */
const withHint = (hint: string) => (e: ApiErrorLike) => `${ensureStop(e.message)} ${hint}`;

export const ERROR_MESSAGES: Record<string, Describe> = {
  NETWORK: 'No internet connection, or the server could not be reached. Check your connection and try again.',
  INTERNAL: `Something went wrong on the server. ${RETRY} If it happens again, note the time and tell the developers.`,
  VALIDATION: withHint('Correct the highlighted details and try again.'),
  UNAUTHORIZED: 'Your session has ended. Log in again to continue.',
  FORBIDDEN: 'Your admin role cannot do this. Ask a super admin if you need access.',
  NOT_FOUND: (e) => `${ensureStop(e.message)} Another admin may have changed it; the page now shows the latest.`,
  RATE_LIMITED: 'Too many requests in a short time. Wait a minute, then try again.',
  ADMIN_LOGIN_FAILED: 'Email, password or 2FA code is wrong. Check all three and try again; use a fresh code from your authenticator app.',
  ADMIN_LOCKED: 'Too many wrong attempts, so this account is locked for 15 minutes. Wait, then log in with a fresh 2FA code.',
  VENDOR_BAD_STATUS: (e) => `${ensureStop(e.message)} Another admin may have decided already; the page has been refreshed.`,
  VENDOR_NOT_FOUND: 'This vendor no longer exists. Go back to the vendor list.',
  BOOKING_NOT_FOUND: 'This booking no longer exists. Go back to the bookings list.',
  PAYOUT_BAD_STATUS: (e) => `${ensureStop(e.message)} The payout list has been refreshed with its current status.`,
  MEDIA_BAD_STATUS: 'This upload is not finished yet, so it cannot be reviewed. Try again in a few minutes.',
  REFUND_TOO_HIGH: withHint('Lower the amount and try again.'),
  NOTHING_TO_REFUND: 'No payment has been made for this booking yet. Nothing can be refunded until the customer pays the advance.',
  DEDUCTION_TOO_HIGH: withHint('Lower the amount, or untick “Take it from the vendor’s payout” so EventSeva pays the rest.'),
  NO_VENDOR_PAYOUT: 'This booking was cancelled, so the vendor gets no payout to take the refund from. Untick “Take it from the vendor’s payout” to refund at EventSeva’s cost.',
  PAYOUT_ALREADY_PAID: 'The vendor has already been paid for this booking. Untick “Take it from the vendor’s payout” to refund at EventSeva’s cost.',
  CATEGORY_EXISTS: 'A category with this name already exists. Use a different name, or edit the existing one.',
  CITY_EXISTS: 'This city is already in the list. Edit it or show it instead of adding it again.',
  LAST_CITY: 'At least one city must stay shown to customers. Show another city first, then hide this one.',
  COUPON_EXISTS: 'This coupon code is already taken. Pick a different code.',
  OTP_SERVICE_BUSY: 'Login codes are paused because the daily SMS budget is used up. See the alert on the dashboard.',
};

/** Ends a sentence with a full stop if it has no end punctuation. */
function ensureStop(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** The text to show for any error from an API call (or anything else that was thrown). */
export function describeError(e: unknown): string {
  if (!isApiError(e)) return `Something went wrong. ${RETRY}`;
  const entry = ERROR_MESSAGES[e.code];
  if (typeof entry === 'string') return entry;
  if (entry) return entry(e);
  // The rewrite proxy answers 5xx without a JSON body when the API is down.
  if (/^HTTP_5\d\d$/.test(e.code) || e.status >= 500) return SERVER_DOWN;
  return e.message ? ensureStop(e.message) : `Something went wrong. ${RETRY}`;
}

/** Codes meaning the record changed meanwhile: retrying cannot work, so close and reload. */
export const STALE_CODES = new Set(['VENDOR_BAD_STATUS', 'PAYOUT_BAD_STATUS', 'MEDIA_BAD_STATUS', 'NOT_FOUND', 'VENDOR_NOT_FOUND', 'BOOKING_NOT_FOUND']);

export const isStaleError = (e: unknown): boolean => isApiError(e) && STALE_CODES.has(e.code);
