// What a vendor configures on a service beyond its price and rules (docs/BOOKING_ENGINE.md, "What a
// vendor configures"): when it is available, the events it is for, ways to book (rate plans), price
// rules, and their own questions. Form state is text as typed; each `to…` function returns what the
// API takes, or the first problem. The server checks everything again.
import type { Bilingual, EnginePricing, EngineRules, EventType, FieldDef, PriceAdjustment, PricingModel, RatePlan } from '@eventseva/app-shared';
import { rupeesInputToPaise } from './money';

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s: string) => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
/** One text for both languages when the vendor typed only one. */
const both = (en: string, hi: string): Bilingual => ({ en: (en.trim() || hi.trim()).slice(0, 80), hi: (hi.trim() || en.trim()).slice(0, 80) });
const slug = (s: string, fallback: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'x$1').slice(0, 30) || fallback;

// ---------- availability ----------

export interface AvailabilityForm {
  /** Empty: every day. */
  workingDays: number[];
  blockedDates: string;
  maxAdvanceDays: string;
  maxPerDay: string;
  /** Daily breaks as typed: "13:00-14:00, 19:00-19:30". */
  breaks: string;
  /** Bookings that may run at once (several teams); empty: one at a time. */
  maxConcurrent: string;
}

export function availabilityForm(r: EngineRules | undefined): AvailabilityForm {
  return {
    workingDays: r?.workingDays ?? [],
    blockedDates: (r?.blockedDates ?? []).join(', '),
    maxAdvanceDays: r?.maxAdvanceDays ? String(r.maxAdvanceDays) : '',
    maxPerDay: r?.maxPerDay ? String(r.maxPerDay) : '',
    breaks: (r?.breaks ?? []).map((b) => `${b.from}-${b.to}`).join(', '),
    maxConcurrent: r?.maxConcurrent && r.maxConcurrent > 1 ? String(r.maxConcurrent) : '',
  };
}

export type AvailabilityProblem = 'dates' | 'advance' | 'perDay' | 'breaks' | 'concurrent';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The rule keys to merge into the service's rules (absent keys switch the limit off). */
type AvailabilityRules = Pick<EngineRules, 'workingDays' | 'blockedDates' | 'maxAdvanceDays' | 'maxPerDay' | 'breaks' | 'maxConcurrent'>;

export function toAvailability(f: AvailabilityForm): { ok: true; rules: AvailabilityRules } | { ok: false; problem: AvailabilityProblem } {
  const rules: AvailabilityRules = {};
  if (f.workingDays.length && f.workingDays.length < 7) rules.workingDays = [...f.workingDays].sort();
  const dates = f.blockedDates.split(/[\s,]+/).filter(Boolean);
  if (dates.some((d) => !realDay(d)) || dates.length > 366) return { ok: false, problem: 'dates' };
  if (dates.length) rules.blockedDates = [...new Set(dates)].sort();
  if (f.maxAdvanceDays.trim()) {
    const n = Number(f.maxAdvanceDays);
    if (!/^\d{1,3}$/.test(f.maxAdvanceDays.trim()) || n < 1 || n > 730) return { ok: false, problem: 'advance' };
    rules.maxAdvanceDays = n;
  }
  if (f.maxPerDay.trim()) {
    const n = Number(f.maxPerDay);
    if (!/^\d{1,4}$/.test(f.maxPerDay.trim()) || n < 1 || n > 1000) return { ok: false, problem: 'perDay' };
    rules.maxPerDay = n;
  }
  const breaks = (f.breaks ?? '').split(',').map((b) => b.trim()).filter(Boolean).map((b) => b.split(/\s*[-–]\s*/));
  if (breaks.length > 5 || breaks.some((b) => b.length !== 2 || !HHMM.test(b[0]) || !HHMM.test(b[1]) || b[0] >= b[1])) return { ok: false, problem: 'breaks' };
  if (breaks.length) rules.breaks = breaks.map(([from, to]) => ({ from, to }));
  if ((f.maxConcurrent ?? '').trim()) {
    const n = Number(f.maxConcurrent);
    if (!/^\d{1,3}$/.test(f.maxConcurrent.trim()) || n < 1 || n > 100) return { ok: false, problem: 'concurrent' };
    if (n > 1) rules.maxConcurrent = n;
  }
  return { ok: true, rules };
}

// ---------- rate plans ----------

export interface PlanForm {
  id: string;
  nameEn: string;
  nameHi: string;
  model: PricingModel;
  rate: string;
}

