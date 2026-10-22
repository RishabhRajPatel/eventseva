// Shared between backend, customer app, Partner app and admin panel.

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

export const APPS = ['customer', 'partner'] as const;
export type AppName = (typeof APPS)[number];

export const BOOKING_STATUSES = [
  'requested',
  'accepted',
  'rejected',
  'expired',
  'confirmed',
  'completed',
  'cancelled_by_customer',
  'cancelled_by_vendor',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const VENDOR_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'on_hold'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** Money is always stored and sent in paise (₹1 = 100) to avoid decimal errors. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => paise / 100;

export interface ApiError {
  error: { code: string; message: string };
}
