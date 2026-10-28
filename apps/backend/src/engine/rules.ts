// Rules: defaults per booking type, merging category template → service overrides, and checks that
// hold for every booking type (times, durations, quantities, answers). Pure functions: easy to test.
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors';
import {
  BOOKING_TYPES,
  PRICING_MODELS,
  RESOURCE_KINDS,
  type BookingTypeKey,
  type CancellationPolicy,
  type CategoryTemplate,
  FIELD_TYPES,
  type FieldDef,
  type PriceAdjustment,
  type Pricing,
  type RuleSet,
} from './types';
import { EVENT_TYPES } from '../bookings/booking.rules';

export const DEFAULT_CANCELLATION: CancellationPolicy = {
  customer: [
    { minDays: 15, percent: 90 },
    { minDays: 7, percent: 50 },
    { minDays: 0, percent: 0 },
  ],
  vendorPercent: 100,
};

/** Sensible defaults per booking type; a category template and then the vendor can change them. */
export const TYPE_DEFAULTS: Record<BookingTypeKey, RuleSet> = {
  slot: {},
  time_window: { minDurationMin: 60, maxDurationMin: 3 * 24 * 60, setupMin: 60, dismantleMin: 60, approval: 'vendor', leadTimeHours: 6 },
  rental: { minDurationMin: 60, maxDurationMin: 14 * 24 * 60, bufferAfterMin: 4 * 60, approval: 'vendor', leadTimeHours: 12 },
  per_person: { minDurationMin: 60, maxDurationMin: 24 * 60, minQty: 25, maxQty: 5000, setupMin: 120, approval: 'vendor', leadTimeHours: 24 },
  staffing: { minDurationMin: 4 * 60, maxDurationMin: 24 * 60, minQty: 1, maxQty: 100, approval: 'vendor', leadTimeHours: 12 },
  appointment: { perPersonMin: 60, minQty: 1, maxQty: 20, bufferAfterMin: 30, approval: 'vendor', leadTimeHours: 12 },
  transport: { minDurationMin: 2 * 60, maxDurationMin: 7 * 24 * 60, setupMin: 60, bufferAfterMin: 120, approval: 'vendor', leadTimeHours: 6, minAge: 21 },
  quote: { approval: 'vendor', leadTimeHours: 24 },
};

/** Keys a vendor may set on their own service (the rest stay as the admin's category template says). */
export const VENDOR_RULE_KEYS: (keyof RuleSet)[] = [
  'minDurationMin', 'maxDurationMin', 'minQty', 'maxQty', 'workingHours', 'leadTimeHours', 'setupMin', 'dismantleMin',
  'bufferAfterMin', 'deposit', 'approval', 'capacity', 'perPersonMin', 'minAge', 'instructions',
  'workingDays', 'blockedDates', 'maxAdvanceDays', 'maxPerDay', 'breaks', 'maxConcurrent',
];

export function effectiveRules(type: BookingTypeKey, template: CategoryTemplate, serviceRules: RuleSet): RuleSet {
  const vendor: RuleSet = {};
  for (const k of VENDOR_RULE_KEYS) if (serviceRules[k] !== undefined) (vendor as Record<string, unknown>)[k] = serviceRules[k];
  return { ...TYPE_DEFAULTS[type], ...(template.rules ?? {}), ...vendor };
}

// ---------- validation of admin templates and vendor configuration ----------

const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown) => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const isWeekdays = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 7 && v.every((d) => isInt(d, 0, 6)) && new Set(v).size === v.length;
const bad = (message: string, field?: string) => new AppError('VALIDATION', message, HttpStatus.BAD_REQUEST, field ? { field } : undefined);

function checkBilingual(v: unknown, where: string, max = 80) {
  const b = v as { en?: unknown; hi?: unknown };
  if (!b || typeof b.en !== 'string' || typeof b.hi !== 'string' || !b.en.trim() || !b.hi.trim() || b.en.length > max || b.hi.length > max || UNSAFE.test(b.en) || UNSAFE.test(b.hi)) {
    throw bad(`${where}: label needs English and Hindi text (up to ${max} characters, no < > or control characters).`, where);
  }
}

/** Labels and answers are plain text: no markup, no control characters. Apps never render HTML. */
const UNSAFE = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a question is asked, given the answers before it. */
export function isShown(f: FieldDef, answers: Record<string, unknown>): boolean {
  if (!f.showIf) return true;
  const given = answers[f.showIf.key];
  const list = Array.isArray(given) ? given : [given];
  return list.some((v) => f.showIf!.values.includes(v as string | boolean));
}

