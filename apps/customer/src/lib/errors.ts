// The API sends an English `message` and a stable `code`. Known codes get the app's own
// (translated) text; anything else falls back to the server's message.
import { ApiError, formatDateTime, rupees } from '@eventseva/app-shared';
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
  'COUPON_INVALID',
  'COUPON_NOT_APPLICABLE',
  'COUPON_ALREADY_USED',
  'COUPON_USED_UP',
  'COUPON_NOT_ALLOWED',
] as const;

/** COUPON_NOT_APPLICABLE says why in `details.reason`; each reason has its own text. */
const COUPON_REASONS = {
  min_amount: 'coupon.reasons.minAmount',
  category: 'coupon.reasons.category',
  first_booking: 'coupon.reasons.firstBooking',
  zero: 'coupon.reasons.zero',
} as const;

type KnownError = (typeof KNOWN_ERRORS)[number];
const isKnown = (code: string): code is KnownError => (KNOWN_ERRORS as readonly string[]).includes(code);

export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof PaymentError) return t('payment.failed');
  if (!(e instanceof ApiError)) return t('common.errorBody');
  if (isKnown(e.code)) {
    const d = e.details;
    if (e.code === 'COUPON_NOT_APPLICABLE' && typeof d.reason === 'string' && d.reason in COUPON_REASONS) {
      const minAmountPaise = typeof d.minAmountPaise === 'number' ? d.minAmountPaise : 0;
      return t(COUPON_REASONS[d.reason as keyof typeof COUPON_REASONS], { amount: rupees(minAmountPaise) });
    }
    // Rolling 24-hour limit: say exactly when the next code is allowed.
    if (e.code === 'OTP_LIMIT' && typeof d.retryAt === 'string') return t('errors.OTP_LIMIT_UNTIL', { time: formatDateTime(d.retryAt) });
    return t(`errors.${e.code}`, {
      attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
      seconds: typeof d.retryAfterSec === 'number' ? d.retryAfterSec : 30,
      count: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
    });
  }
  return e.message || t('common.errorBody');
}
