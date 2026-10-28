import { ApiError, formatDateTime } from '@eventseva/app-shared';
import type { TFunction } from 'i18next';

export const errorCode = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : (e as { code?: string } | null)?.code);

export const isOffline = (e: unknown) => errorCode(e) === 'NETWORK';

export const isVendorMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.code === 'VENDOR_NOT_FOUND');

/** Error codes we explain in the app's own words (and language). */
const KNOWN: Record<string, string> = {
  NETWORK: 'errors.network',
  SLOT_TAKEN: 'errors.slotTaken',
  DATE_TOO_FAR: 'errors.dateTooFar',
  PROGRESS_NOT_ALLOWED: 'errors.progressNotAllowed',
  TOO_MANY_MESSAGES: 'errors.tooManyMessages',
  BOOKING_EXPIRED: 'errors.bookingExpired',
  VENDOR_NOT_ACTIVE: 'errors.vendorNotActive',
  BOOKING_BAD_STATUS: 'errors.bookingBadStatus',
  BOOKING_BAD_TRANSITION: 'errors.bookingChanged',
  CODE_INVALID: 'errors.codeInvalid',
  TOO_MANY_ATTEMPTS: 'errors.codeTooManyAttempts',
  EVIDENCE_REQUIRED: 'errors.evidenceRequired',
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
  // Common codes (docs/API.md "Errors").
  VALIDATION: 'errors.validation',
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound',
  PARTNER_APP_ONLY: 'errors.partnerAppOnly',
  // Login and account.
  OTP_SERVICE_BUSY: 'errors.otpServiceBusy',
  CITY_NOT_FOUND: 'errors.cityNotFound',
  ACCOUNT_HAS_PENDING_PAYOUT: 'errors.accountPendingPayout',
  // Profile and catalogue.
  VENDOR_EXISTS: 'errors.vendorExists',
  VENDOR_NOT_FOUND: 'errors.vendorNotFound',
  VENDOR_BAD_STATUS: 'errors.vendorBadStatus',
  ITEM_NOT_FOUND: 'errors.itemNotFound',
  // Bookings and money (mostly customer-side, but they can reach a vendor through shared screens).
  BOOKING_EXISTS: 'errors.bookingExists',
  EVENT_IN_PAST: 'errors.dateInPast',
  EVENT_NOT_FOUND: 'errors.eventNotFound',
  OWN_VENDOR: 'errors.ownVendor',
  QUANTITY_REQUIRED: 'errors.quantityRequired',
  PAYMENT_TIME_OVER: 'errors.paymentTimeOver',
  PAYOUT_ALREADY_PAID: 'errors.payoutAlreadyPaid',
  REFUND_TOO_HIGH: 'errors.refundTooHigh',
  REVIEW_EXISTS: 'errors.reviewExists',
  REVIEW_NOT_ALLOWED: 'errors.reviewNotAllowed',
  COUPON_INVALID: 'errors.couponInvalid',
  COUPON_NOT_APPLICABLE: 'errors.couponNotApplicable',
  COUPON_NOT_ALLOWED: 'errors.couponNotAllowed',
  COUPON_ALREADY_USED: 'errors.couponAlreadyUsed',
  COUPON_USED_UP: 'errors.couponUsedUp',
  // Rental items, dispatch and return.
  NOT_AVAILABLE: 'errors.notAvailable',
  ITEM_EXISTS: 'errors.itemExists',
  CATEGORY_NOT_FOUND: 'errors.categoryNotFound',
  CATEGORY_EXISTS: 'errors.categoryExists',
  RETURN_COUNT_MISMATCH: 'errors.returnCountMismatch',
  CHARGE_TOO_HIGH: 'errors.chargeTooHigh',
  FULFILMENT_BAD_STEP: 'errors.fulfilmentBadStep',
  RETURN_NOT_COUNTED: 'errors.returnNotCounted',
  BOOKING_IN_PROGRESS: 'errors.bookingInProgress',
  ITEMS_REQUIRED: 'errors.itemsRequired',
  RENTAL_DAYS_OUT_OF_RANGE: 'errors.rentalDays',
  QUANTITY_OUT_OF_RANGE: 'errors.quantityOutOfRange',
  TIME_ORDER: 'errors.timeOrder',
  // Services by time, cars and trips.
  WRONG_SERVICE_KIND: 'errors.wrongServiceKind',
  GSTIN_REQUIRED: 'errors.gstinRequired',
  RESOURCE_REQUIRED: 'errors.resourceRequired',
  RESOURCE_NOT_FOUND: 'errors.resourceNotFound',
  VEHICLE_EXISTS: 'errors.vehicleExists',
  LICENCE_EXPIRED: 'errors.licenceExpired',
  RESOURCE_BOOKED: 'errors.resourceBooked',
  SERVICE_NOT_FOUND: 'errors.serviceNotFound',
  QUOTE_PRICE_REQUIRED: 'errors.quotePriceRequired',
  ADDON_DECISION_REQUIRED: 'errors.addonDecisionRequired',
  DRIVER_NOT_FOUND: 'errors.driverNotFound',
  DRIVER_BUSY: 'errors.driverBusy',
  SELF_DRIVE: 'errors.selfDrive',
  TOO_EARLY: 'errors.tooEarly',
  DRIVER_REQUIRED: 'errors.driverRequired',
  LICENCE_NOT_VERIFIED: 'errors.licenceNotVerified',
  DEPOSIT_REQUIRED: 'errors.depositRequired',
  ODOMETER_BELOW_START: 'errors.odometerBelowStart',
  INVOICE_NOT_READY: 'errors.invoiceNotReady',
  ANSWER_REQUIRED: 'errors.answerRequired',
  ANSWER_INVALID: 'errors.answerInvalid',
  // Found on the phone before uploading.
  UNSUPPORTED_FILE: 'errors.unsupportedFile',
  CANCELLED: 'upload.cancelledOne',
};

