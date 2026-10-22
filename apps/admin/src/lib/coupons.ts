// Coupon form rules (same limits as CreateCouponDto / UpdateCouponDto) and display text.
import { rupeesToPaise } from './money.ts';

export type DiscountType = 'percent' | 'flat';

export interface AdminCouponSummaryInput {
  discountType: DiscountType;
  discountValue: number;
  maxDiscountPaise: number | null;
}

/** "10% off, up to ₹500" / "₹300 off". `fmt` formats paise (rupees() in the app). */
export function couponSummary(c: AdminCouponSummaryInput, fmt: (paise: number) => string): string {
  if (c.discountType === 'flat') return `${fmt(c.discountValue)} off`;
  return `${c.discountValue}% off${c.maxDiscountPaise ? `, up to ${fmt(c.maxDiscountPaise)}` : ''}`;
}

/** 'YYYY-MM-DD' in India → the ISO instant the day starts / ends. */
export const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`).toISOString();
export const istDayEnd = (day: string) => new Date(`${day}T23:59:59+05:30`).toISOString();

/** ISO instant → 'YYYY-MM-DD' in India, for a date input. */
export function istDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export interface CouponForm {
  code: string;
  titleEn: string;
  titleHi: string;
  discountType: DiscountType;
  /** Percent (1–100), or rupees for flat. */
  value: string;
  /** Rupees; percent only, optional. */
  maxDiscount: string;
  /** Rupees, optional. */
  minAmount: string;
  /** '' = every category. */
  categoryId: string;
  firstBookingOnly: boolean;
  isPublic: boolean;
  maxUses: string;
  perCustomerLimit: string;
  /** 'YYYY-MM-DD', optional (empty = from now). */
  validFrom: string;
  /** 'YYYY-MM-DD', optional (empty = no end). */
  validUntil: string;
}

export const EMPTY_COUPON: CouponForm = {
  code: '',
  titleEn: '',
  titleHi: '',
  discountType: 'percent',
  value: '',
  maxDiscount: '',
  minAmount: '',
  categoryId: '',
  firstBookingOnly: false,
  isPublic: true,
  maxUses: '',
  perCustomerLimit: '1',
  validFrom: '',
  validUntil: '',
};

export type CouponErrors = Partial<Record<keyof CouponForm, string>>;

const isWhole = (v: string) => /^\d+$/.test(v.trim());
const titleOk = (v: string) => v.trim().length >= 2 && v.trim().length <= 80;

/** Code shown while typing: capitals and digits only, at most 20. */
export const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

export function couponFormErrors(f: CouponForm): CouponErrors {
  const e: CouponErrors = {};
  if (!/^[A-Z0-9]{3,20}$/.test(f.code.trim().toUpperCase())) e.code = 'Use 3–20 letters or digits, e.g. SHAADI10.';
  if (!titleOk(f.titleEn)) e.titleEn = 'Enter the English title (2–80 characters).';
  if (!titleOk(f.titleHi)) e.titleHi = 'Enter the Hindi title (2–80 characters).';
  if (f.discountType === 'percent') {
    const n = Number(f.value);
    if (!isWhole(f.value) || n < 1 || n > 100) e.value = 'Enter a whole percent from 1 to 100.';
    if (f.maxDiscount.trim()) {
      const max = rupeesToPaise(f.maxDiscount);
      if (max === null || max < 100) e.maxDiscount = 'Enter at least ₹1, or leave empty for no cap.';
    }
  } else {
    const paise = rupeesToPaise(f.value);
    if (paise === null || paise < 100) e.value = 'Enter the discount in rupees (at least ₹1).';
    else if (paise > 10_000_000) e.value = 'At most ₹1,00,000.';
  }
  if (f.minAmount.trim() && rupeesToPaise(f.minAmount) === null) e.minAmount = 'Enter rupees, or leave empty.';
  if (f.maxUses.trim() && (!isWhole(f.maxUses) || Number(f.maxUses) < 1)) e.maxUses = 'Enter a whole number (1 or more), or leave empty.';
  const per = Number(f.perCustomerLimit);
  if (!isWhole(f.perCustomerLimit) || per < 1 || per > 100) e.perCustomerLimit = 'Enter 1 to 100.';
  if (f.validFrom && f.validUntil && f.validUntil < f.validFrom) e.validUntil = 'The end date must be on or after the start date.';
  return e;
}

/** POST /v1/admin/coupons body. Call only when couponFormErrors is empty. */
export function couponBody(f: CouponForm) {
  const percent = f.discountType === 'percent';
  return {
    code: f.code.trim().toUpperCase(),
    titleEn: f.titleEn.trim(),
    titleHi: f.titleHi.trim(),
    discountType: f.discountType,
    discountValue: percent ? Number(f.value) : rupeesToPaise(f.value)!,
    ...(percent && f.maxDiscount.trim() ? { maxDiscountPaise: rupeesToPaise(f.maxDiscount)! } : {}),
    ...(f.minAmount.trim() ? { minAmountPaise: rupeesToPaise(f.minAmount)! } : {}),
    ...(f.categoryId ? { categoryId: Number(f.categoryId) } : {}),
    firstBookingOnly: f.firstBookingOnly,
    isPublic: f.isPublic,
    ...(f.maxUses.trim() ? { maxUses: Number(f.maxUses) } : {}),
    perCustomerLimit: Number(f.perCustomerLimit),
    ...(f.validFrom ? { validFrom: istDayStart(f.validFrom) } : {}),
    ...(f.validUntil ? { validUntil: istDayEnd(f.validUntil) } : {}),
  };
}

/** What can change after creation (the code and discount are fixed). */
export interface CouponEditForm {
  titleEn: string;
  titleHi: string;
  isActive: boolean;
  isPublic: boolean;
  maxUses: string;
  validUntil: string;
}

export function couponEditErrors(f: CouponEditForm): Partial<Record<keyof CouponEditForm, string>> {
  const e: Partial<Record<keyof CouponEditForm, string>> = {};
  if (!titleOk(f.titleEn)) e.titleEn = 'Enter the English title (2–80 characters).';
  if (!titleOk(f.titleHi)) e.titleHi = 'Enter the Hindi title (2–80 characters).';
  if (f.maxUses.trim() && (!isWhole(f.maxUses) || Number(f.maxUses) < 1)) e.maxUses = 'Enter a whole number (1 or more), or leave empty.';
  return e;
}

/** PATCH body. Empty max uses / end date leave the current value (the API cannot clear them). */
export function couponEditBody(f: CouponEditForm) {
  return {
    titleEn: f.titleEn.trim(),
    titleHi: f.titleHi.trim(),
    isActive: f.isActive,
    isPublic: f.isPublic,
    ...(f.maxUses.trim() ? { maxUses: Number(f.maxUses) } : {}),
    ...(f.validUntil ? { validUntil: istDayEnd(f.validUntil) } : {}),
  };
}
