import { ApiError } from '@eventseva/app-shared';
import type { TFunction } from 'i18next';

export const errorCode = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : (e as { code?: string } | null)?.code);

export const isOffline = (e: unknown) => errorCode(e) === 'NETWORK';

export const isVendorMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.code === 'VENDOR_NOT_FOUND');

/** Error codes we explain in the app's own words (and language). */
const KNOWN: Record<string, string> = {
  NETWORK: 'errors.network',
  SLOT_TAKEN: 'errors.slotTaken',
  BOOKING_EXPIRED: 'errors.bookingExpired',
  VENDOR_NOT_ACTIVE: 'errors.vendorNotActive',
  BOOKING_BAD_STATUS: 'errors.bookingBadStatus',
  VENDOR_UNDER_REVIEW: 'errors.underReview',
  CATEGORY_LOCKED: 'errors.categoryLocked',
  VENDOR_INCOMPLETE: 'errors.incomplete',
  LIMIT_REACHED: 'errors.limitReached',
  DATE_IN_PAST: 'errors.dateInPast',
  OTP_EXPIRED: 'errors.otpExpired',
  OTP_LOCKED: 'errors.otpLocked',
  OTP_LIMIT: 'errors.otpLimit',
  INVALID_PHONE: 'errors.invalidPhone',
  USER_BLOCKED: 'errors.userBlocked',
  RATE_LIMITED: 'errors.rateLimited',
  UPLOAD_NOT_CONFIGURED: 'errors.uploadNotConfigured',
  UPLOAD_INVALID: 'errors.uploadInvalid',
  UPLOAD_FAILED: 'errors.uploadFailed',
  MEDIA_DUPLICATE: 'errors.mediaDuplicate',
  VIDEO_TOO_LONG: 'errors.videoTooLong',
  PLAN_NOT_FOUND: 'errors.planNotFound',
  PAYMENT_INVALID: 'errors.paymentInvalid',
};

/** The message to show for a failed call: our translation when we know the code, else the server's text. */
export function errorText(t: TFunction, e: unknown): string {
  const code = errorCode(e);
  if (code === 'OTP_INVALID' && e instanceof ApiError && typeof e.details.attemptsLeft === 'number') {
    return t('errors.otpInvalid', { left: e.details.attemptsLeft });
  }
  if (code === 'OTP_TOO_SOON' && e instanceof ApiError && typeof e.details.retryAfterSec === 'number') {
    return t('errors.otpTooSoon', { sec: e.details.retryAfterSec });
  }
  if (code === 'FILE_TOO_BIG') {
    const max = (e as { details?: { maxBytes?: unknown } }).details?.maxBytes;
    return typeof max === 'number' ? t('errors.fileTooBigMax', { mb: Math.round(max / 1_048_576) }) : t('errors.fileTooBig');
  }
  if (code && KNOWN[code]) return t(KNOWN[code]);
  if (e instanceof ApiError && e.message) return e.message;
  return t('errors.generic');
}