export function checkFields(fields: unknown, where: string): FieldDef[] {
  if (fields === undefined) return [];
  if (!Array.isArray(fields) || fields.length > 40) throw bad(`${where}: a list of up to 40 fields is expected.`, where);
  const keys = new Set<string>();
  for (const f of fields as FieldDef[]) {
    if (!f || typeof f.key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(f.key)) throw bad(`${where}: field keys are lowercase letters, digits and _.`, where);
    if (keys.has(f.key)) throw bad(`${where}: "${f.key}" appears twice.`, where);
    keys.add(f.key);
    checkBilingual(f.label, `${where}.${f.key}`);
    if (!(FIELD_TYPES as readonly string[]).includes(f.type)) throw bad(`${where}.${f.key}: unknown type.`, where);
    if (f.help !== undefined) checkBilingual(f.help, `${where}.${f.key}.help`, 200);
    if (f.maxLength !== undefined && !isInt(f.maxLength, 1, f.type === 'longtext' ? 4000 : 2000)) throw bad(`${where}.${f.key}: maxLength too long.`, where);
    if (f.showIf !== undefined) {
      // Only an earlier question can decide, so the form reads top to bottom and never loops.
      const s = f.showIf;
      if (!s || typeof s.key !== 'string' || !keys.has(s.key) || s.key === f.key || !Array.isArray(s.values) || !s.values.length || s.values.length > 20
        || s.values.some((v) => typeof v !== 'string' && typeof v !== 'boolean')) {
        throw bad(`${where}.${f.key}.showIf: an earlier question and the answers that show this one.`, where);
      }
    }
    if ((f.type === 'select' || f.type === 'multiselect') && (!Array.isArray(f.options) || !f.options.length || f.options.length > 50)) {
      throw bad(`${where}.${f.key}: choices are needed.`, where);
    }
    for (const o of f.options ?? []) {
      if (typeof o.value !== 'string' || !o.value) throw bad(`${where}.${f.key}: every choice needs a value.`, where);
      checkBilingual(o.label, `${where}.${f.key}.${o.value}`);
      if (o.pricePaise !== undefined && !isInt(o.pricePaise, 0, 10_000_000)) throw bad(`${where}.${f.key}: choice price must be paise.`, where);
    }
  }
  return fields as FieldDef[];
}

