// What a vendor configures on one service, beyond its price and rules: their own questions for the
// customer, the event types they serve, several rate plans (ways to book the same service), and price
// rules. Pure functions: the catalog checks the config with them, the engine applies it to a request.
//
// New categories need none of this code to change: an admin gives the category a booking type and a
// template, and vendors fill these settings in. A new kind of setting is added here, with a check
// (used when the vendor saves) and an apply step (used when a customer books), plus tests.
import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError } from '../common/errors';
import { EVENT_TYPES } from '../bookings/booking.rules';
import { checkFields, checkPricing, checkRules, istDay, VENDOR_RULE_KEYS } from './rules';
import type { FieldDef, Pricing, QuoteLine, RatePlan, RuleSet } from './types';

const bad = (message: string, field: string) => new AppError('VALIDATION', message, HttpStatus.BAD_REQUEST, { field });

export const MAX_VENDOR_QUESTIONS = 15;
export const MAX_PLANS = 6;
/** A choice's extra price a vendor may set on their own question. */
const MAX_CHOICE_PAISE = 5_000_000;

/** The vendor's own questions: like the category's, but their keys may not clash with them. */
export function checkVendorQuestions(fields: unknown, categoryQuestions: FieldDef[]): FieldDef[] {
  const list = checkFields(fields, 'questions');
  if (list.length > MAX_VENDOR_QUESTIONS) throw bad(`questions: up to ${MAX_VENDOR_QUESTIONS} of your own questions.`, 'questions');
  const taken = new Set(categoryQuestions.map((q) => q.key));
  for (const q of list) {
    if (taken.has(q.key)) throw bad(`questions.${q.key}: EventSeva already asks this; choose another key.`, `questions.${q.key}`);
    for (const o of q.options ?? []) {
      if ((o.pricePaise ?? 0) > MAX_CHOICE_PAISE) throw bad(`questions.${q.key}: a choice can add up to ₹50,000.`, `questions.${q.key}`);
    }
  }
  return list;
}

/** Event types the service is offered for; an empty list means every event. */
export function checkEventTypes(list: unknown): string[] {
  if (!Array.isArray(list) || list.length > EVENT_TYPES.length || list.some((e) => !(EVENT_TYPES as readonly string[]).includes(e)) || new Set(list).size !== list.length) {
    throw bad(`eventTypes: a list of known event types (${EVENT_TYPES.join(', ')}).`, 'eventTypes');
  }
  return list as string[];
}

/** Rate plans: 0 (the service's own price) or 2–6 named plans, each priced with an allowed model. */
export function checkPlans(list: unknown, allowedModels: readonly string[] | undefined, maxRatePaise: number): RatePlan[] {
  if (!Array.isArray(list) || list.length > MAX_PLANS) throw bad(`plans: up to ${MAX_PLANS} plans.`, 'plans');
  if (list.length === 1) throw bad('plans: add at least two plans, or none (the service price is used).', 'plans');
  const ids = new Set<string>();
  return list.map((p: RatePlan, i) => {
    const at = `plans.${i}`;
    if (!p || typeof p.id !== 'string' || !/^[a-z][a-z0-9_]{0,29}$/.test(p.id)) throw bad(`${at}.id: lowercase letters, digits and _.`, `${at}.id`);
    if (ids.has(p.id)) throw bad(`${at}.id: "${p.id}" appears twice.`, `${at}.id`);
    ids.add(p.id);
    // Reuse the field label check: a plan name is shown in both languages.
    checkFields([{ key: 'plan', label: p.name, type: 'text' }], at);
    if (p.description !== undefined) checkFields([{ key: 'plan', label: p.description, type: 'text' }], `${at}.description`);
    const pricing = checkPricing(p.pricing, allowedModels);
    if (pricing.ratePaise > maxRatePaise) throw bad(`${at}.pricing.ratePaise: at most ₹10 lakh.`, `${at}.pricing.ratePaise`);
    let rules: RuleSet | undefined;
    if (p.rules !== undefined) {
      const extra = Object.keys(p.rules ?? {}).find((k) => !VENDOR_RULE_KEYS.includes(k as keyof RuleSet));
      if (extra) throw bad(`${at}.rules.${extra} is set by EventSeva, not by the vendor.`, `${at}.rules.${extra}`);
      rules = checkRules(p.rules, `${at}.rules`);
    }
    return { id: p.id, name: p.name, ...(p.description ? { description: p.description } : {}), pricing, ...(rules ? { rules } : {}) };
  });
}

