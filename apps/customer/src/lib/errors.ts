// The API sends an English `message` and a stable `code`. Known codes get the app's own
// (translated) text; anything else falls back to the server's message.
import { ApiError } from '@eventseva/app-shared';
import type { TFunction } from 'i18next';
import { PaymentError } from './payments';

export const KNOWN_ERRORS = [
  'NETWORK',
  'INVALID_PHONE',
  'OTP_TOO_SOON',
  'OTP_LIMIT',
  'OTP_LOCKED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'USER_BLOCKED',
  'RATE_LIMITED',
  'SLOT_TAKEN',
  'BOOKING_EXISTS',
  'OWN_VENDOR',
  'ITEM_NOT_FOUND',
  'EVENT_NOT_FOUND',
  'EVENT_IN_PAST',
  'QUANTITY_REQUIRED',
  'AMOUNT_TOO_HIGH',
  'VENDOR_NOT_FOUND',
  'BOOKING_BAD_STATUS',
  'BOOKING_EXPIRED',
  'PAYMENT_TIME_OVER',
  'PAYMENT_INVALID',
  'REVIEW_NOT_ALLOWED',
  'REVIEW_EXISTS',
] as const;

type KnownError = (typeof KNOWN_ERRORS)[number];
const isKnown = (code: string): code is KnownError => (KNOWN_ERRORS as readonly string[]).includes(code);

export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof PaymentError) return t('payment.failed');
  if (!(e instanceof ApiError)) return t('common.errorBody');
  if (isKnown(e.code)) {
    const d = e.details;
    return t(`errors.${e.code}`, {
      attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
      seconds: typeof d.retryAfterSec === 'number' ? d.retryAfterSec : 30,
      count: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
    });
  }
  return e.message || t('common.errorBody');
}