export function checkRules(r: unknown, where = 'rules'): RuleSet {
  if (r === undefined || r === null) return {};
  if (typeof r !== 'object' || Array.isArray(r)) throw bad(`${where} must be an object.`, where);
  const rules = r as RuleSet;
  const minutes = ['minDurationMin', 'maxDurationMin', 'setupMin', 'dismantleMin', 'bufferAfterMin', 'perPersonMin'] as const;
  for (const k of minutes) if (rules[k] !== undefined && !isInt(rules[k], 0, 60 * 24 * 60)) throw bad(`${where}.${k}: whole minutes expected.`, k);
  for (const k of ['minQty', 'maxQty', 'capacity', 'leadTimeHours', 'minAge'] as const) {
    if (rules[k] !== undefined && !isInt(rules[k], 0, 1_000_000)) throw bad(`${where}.${k}: a whole number is expected.`, k);
  }
  if (rules.workingDays !== undefined && !isWeekdays(rules.workingDays)) throw bad(`${where}.workingDays: days 0 (Sunday) to 6, each once.`, 'workingDays');
  if (rules.blockedDates !== undefined && (!Array.isArray(rules.blockedDates) || rules.blockedDates.length > 366 || !rules.blockedDates.every(isDay))) {
    throw bad(`${where}.blockedDates: up to 366 dates as YYYY-MM-DD.`, 'blockedDates');
  }
  if (rules.maxAdvanceDays !== undefined && !isInt(rules.maxAdvanceDays, 1, 730)) throw bad(`${where}.maxAdvanceDays: 1–730 days.`, 'maxAdvanceDays');
  if (rules.maxPerDay !== undefined && !isInt(rules.maxPerDay, 1, 1000)) throw bad(`${where}.maxPerDay: 1–1000.`, 'maxPerDay');
  if (rules.maxConcurrent !== undefined && !isInt(rules.maxConcurrent, 1, 100)) throw bad(`${where}.maxConcurrent: 1–100.`, 'maxConcurrent');
  if (rules.breaks !== undefined) {
    const list = rules.breaks;
    if (!Array.isArray(list) || list.length > 5 || list.some((b) => !b || !HHMM.test(b.from) || !HHMM.test(b.to) || b.from >= b.to)) {
      throw bad(`${where}.breaks: up to 5 daily breaks, each HH:MM to a later HH:MM.`, 'breaks');
    }
  }
  if (rules.minDurationMin !== undefined && rules.maxDurationMin !== undefined && rules.minDurationMin > rules.maxDurationMin) {
    throw bad(`${where}: the minimum duration is longer than the maximum.`, 'minDurationMin');
  }
  if (rules.minQty !== undefined && rules.maxQty !== undefined && rules.minQty > rules.maxQty) throw bad(`${where}: minimum quantity is more than the maximum.`, 'minQty');
  if (rules.workingHours && (!HHMM.test(rules.workingHours.from) || !HHMM.test(rules.workingHours.to))) throw bad(`${where}.workingHours: HH:MM expected.`, 'workingHours');
  if (rules.advance) {
    const { percent, fixedPaise } = rules.advance;
    if (percent !== undefined && !isInt(percent, 1, 100)) throw bad(`${where}.advance.percent: 1–100.`, 'advance');
    if (fixedPaise !== undefined && !isInt(fixedPaise, 100)) throw bad(`${where}.advance.fixedPaise: paise.`, 'advance');
  }
  if (rules.deposit) {
    const { percent, fixedPaise } = rules.deposit;
    if (percent !== undefined && !isInt(percent, 0, 100)) throw bad(`${where}.deposit.percent: 0–100.`, 'deposit');
    if (fixedPaise !== undefined && !isInt(fixedPaise, 0, 100_000_000)) throw bad(`${where}.deposit.fixedPaise: paise.`, 'deposit');
  }
  if (rules.approval !== undefined && !['vendor', 'auto'].includes(rules.approval)) throw bad(`${where}.approval: vendor or auto.`, 'approval');
  if (rules.cancellation) checkPolicy(rules.cancellation, `${where}.cancellation`);
  if (rules.instructions !== undefined && (typeof rules.instructions !== 'string' || rules.instructions.length > 1000)) throw bad(`${where}.instructions: up to 1000 characters.`, 'instructions');
  return rules;
}

export function checkPolicy(p: CancellationPolicy, where: string) {
  if (!p || !Array.isArray(p.customer) || !p.customer.length || !isInt(p.vendorPercent, 0, 100)) throw bad(`${where}: customer tiers and vendorPercent are needed.`, where);
  const tiers = [...p.customer].sort((a, b) => b.minDays - a.minDays);
  if (tiers.at(-1)!.minDays !== 0) throw bad(`${where}: the last tier must start at 0 days.`, where);
  let last = 101;
  for (const t of tiers) {
    if (!isInt(t.minDays, 0, 365) || !isInt(t.percent, 0, 100)) throw bad(`${where}: tiers need whole days and 0–100 %.`, where);
    if (t.percent > last) throw bad(`${where}: refunds cannot grow closer to the event.`, where);
    last = t.percent;
  }
}

export function checkPricing(p: unknown, allowed: readonly string[] = PRICING_MODELS): Pricing {
  const pr = p as Pricing;
  if (!pr || typeof pr !== 'object') throw bad('pricing is required for this kind of service.', 'pricing');
  if (!allowed.includes(pr.model)) throw bad(`pricing.model must be one of: ${allowed.join(', ')}.`, 'pricing.model');
  // per_unit services (rentals) may price only their items; quotes have no rate until the vendor answers.
  const minRate = pr.model === 'per_unit' ? 0 : 100;
  if (pr.model !== 'quote' && !isInt(pr.ratePaise, minRate, 1_000_000_000)) throw bad('pricing.ratePaise: at least ₹1, in paise.', 'pricing.ratePaise');
  for (const k of ['minChargePaise', 'overtimeHourPaise', 'extraKmPaise', 'driverDayPaise', 'dayRatePaise', 'travelPerKmPaise', 'earlyMorningPaise'] as const) {
    if (pr[k] !== undefined && !isInt(pr[k], 0, 1_000_000_000)) throw bad(`pricing.${k}: paise.`, `pricing.${k}`);
  }
  for (const k of ['includedHours', 'includedKm', 'travelFreeKm'] as const) if (pr[k] !== undefined && !isInt(pr[k], 0, 100_000)) throw bad(`pricing.${k}: a whole number.`, `pricing.${k}`);
  if (pr.taxPercent !== undefined && ![0, 5, 12, 18, 28].includes(pr.taxPercent)) throw bad('pricing.taxPercent: 0, 5, 12, 18 or 28.', 'pricing.taxPercent');
  if (pr.adjustments !== undefined) checkAdjustments(pr.adjustments);
  return { ...pr, ratePaise: pr.model === 'quote' ? 0 : pr.ratePaise };
}