/** The plan a request asks for. A service with plans needs one; one without plans takes none. */
export function pickPlan(plans: RatePlan[] | null | undefined, planId: string | undefined): RatePlan | null {
  if (!plans?.length) {
    if (planId !== undefined) throw new AppError('RATE_PLAN_NOT_FOUND', 'This service has one price; no plan to choose.', HttpStatus.BAD_REQUEST, { field: 'planId' });
    return null;
  }
  if (planId === undefined) {
    throw new AppError('RATE_PLAN_REQUIRED', 'Choose how you want to book this service.', HttpStatus.BAD_REQUEST, { field: 'planId', plans: plans.map((p) => p.id) });
  }
  const plan = plans.find((p) => p.id === planId);
  if (!plan) throw new AppError('RATE_PLAN_NOT_FOUND', 'That booking option is not offered any more.', HttpStatus.BAD_REQUEST, { field: 'planId', plans: plans.map((p) => p.id) });
  return plan;
}

export function checkEventServed(eventTypes: string[] | null | undefined, eventType: string) {
  if (eventTypes?.length && !eventTypes.includes(eventType)) {
    throw new AppError('EVENT_TYPE_NOT_SERVED', 'This vendor does not offer this service for your kind of event.', HttpStatus.BAD_REQUEST, { eventTypes });
  }
}

/** Questions the customer answers: the category's, then the vendor's own. */
export const allQuestions = (category: FieldDef[] | undefined, vendor: FieldDef[] | null | undefined): FieldDef[] => [...(category ?? []), ...(vendor ?? [])];

/** A short, stable id of a question list, saved with each booking (which version was answered). */
export const schemaVersion = (fields: FieldDef[]) => createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 12);

/**
 * Price rule lines for a booking starting at `starts` for an event of `eventType`. Percent rules work on
 * the service's own price lines (before add-ons, travel, discounts and tax). Rules apply in order.
 */
export function adjustmentLines(pricing: Pricing, serviceLines: QuoteLine[], starts: Date, eventType: string): QuoteLine[] {
  const base = serviceLines.reduce((s, l) => s + l.amountPaise, 0);
  const day = istDay(starts);
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const out: QuoteLine[] = [];
  (pricing.adjustments ?? []).forEach((a, i) => {
    if (a.days && !a.days.includes(weekday)) return;
    if (a.from && day < a.from) return;
    if (a.until && day > a.until) return;
    if (a.eventTypes && !a.eventTypes.includes(eventType)) return;
    const amount = Math.round((base * (a.percent ?? 0)) / 100) + (a.amountPaise ?? 0);
    if (!amount) return;
    const label = a.percent ? `${a.label.en} (${a.percent > 0 ? '+' : ''}${a.percent}%)` : a.label.en;
    out.push({ code: `rule_${i}`, label, qty: 1, unitPaise: amount, amountPaise: amount, kind: amount < 0 ? 'fee' : 'extra' });
  });
  // A discount never takes the service below zero.
  const total = out.reduce((s, l) => s + l.amountPaise, 0);
  if (base + total < 0) out.push({ code: 'rule_floor', label: 'Price cannot go below zero', qty: 1, unitPaise: -(base + total), amountPaise: -(base + total), kind: 'fee' });
  return out;
}