/** Every API error code the app explains in its own words (tested against docs/API.md). */
export const KNOWN_CODES = [...Object.keys(KNOWN), 'OTP_INVALID', 'OTP_TOO_SOON', 'FILE_TOO_BIG', 'ACCOUNT_HAS_ACTIVE_BOOKINGS', 'STOCK_COMMITTED'];

/** The message to show for a failed call: our translation when we know the code, else the server's text. */
export function errorText(t: TFunction, e: unknown): string {
  const code = errorCode(e);
  if (code === 'OTP_INVALID' && e instanceof ApiError && typeof e.details.attemptsLeft === 'number') {
    return t('errors.otpInvalid', { left: e.details.attemptsLeft });
  }
  if (code === 'OTP_TOO_SOON' && e instanceof ApiError && typeof e.details.retryAfterSec === 'number') {
    return t('errors.otpTooSoon', { sec: e.details.retryAfterSec });
  }
  // Rolling 24-hour limit: say exactly when the next code is allowed.
  if (code === 'OTP_LIMIT' && e instanceof ApiError && typeof e.details.retryAt === 'string') {
    return t('errors.otpLimitUntil', { time: formatDateTime(e.details.retryAt) });
  }
  if (code === 'FILE_TOO_BIG') {
    const max = (e as { details?: { maxBytes?: unknown } }).details?.maxBytes;
    return typeof max === 'number' ? t('errors.fileTooBigMax', { mb: Math.round(max / 1_048_576) }) : t('errors.fileTooBig');
  }
  if (code === 'ACCOUNT_HAS_ACTIVE_BOOKINGS') {
    const n = e instanceof ApiError && typeof e.details.bookings === 'number' ? e.details.bookings : 0;
    return n ? t('errors.accountActiveBookings', { count: n }) : t('errors.accountActiveBookingsNoCount');
  }
  if (code === 'LIMIT_REACHED') {
    const limit = (e as { details?: { limit?: unknown } }).details?.limit;
    if (limit === 'videos') return t('errors.limitVideos');
    if (limit === 'photos') return t('errors.limitPhotos');
  }
  // Stock cut below what bookings hold: say the lowest total that works.
  if (code === 'STOCK_COMMITTED') {
    const min = e instanceof ApiError ? e.details.minTotalQty : undefined;
    return t('errors.stockCommitted', { minTotalQty: typeof min === 'number' ? min : '' });
  }
  if (code && KNOWN[code]) return t(KNOWN[code]);
  // A server error we have no words for: say so plainly, never "Error 500".
  if (e instanceof ApiError && e.status >= 500) return t('errors.server');
  // The API writes its messages as full sentences in the vendor's language (Accept-Language).
  if (e instanceof ApiError && e.message) return e.message;
  return t('errors.generic');
}
