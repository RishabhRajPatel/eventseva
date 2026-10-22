import { toPaise } from '@eventseva/core';

/** The API refuses prices under ₹1. */
export const MIN_PRICE_PAISE = 100;
/** And over ₹10 lakh. */
export const MAX_PRICE_PAISE = 100_000_000;

/**
 * Vendors type prices in rupees ("1,500" or "1500.50"); the API wants paise.
 * Returns null when the text is not a usable amount.
 */
export function rupeesInputToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const paise = toPaise(Number(cleaned));
  return Number.isFinite(paise) ? paise : null;
}

export type PriceCheck = { ok: true; paise: number } | { ok: false; reason: 'empty' | 'invalid' | 'tooLow' | 'tooHigh' };

export function checkPrice(input: string): PriceCheck {
  if (!input.trim()) return { ok: false, reason: 'empty' };
  const paise = rupeesInputToPaise(input);
  if (paise === null) return { ok: false, reason: 'invalid' };
  if (paise < MIN_PRICE_PAISE) return { ok: false, reason: 'tooLow' };
  if (paise > MAX_PRICE_PAISE) return { ok: false, reason: 'tooHigh' };
  return { ok: true, paise };
}

/** Paise back to what goes in the text box: 150000 → "1500", 150050 → "1500.50". */
export function paiseToRupeesInput(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}