export const planForms = (plans: RatePlan[] | undefined): PlanForm[] =>
  (plans ?? []).map((p) => ({ id: p.id, nameEn: p.name.en, nameHi: p.name.hi, model: p.pricing.model, rate: p.pricing.model === 'quote' ? '' : String(p.pricing.ratePaise / 100) }));

export const newPlan = (model: PricingModel): PlanForm => ({ id: '', nameEn: '', nameHi: '', model, rate: '' });

export type PlanProblem = { index: number; field: 'name' | 'rate' } | { index: -1; field: 'count' };

/**
 * Plans to send: none, or 2–6. A plan keeps its id once saved (bookings refer to it); a new one gets
 * an id from its name. Extra price fields (included km, overtime …), GST and price rules come from
 * the service's own price.
 */
export function toPlans(forms: PlanForm[], base: Omit<EnginePricing, 'model' | 'ratePaise'>):
  { ok: true; plans: RatePlan[] } | { ok: false; problem: PlanProblem } {
  if (forms.length === 1 || forms.length > 6) return { ok: false, problem: { index: -1, field: 'count' } };
  const used = new Set<string>();
  const plans: RatePlan[] = [];
  for (const [index, f] of forms.entries()) {
    if (!f.nameEn.trim() && !f.nameHi.trim()) return { ok: false, problem: { index, field: 'name' } };
    let ratePaise = 0;
    if (f.model !== 'quote') {
      const r = rupeesInputToPaise(f.rate);
      if (r === null || r < 100) return { ok: false, problem: { index, field: 'rate' } };
      ratePaise = r;
    }
    let id = f.id || slug(f.nameEn || f.nameHi, `plan_${index + 1}`);
    while (used.has(id)) id = `${id.slice(0, 27)}_${index + 1}`;
    used.add(id);
    plans.push({ id, name: both(f.nameEn, f.nameHi), pricing: { ...base, model: f.model, ratePaise } });
  }
  return { ok: true, plans };
}

// ---------- price rules ----------

export interface PriceRuleForm {
  labelEn: string;
  labelHi: string;
  kind: 'percent' | 'amount';
  /** "+20", "-10", "500" … */
  value: string;
  days: number[];
  eventTypes: EventType[];
  from: string;
  until: string;
}

export const priceRuleForms = (list: PriceAdjustment[] | undefined): PriceRuleForm[] =>
  (list ?? []).map((a) => ({
    labelEn: a.label.en,
    labelHi: a.label.hi,
    kind: a.percent !== undefined ? 'percent' : 'amount',
    value: a.percent !== undefined ? String(a.percent) : String((a.amountPaise ?? 0) / 100),
    days: a.days ?? [],
    eventTypes: a.eventTypes ?? [],
    from: a.from ?? '',
    until: a.until ?? '',
  }));

export const newPriceRule = (): PriceRuleForm => ({ labelEn: '', labelHi: '', kind: 'percent', value: '', days: [], eventTypes: [], from: '', until: '' });

export type PriceRuleProblem = { index: number; field: 'label' | 'value' | 'dates' };

export function toPriceRules(forms: PriceRuleForm[]): { ok: true; adjustments: PriceAdjustment[] } | { ok: false; problem: PriceRuleProblem } {
  const out: PriceAdjustment[] = [];
  for (const [index, f] of forms.entries()) {
    if (!f.labelEn.trim() && !f.labelHi.trim()) return { ok: false, problem: { index, field: 'label' } };
    const text = f.value.trim().replace(/^\+/, '');
    const a: PriceAdjustment = { label: both(f.labelEn, f.labelHi) };
    if (f.kind === 'percent') {
      if (!/^-?\d{1,3}$/.test(text) || Number(text) === 0 || Number(text) < -90 || Number(text) > 300) return { ok: false, problem: { index, field: 'value' } };
      a.percent = Number(text);
    } else {
      const negative = text.startsWith('-');
      const paise = rupeesInputToPaise(negative ? text.slice(1) : text);
      if (paise === null || paise === 0) return { ok: false, problem: { index, field: 'value' } };
      a.amountPaise = negative ? -paise : paise;
    }
    const from = f.from.trim();
    const until = f.until.trim();
    if ((from && !realDay(from)) || (until && !realDay(until)) || (from && until && from > until)) return { ok: false, problem: { index, field: 'dates' } };
    if (f.days.length && f.days.length < 7) a.days = [...f.days].sort();
    if (f.eventTypes.length) a.eventTypes = f.eventTypes;
    if (from) a.from = from;
    if (until) a.until = until;
    out.push(a);
  }
  return { ok: true, adjustments: out };
}

// ---------- the vendor's own questions ----------

