// The API sends an English `message` and a stable `code`. Every code the customer app can meet
// (docs/API.md) has its own translated sentence saying what happened and what to do next; unknown
// codes fall back to a sentence chosen by HTTP status. Raw codes and server text are never shown.
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
  'BOOKING_BAD_TRANSITION',
  'CASH_BOOKING',
  'CASH_NOT_ACCEPTED',
  'CASH_NOT_AVAILABLE',
  'CASH_NOT_IN_CART',
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
  'ACCOUNT_HAS_ACTIVE_BOOKINGS',
  'ACCOUNT_HAS_PENDING_PAYOUT',
  'OTP_SERVICE_BUSY',
  'CITY_NOT_FOUND',
  'VALIDATION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'PARTNER_APP_ONLY',
  'TOO_LATE_TO_BOOK',
  'TOO_MANY_OPEN_REQUESTS',
  'QUANTITY_OUT_OF_RANGE',
  'DATE_TOO_FAR',
  'TOO_MANY_MESSAGES',
  // Rentals and other bookings by time.
  'NOT_AVAILABLE',
  'ITEMS_REQUIRED',
  'RENTAL_DAYS_OUT_OF_RANGE',
  'TIME_ORDER',
  'TOO_SOON',
  'DURATION_TOO_SHORT',
  'DURATION_TOO_LONG',
  'OUTSIDE_WORKING_HOURS',
  'OUTSIDE_EVENT_DATES',
  'BOOKING_IN_PROGRESS',
  'CHARGE_ALREADY_ANSWERED',
  'NOTHING_TO_PAY',
  // Services by time, cars, packages and changes.
  'SERVICE_NOT_FOUND',
  'USE_SLOT_BOOKING',
  'SERVICE_NOT_CONFIGURED',
  'ANSWER_REQUIRED',
  'ANSWER_INVALID',
  'ADDON_NOT_FOUND',
  'DATE_IN_PAST',
  'ROUTE_REQUIRED',
  'MODE_NOT_OFFERED',
  'VEHICLE_NOT_AVAILABLE',
  'NO_DRIVER',
  'LICENCE_REQUIRED',
  'LICENCE_EXPIRED',
  'TOO_YOUNG',
  'BUNDLE_NOT_FOUND',
  'BUNDLE_INCOMPLETE',
  'CHANGE_PENDING',
  'CHANGE_NOT_SUPPORTED',
  'INVOICE_NOT_READY',
] as const;

/** For codes this app does not know: a sentence by HTTP status. */
function byStatus(status: number) {
  if (status === 0) return 'errors.NETWORK' as const;
  if (status === 401) return 'errors.UNAUTHORIZED' as const;
  if (status === 403) return 'errors.FORBIDDEN' as const;
  if (status === 404) return 'errors.NOT_FOUND' as const;
  if (status === 409) return 'errors.CONFLICT' as const;
  if (status === 429) return 'errors.RATE_LIMITED' as const;
  if (status >= 500) return 'errors.SERVER' as const;
  if (status >= 400) return 'errors.VALIDATION' as const;
  return 'common.errorBody' as const;
}

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
    if (e.code === 'ACCOUNT_HAS_ACTIVE_BOOKINGS') return t('errors.ACCOUNT_HAS_ACTIVE_BOOKINGS', { count: typeof d.bookings === 'number' ? d.bookings : 1 });
    if (e.code === 'NOT_AVAILABLE' && typeof d.available === 'number') return t('errors.NOT_AVAILABLE_COUNT', { available: d.available });
    if (e.code === 'TOO_YOUNG') return t('errors.TOO_YOUNG', { minAge: typeof d.minAge === 'number' ? d.minAge : 21 });
    if (e.code === 'QUANTITY_OUT_OF_RANGE') {
      const range = typeof d.max === 'number'
        ? t('errors.RANGE_BETWEEN', { min: typeof d.min === 'number' ? d.min : 1, max: d.max })
        : t('errors.RANGE_AT_LEAST', { min: typeof d.min === 'number' ? d.min : 1 });
      return t('errors.QUANTITY_OUT_OF_RANGE', { range });
    }
    return t(`errors.${e.code}`, {
      max: typeof d.max === 'number' ? d.max : 15,
      attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
      seconds: typeof d.retryAfterSec === 'number' ? d.retryAfterSec : 30,
      count: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : 0,
    });
  }
  return t(byStatus(e.status));
}
