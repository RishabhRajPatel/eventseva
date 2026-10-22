// City and featured-plan forms (same limits as CityDto / PlanDto) and free featured days.
import { rupeesToPaise } from './money.ts';

const len = (v: string, min: number, max: number) => v.trim().length >= min && v.trim().length <= max;

export interface CityForm {
  name: string;
  nameHi: string;
  state: string;
}

export function cityFormErrors(f: CityForm): Partial<Record<keyof CityForm, string>> {
  const e: Partial<Record<keyof CityForm, string>> = {};
  if (!len(f.name, 2, 60)) e.name = 'Enter the city name (2–60 characters).';
  if (!len(f.nameHi, 2, 60)) e.nameHi = 'Enter the Hindi name (2–60 characters).';
  if (!len(f.state, 2, 60)) e.state = 'Enter the state (2–60 characters).';
  return e;
}

export interface PlanForm {
  nameEn: string;
  nameHi: string;
  days: string;
  /** Rupees. */
  price: string;
}

export function planFormErrors(f: PlanForm, creating: boolean): Partial<Record<keyof PlanForm, string>> {
  const e: Partial<Record<keyof PlanForm, string>> = {};
  if (!len(f.nameEn, 2, 60)) e.nameEn = 'Enter the English name (2–60 characters).';
  if (!len(f.nameHi, 2, 60)) e.nameHi = 'Enter the Hindi name (2–60 characters).';
  if (creating && !(/^\d+$/.test(f.days.trim()) && Number(f.days) >= 1 && Number(f.days) <= 365)) e.days = 'Enter 1 to 365 days.';
  const price = rupeesToPaise(f.price);
  if (price === null || price < 100 || price > 100_000_000) e.price = 'Enter a price from ₹1 to ₹10,00,000.';
  return e;
}

export interface GrantForm {
  days: string;
  reason: string;
}

export function grantFormErrors(f: GrantForm): Partial<Record<keyof GrantForm, string>> {
  const e: Partial<Record<keyof GrantForm, string>> = {};
  if (!(/^\d+$/.test(f.days.trim()) && Number(f.days) >= 1 && Number(f.days) <= 365)) e.days = 'Enter 1 to 365 days.';
  if (!len(f.reason, 3, 300)) e.reason = 'Reason must be 3–300 characters.';
  return e;
}