export interface QuestionForm {
  key: string;
  labelEn: string;
  labelHi: string;
  type: 'text' | 'longtext' | 'number' | 'date' | 'time' | 'boolean' | 'select' | 'photo';
  required: boolean;
  /** Choices, one per comma: "Veg, Jain, Non-veg". */
  options: string;
  /**
   * Asked only after an earlier question (by its place in the list) got one of these answers: choice
   * names as typed, or "yes" / "no" for a yes / no question. Null: always asked.
   */
  showIf: { question: number; answers: string[] } | null;
}

/** The answers an earlier question offers to a condition: its choices, or yes / no. */
export function conditionAnswers(q: QuestionForm): string[] {
  if (q.type === 'boolean') return ['yes', 'no'];
  if (q.type === 'select') return [...new Set(q.options.split(',').map((o) => o.trim()).filter(Boolean))];
  return [];
}

/** After removing question `index`, conditions on it go away and later references shift up. */
export function removeQuestion(forms: QuestionForm[], index: number): QuestionForm[] {
  return forms
    .filter((_, i) => i !== index)
    .map((f) => {
      if (!f.showIf) return f;
      if (f.showIf.question === index) return { ...f, showIf: null };
      return f.showIf.question > index ? { ...f, showIf: { ...f.showIf, question: f.showIf.question - 1 } } : f;
    });
}

export const questionForms = (fields: FieldDef[] | undefined): QuestionForm[] => {
  const list = fields ?? [];
  return list.map((f) => {
    const ref = f.showIf ? list.findIndex((x) => x.key === f.showIf!.key) : -1;
    const refField = list[ref];
    return {
      key: f.key,
      labelEn: f.label.en,
      labelHi: f.label.hi,
      type: f.type === 'multiselect' ? 'select' : f.type,
      required: !!f.required,
      options: (f.options ?? []).map((o) => o.label.en).join(', '),
      showIf: f.showIf && refField
        ? {
            question: ref,
            answers: f.showIf.values.map((v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : refField.options?.find((o) => o.value === v)?.label.en ?? String(v))),
          }
        : null,
    };
  });
};

export const newQuestion = (): QuestionForm => ({ key: '', labelEn: '', labelHi: '', type: 'text', required: false, options: '', showIf: null });

export type QuestionProblem = { index: number; field: 'label' | 'options' | 'condition' };

/** Questions to send. Keys stay once saved (answers refer to them) and never clash with the category's. */
export function toQuestions(forms: QuestionForm[], categoryKeys: string[]): { ok: true; questions: FieldDef[] } | { ok: false; problem: QuestionProblem } {
  const used = new Set(categoryKeys);
  const out: FieldDef[] = [];
  for (const [index, f] of forms.entries()) {
    if (!f.labelEn.trim() && !f.labelHi.trim()) return { ok: false, problem: { index, field: 'label' } };
    let key = f.key || slug(f.labelEn || f.labelHi, `q${index + 1}`);
    if (!/^[a-z]/.test(key)) key = `q_${key}`.slice(0, 40);
    while (used.has(key)) key = `${key.slice(0, 36)}_${index + 1}`;
    used.add(key);
    const q: FieldDef = { key, label: both(f.labelEn, f.labelHi), type: f.type, ...(f.required ? { required: true } : {}) };
    if (f.type === 'text') q.maxLength = 300;
    if (f.type === 'longtext') q.maxLength = 2000;
    if (f.type === 'select') {
      const names = [...new Set(f.options.split(',').map((o) => o.trim()).filter(Boolean))];
      if (names.length < 2 || names.length > 20) return { ok: false, problem: { index, field: 'options' } };
      const values = new Set<string>();
      q.options = names.map((name, i) => {
        let value = slug(name, `o${i + 1}`);
        while (values.has(value)) value = `${value}_${i + 1}`;
        values.add(value);
        return { value, label: both(name, name) };
      });
    }
    if (f.showIf) {
      // Only an earlier yes / no or choice question, and answers it really offers.
      const ref = out[f.showIf.question];
      if (!ref || f.showIf.question >= index || !f.showIf.answers.length || (ref.type !== 'boolean' && ref.type !== 'select')) {
        return { ok: false, problem: { index, field: 'condition' } };
      }
      const values = f.showIf.answers.map((a) => (ref.type === 'boolean' ? a === 'yes' : ref.options!.find((o) => o.label.en === a)?.value));
      if (values.some((v) => v === undefined)) return { ok: false, problem: { index, field: 'condition' } };
      q.showIf = { key: ref.key, values: values as (string | boolean)[] };
    }
    out.push(q);
  }
  return { ok: true, questions: out };
}
