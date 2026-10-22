// Rupee amounts typed into forms, and how much of a booking can still be refunded.

/**
 * "1,500" / "₹ 1500.50" → paise (150050). null when it is not a plain amount with at most 2 decimals.
 * Forms take rupees; the API takes paise.
 */
export function rupeesToPaise(input: string): number | null {
  const text = input.trim().replace(/^₹\s*/, '').replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** paise → what a rupee input shows: 150050 → "1500.5", 50000 → "500". */
export const paiseToRupeesInput = (paise: number): string => String(paise / 100);

interface RefundableBooking {
  refundPaise: number;
  payments: Array<{ type: string; status: string; amountPaise: number }>;
}

/** Paid advance minus what was already refunded (same rule as adminRefund on the API). */
export function paidAdvancePaise(b: RefundableBooking): number {
  return b.payments.find((p) => p.type === 'advance' && p.status === 'paid')?.amountPaise ?? 0;
}

export function maxRefundablePaise(b: RefundableBooking): number {
  return Math.max(0, paidAdvancePaise(b) - b.refundPaise);
}

export const REFUND_REASON = { min: 5, max: 300 } as const;

export interface RefundForm {
  amount: string;
  reason: string;
}

export function refundFormErrors(f: RefundForm, maxPaise: number): Partial<Record<keyof RefundForm, string>> {
  const e: Partial<Record<keyof RefundForm, string>> = {};
  const paise = rupeesToPaise(f.amount);
  if (paise === null) e.amount = 'Enter an amount in rupees, e.g. 500 or 499.50.';
  else if (paise < 100) e.amount = 'The smallest refund is ₹1.';
  else if (paise > maxPaise) e.amount = `At most ₹${maxPaise / 100} can still be refunded.`;
  const reason = f.reason.trim().length;
  if (reason < REFUND_REASON.min || reason > REFUND_REASON.max) e.reason = `Reason must be ${REFUND_REASON.min}–${REFUND_REASON.max} characters.`;
  return e;
}

/** How much more can come off the vendor's payout: their share (advance − commission) minus earlier deductions. */
export function maxDeductionPaise(b: { advancePaise: number; commissionPaise: number; payoutDeductionPaise: number }): number {
  return Math.max(0, b.advancePaise - b.commissionPaise - b.payoutDeductionPaise);
}