/** Price rules a vendor sets: at most 20, each with a label, a change, and known conditions. */
export function checkAdjustments(list: unknown): PriceAdjustment[] {
  const where = 'pricing.adjustments';
  if (!Array.isArray(list) || list.length > 20) throw bad(`${where}: up to 20 price rules.`, where);
  list.forEach((a: PriceAdjustment, i) => {
    const at = `${where}.${i}`;
    if (!a || typeof a !== 'object') throw bad(`${at}: a price rule is expected.`, at);
    checkBilingual(a.label, at);
    const known = ['label', 'days', 'from', 'until', 'eventTypes', 'percent', 'amountPaise'];
    const extra = Object.keys(a).find((k) => !known.includes(k));
    if (extra) throw bad(`${at}.${extra}: not a price rule setting.`, at);
    if (a.percent === undefined && a.amountPaise === undefined) throw bad(`${at}: set a percent or an amount.`, at);
    if (a.percent !== undefined && !isInt(a.percent, -90, 300)) throw bad(`${at}.percent: a whole number from -90 to 300.`, at);
    if (a.amountPaise !== undefined && !(Number.isInteger(a.amountPaise) && Math.abs(a.amountPaise) <= 100_000_000)) throw bad(`${at}.amountPaise: paise, up to ₹10 lakh either way.`, at);
    if (a.days !== undefined && !isWeekdays(a.days)) throw bad(`${at}.days: days 0 (Sunday) to 6, each once.`, at);
    if (a.from !== undefined && !isDay(a.from)) throw bad(`${at}.from: YYYY-MM-DD.`, at);
    if (a.until !== undefined && !isDay(a.until)) throw bad(`${at}.until: YYYY-MM-DD.`, at);
    if (a.from && a.until && a.from > a.until) throw bad(`${at}: "from" is after "until".`, at);
    if (a.eventTypes !== undefined && (!Array.isArray(a.eventTypes) || !a.eventTypes.length || a.eventTypes.some((e) => !(EVENT_TYPES as readonly string[]).includes(e)))) {
      throw bad(`${at}.eventTypes: known event types only.`, at);
    }
  });
  return list as PriceAdjustment[];
}

export function checkTemplate(type: BookingTypeKey, t: unknown): CategoryTemplate {
  if (!BOOKING_TYPES.includes(type)) throw bad('Unknown booking type.', 'bookingType');
  const tpl = (t ?? {}) as CategoryTemplate;
  if (typeof tpl !== 'object' || Array.isArray(tpl)) throw bad('template must be an object.', 'template');
  checkFields(tpl.attributes, 'template.attributes');
  checkFields(tpl.questions, 'template.questions');
  checkRules(tpl.rules, 'template.rules');
  if (tpl.pricingModels && (!Array.isArray(tpl.pricingModels) || tpl.pricingModels.some((m) => !PRICING_MODELS.includes(m)))) {
    throw bad('template.pricingModels: unknown model.', 'template.pricingModels');
  }
  if (tpl.resourceKind && !RESOURCE_KINDS.includes(tpl.resourceKind)) throw bad('template.resourceKind: unknown kind.', 'template.resourceKind');
  return tpl;
}

