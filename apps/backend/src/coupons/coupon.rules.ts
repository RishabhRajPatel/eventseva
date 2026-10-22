// How much a coupon takes off. Kept free of the database so the rules are easy to test.

export interface CouponTerms {
  discount_type: 'percent' | 'flat';
  discount_value: number;
  max_discount_paise: number | null;
}

/**
 * Percent coupons work on the booking price; flat ones are paise. The discount comes off the
 * advance paid in the app, so it can never be more than that advance minus ₹1 (Razorpay needs a
 * real payment to confirm the booking).
 */
export function discountFor(c: CouponTerms, amountPaise: number, advancePaise: number): number {
  let d = c.discount_type === 'percent' ? Math.round((amountPaise * c.discount_value) / 100) : c.discount_value;
  if (c.max_discount_paise !== null) d = Math.min(d, c.max_discount_paise);
  return Math.max(0, Math.min(d, advancePaise - 100));
}

/** "10% off, up to ₹500" / "₹300 off" for offer lists and admin tables. */
export function describeCoupon(c: CouponTerms, lang: 'en' | 'hi' = 'en'): string {
  const r = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
  if (c.discount_type === 'flat') return lang === 'hi' ? `${r(c.discount_value)} की छूट` : `${r(c.discount_value)} off`;
  const cap = c.max_discount_paise ? (lang === 'hi' ? `, ज़्यादा से ज़्यादा ${r(c.max_discount_paise)}` : `, up to ${r(c.max_discount_paise)}`) : '';
  return lang === 'hi' ? `${c.discount_value}% की छूट${cap}` : `${c.discount_value}% off${cap}`;
}