/** Values for a list of fields (vendor attributes or customer answers); unknown keys are refused. */
export function checkValues(fields: FieldDef[], values: Record<string, unknown> | undefined, where: 'attributes' | 'answers'): Record<string, unknown> {
  const v = values ?? {};
  if (typeof v !== 'object' || Array.isArray(v)) throw bad(`${where} must be an object.`, where);
  const known = new Map(fields.map((f) => [f.key, f]));
  for (const k of Object.keys(v)) if (!known.has(k)) throw bad(`${where}.${k} is not asked for this service.`, `${where}.${k}`);
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    // A question hidden by an earlier answer is not asked: its answer, if any, is dropped.
    if (!isShown(f, out)) continue;
    const val = v[f.key];
    if (val === undefined || val === null || val === '') {
      if (f.required) throw new AppError('ANSWER_REQUIRED', `${f.label.en} is required.`, HttpStatus.BAD_REQUEST, { field: f.key });
      continue;
    }
    const fail = () => new AppError('ANSWER_INVALID', `${f.label.en} is not valid.`, HttpStatus.BAD_REQUEST, { field: f.key });
    switch (f.type) {
      case 'text':
      case 'longtext':
        if (typeof val !== 'string' || val.trim().length > (f.maxLength ?? (f.type === 'longtext' ? 2000 : 500)) || UNSAFE.test(val.replace(/[\n\r\t]/g, ' '))) throw fail();
        out[f.key] = val.trim();
        break;
      case 'date':
        if (typeof val !== 'string' || !DAY_RE.test(val) || Number.isNaN(Date.parse(`${val}T00:00:00Z`)) || !new Date(`${val}T00:00:00Z`).toISOString().startsWith(val)) throw fail();
        out[f.key] = val;
        break;
      case 'time':
        if (typeof val !== 'string' || !TIME_RE.test(val)) throw fail();
        out[f.key] = val;
        break;
      case 'photo': {
        // Cloudinary's signed reply; the engine checks the signature and the folder before saving.
        const p = val as { publicId?: unknown; version?: unknown; signature?: unknown; format?: unknown };
        if (!p || typeof p !== 'object' || typeof p.publicId !== 'string' || p.publicId.length > 300 || !Number.isInteger(p.version) || typeof p.signature !== 'string'
          || typeof p.format !== 'string' || !['jpg', 'jpeg', 'png', 'pdf'].includes(p.format)) throw fail();
        out[f.key] = { publicId: p.publicId, version: p.version, signature: p.signature, format: p.format };
        break;
      }
      case 'number':
        if (typeof val !== 'number' || !Number.isFinite(val) || (f.min !== undefined && val < f.min) || (f.max !== undefined && val > f.max)) throw fail();
        out[f.key] = val;
        break;
      case 'boolean':
        if (typeof val !== 'boolean') throw fail();
        out[f.key] = val;
        break;
      case 'select':
        if (typeof val !== 'string' || !f.options!.some((o) => o.value === val)) throw fail();
        out[f.key] = val;
        break;
      case 'multiselect':
        if (!Array.isArray(val) || val.some((x) => typeof x !== 'string' || !f.options!.some((o) => o.value === x)) || new Set(val).size !== val.length) throw fail();
        out[f.key] = val;
        break;
    }
  }
  return out;
}

// ---------- time ----------

const IST_MS = 5.5 * 3600_000;
/** 'HH:MM' India time of an instant. */
export const istClock = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(11, 16);
export const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export function parseTime(v: unknown, field: string): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    throw new AppError('VALIDATION', `${field} must be a full date and time with a time zone, like 2026-12-01T18:30:00+05:30.`, HttpStatus.BAD_REQUEST, { field });
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION', `${field} is not a real date.`, HttpStatus.BAD_REQUEST, { field });
  return d;
}

/** Start/end checks every timed booking type shares: order, notice, duration limits, working hours. */
export function checkTimes(starts: Date, ends: Date, rules: RuleSet, now = new Date()) {
  if (ends <= starts) throw new AppError('TIME_ORDER', 'The end must be after the start.', HttpStatus.BAD_REQUEST);
  const lead = (rules.leadTimeHours ?? 0) * 3600_000;
  if (starts.getTime() < now.getTime() + lead) {
    throw new AppError('TOO_SOON', `This needs at least ${rules.leadTimeHours ?? 0} hours' notice.`, HttpStatus.BAD_REQUEST, { leadTimeHours: rules.leadTimeHours ?? 0 });
  }
  // Counted in India calendar days, not hours: "up to 21 days ahead" allows any time on the 21st day,
  // whatever the time of day the customer asks.
  const maxDays = Math.min(rules.maxAdvanceDays ?? 730, 730);
  if (daysBefore(starts, now) > maxDays) {
    throw new AppError('DATE_TOO_FAR', `This can be booked up to ${maxDays} days ahead.`, HttpStatus.BAD_REQUEST, { maxAdvanceDays: maxDays });
  }
  const day = istDay(starts);
  if (rules.blockedDates?.includes(day)) throw new AppError('DATE_BLOCKED', 'The vendor does not take bookings on this date.', HttpStatus.BAD_REQUEST, { day });
  if (rules.workingDays && !rules.workingDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) {
    throw new AppError('CLOSED_THAT_DAY', 'The vendor does not work on this day of the week.', HttpStatus.BAD_REQUEST, { workingDays: rules.workingDays });
  }
  const minutes = (ends.getTime() - starts.getTime()) / 60_000;
  if (rules.minDurationMin !== undefined && minutes < rules.minDurationMin) {
    throw new AppError('DURATION_TOO_SHORT', `The minimum booking is ${fmtMinutes(rules.minDurationMin)}.`, HttpStatus.BAD_REQUEST, { minMinutes: rules.minDurationMin });
  }
  if (rules.maxDurationMin !== undefined && minutes > rules.maxDurationMin) {
    throw new AppError('DURATION_TOO_LONG', `The longest booking is ${fmtMinutes(rules.maxDurationMin)}.`, HttpStatus.BAD_REQUEST, { maxMinutes: rules.maxDurationMin });
  }
  if (rules.workingHours) {
    const { from, to } = rules.workingHours;
    const inside = (d: Date) => {
      const m = minutesOf(istClock(d));
      const f = minutesOf(from);
      const t = minutesOf(to);
      // A window like 18:00–02:00 crosses midnight.
      return f <= t ? m >= f && m <= t : m >= f || m <= t;
    };
    if (!inside(starts) || !inside(ends)) {
      throw new AppError('OUTSIDE_WORKING_HOURS', `This service works ${from}–${to}.`, HttpStatus.BAD_REQUEST, { from, to });
    }
  }
  const hit = rules.breaks?.length ? breakDuring(rules.breaks, starts, ends) : null;
  if (hit) throw new AppError('DURING_BREAK', `The vendor takes a break ${hit.from}–${hit.to}.`, HttpStatus.BAD_REQUEST, hit);
}

/** Each daily break as times on every India day from `from` to `until`. */
export function breakPeriods(breaks: { from: string; to: string }[], from: Date, until: Date): { from: Date; until: Date; break: { from: string; to: string } }[] {
  const out: { from: Date; until: Date; break: { from: string; to: string } }[] = [];
  for (let day = istDay(new Date(from.getTime() - 86_400_000)); day <= istDay(until); day = istDay(new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000))) {
    for (const b of breaks) out.push({ from: new Date(`${day}T${b.from}:00+05:30`), until: new Date(`${day}T${b.to}:00+05:30`), break: b });
  }
  return out;
}

/** The first break a booking from `starts` to `ends` runs into, if any (touching its edge is fine). */
export function breakDuring(breaks: { from: string; to: string }[], starts: Date, ends: Date): { from: string; to: string } | null {
  return breakPeriods(breaks, starts, ends).find((p) => p.from < ends && p.until > starts)?.break ?? null;
}

export function checkQty(qty: number | undefined, rules: RuleSet, what: string): number {
  if (qty === undefined || !Number.isInteger(qty) || qty < 1) throw new AppError('QUANTITY_REQUIRED', `Tell us the ${what}.`, HttpStatus.BAD_REQUEST, { field: what });
  if ((rules.minQty !== undefined && qty < rules.minQty) || (rules.maxQty !== undefined && qty > rules.maxQty)) {
    throw new AppError('QUANTITY_OUT_OF_RANGE', `The ${what} must be ${rules.minQty ?? 1}–${rules.maxQty ?? 'any'}.`, HttpStatus.BAD_REQUEST, {
      min: rules.minQty ?? null,
      max: rules.maxQty ?? null,
    });
  }
  return qty;
}

export const fmtMinutes = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`);

/** Whole days before the service starts, in India dates (0 on the day). */
export function daysBefore(starts: Date, now = new Date()): number {
  return Math.round((Date.parse(`${istDay(starts)}T00:00:00Z`) - Date.parse(`${istDay(now)}T00:00:00Z`)) / 86_400_000);
}

export function refundPercentFrom(policy: CancellationPolicy | null | undefined, by: 'customer' | 'vendor', days: number): number {
  const p = policy ?? DEFAULT_CANCELLATION;
  if (by === 'vendor') return p.vendorPercent;
  const tier = [...p.customer].sort((a, b) => b.minDays - a.minDays).find((t) => days >= t.minDays);
  return tier?.percent ?? 0;
}
