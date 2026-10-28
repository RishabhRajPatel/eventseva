// Services booked by time or quantity (DJ, decor, catering, cars, staff …): server reads as React
// Query hooks, the keys mutations invalidate, and the pure rules the screens share.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  Booking,
  BookingChange,
  BookingType,
  EnginePricing,
  EngineRules,
  EngineService,
  FieldDef,
  Language,
  PricingModel,
  ResourceKind,
  ServiceAddon,
  ServiceBundle,
  ServiceSetup,
  TripView,
  VendorResource,
} from '@eventseva/app-shared';
import { api } from './api';
import { rupeesInputToPaise } from './money';
import { STALE } from './queries';

export const engineKeys = {
  all: ['engine'] as const,
  setup: ['engine', 'setup'] as const,
  services: ['engine', 'services'] as const,
  resources: ['engine', 'resources'] as const,
  addons: ['engine', 'addons'] as const,
  bundles: ['engine', 'bundles'] as const,
  trip: (bookingId: string) => ['trip', bookingId] as const,
  changes: (bookingId: string) => ['changes', bookingId] as const,
};

export function useServiceSetup(enabled = true) {
  return useQuery({
    queryKey: engineKeys.setup,
    queryFn: () => api.get<ServiceSetup>('/v1/partner/service-setup'),
    staleTime: STALE.profile,
    enabled,
  });
}

export function useEngineServices() {
  return useQuery({
    queryKey: engineKeys.services,
    queryFn: async () => (await api.get<{ items: EngineService[] }>('/v1/partner/engine-services')).items,
    staleTime: STALE.list,
  });
}

export function useResources() {
  return useQuery({
    queryKey: engineKeys.resources,
    queryFn: async () => (await api.get<{ items: VendorResource[] }>('/v1/partner/resources')).items,
    staleTime: STALE.list,
  });
}

export function useAddons() {
  return useQuery({
    queryKey: engineKeys.addons,
    queryFn: async () => (await api.get<{ items: ServiceAddon[] }>('/v1/partner/addons')).items,
    staleTime: STALE.list,
  });
}

export function useBundles() {
  return useQuery({
    queryKey: engineKeys.bundles,
    queryFn: async () => (await api.get<{ items: ServiceBundle[] }>('/v1/partner/bundles')).items,
    staleTime: STALE.list,
  });
}

export function useTrip(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: engineKeys.trip(bookingId),
    queryFn: () => api.get<TripView>(`/v1/partner/bookings/${bookingId}/trip`),
    enabled,
    staleTime: STALE.list,
  });
}

export function useChanges(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: engineKeys.changes(bookingId),
    queryFn: async () => (await api.get<{ items: BookingChange[] }>(`/v1/partner/bookings/${bookingId}/changes`)).items,
    enabled,
    staleTime: STALE.list,
  });
}

export function invalidateEngine(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: engineKeys.all });
  void qc.invalidateQueries({ queryKey: ['vendor'] });
}

/** Categories booked by day + slot or as rental items use the older screens. */
export const usesEngine = (type: BookingType | undefined) => !!type && type !== 'slot' && type !== 'rental';

// ---------- template fields (vendor attributes, resource details) ----------

export const fieldLabel = (f: Pick<FieldDef, 'label'>, lang: Language) => (lang === 'hi' ? f.label.hi : f.label.en);

/** Form state keeps numbers as typed text; booleans, choices and lists as they are. */
export type FieldValues = Record<string, unknown>;

export function initialValues(fields: FieldDef[], saved: Record<string, unknown> = {}): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    const v = saved[f.key];
    if (v === undefined || v === null) continue;
    out[f.key] = f.type === 'number' ? String(v) : v;
  }
  return out;
}

export type FieldError = 'required' | 'invalid';

/** Same checks as checkValues() on the server, so the vendor sees them before saving. */
export function fieldErrors(fields: FieldDef[], values: FieldValues): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) errors[f.key] = 'required';
      continue;
    }
    if (f.type === 'number') {
      const n = Number(String(v).trim());
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors[f.key] = 'invalid';
    } else if (f.type === 'text' && String(v).trim().length > (f.maxLength ?? 500)) {
      errors[f.key] = 'invalid';
    }
  }
  return errors;
}

/** The values to send: numbers as numbers, text trimmed, empty answers left out. */
export function toValues(fields: FieldDef[], values: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (f.type === 'number') out[f.key] = Number(String(v).trim());
    else if (f.type === 'text') {
      const s = String(v).trim();
      if (s) out[f.key] = f.key === 'registration' ? normaliseRegistration(s) : s;
    } else out[f.key] = v;
  }
  return out;
}

/** "up 70 ab-1234" → "UP70AB1234", as the server stores it. */
export const normaliseRegistration = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- pricing ----------

export type PriceKey = Exclude<keyof EnginePricing, 'model' | 'ratePaise' | 'taxPercent' | 'adjustments'>;
const MONEY_KEYS: PriceKey[] = ['minChargePaise', 'overtimeHourPaise', 'extraKmPaise', 'driverDayPaise', 'dayRatePaise', 'travelPerKmPaise', 'earlyMorningPaise'];
export const isMoneyKey = (k: PriceKey) => MONEY_KEYS.includes(k);

/** The extra price fields that matter for a booking type and pricing model, in form order. */
export function priceExtras(type: BookingType, model: PricingModel): PriceKey[] {
  if (model === 'quote') return [];
  if (type === 'transport') {
    const out: PriceKey[] = ['includedHours', 'includedKm', 'overtimeHourPaise', 'extraKmPaise', 'driverDayPaise'];
    if (model !== 'daily') out.push('dayRatePaise');
    return [...out, 'earlyMorningPaise'];
  }
  if (type === 'appointment') return ['earlyMorningPaise', 'travelFreeKm', 'travelPerKmPaise'];
  const out: PriceKey[] = [];
  if (model === 'fixed') out.push('includedHours', 'overtimeHourPaise');
  out.push('minChargePaise');
  return [...out, 'travelFreeKm', 'travelPerKmPaise'];
}

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export interface PriceForm {
  model: PricingModel;
  rate: string;
  extras: Partial<Record<PriceKey, string>>;
  taxPercent: (typeof GST_RATES)[number];
}

export function priceForm(p: EnginePricing | undefined, models: PricingModel[]): PriceForm {
  const extras: Partial<Record<PriceKey, string>> = {};
  if (p) {
    for (const k of [...MONEY_KEYS, 'includedHours', 'includedKm', 'travelFreeKm'] as PriceKey[]) {
      const v = p[k];
      if (v === undefined) continue;
      extras[k] = isMoneyKey(k) ? String(v / 100) : String(v);
    }
  }
  return {
    model: p?.model ?? models[0] ?? 'fixed',
    rate: p && p.model !== 'quote' ? String(p.ratePaise / 100) : '',
    extras,
    taxPercent: p?.taxPercent ?? 0,
  };
}

/** The pricing to send, or the first field that is wrong. */
export function toPricing(type: BookingType, f: PriceForm): { ok: true; pricing: EnginePricing } | { ok: false; field: 'rate' | PriceKey } {
  const pricing: EnginePricing = { model: f.model, ratePaise: 0 };
  if (f.model !== 'quote') {
    const rate = rupeesInputToPaise(f.rate);
    if (rate === null || rate < 100) return { ok: false, field: 'rate' };
    pricing.ratePaise = rate;
  }
  for (const k of priceExtras(type, f.model)) {
    const text = (f.extras[k] ?? '').trim();
    if (!text) continue;
    if (isMoneyKey(k)) {
      const paise = rupeesInputToPaise(text);
      if (paise === null) return { ok: false, field: k };
      (pricing as unknown as Record<string, number>)[k] = paise;
    } else {
      if (!/^\d{1,6}$/.test(text)) return { ok: false, field: k };
      (pricing as unknown as Record<string, number>)[k] = Number(text);
    }
  }
  if (f.taxPercent) pricing.taxPercent = f.taxPercent;
  return { ok: true, pricing };
}

// ---------- rules ----------

/** The rules a vendor can set, by booking type, shown in this order. Durations are typed in hours. */
export type RuleKey =
  | 'minHours'
  | 'maxHours'
  | 'minQty'
  | 'maxQty'
  | 'leadTimeHours'
  | 'setupHours'
  | 'dismantleHours'
  | 'bufferHours'
  | 'perPersonMin'
  | 'capacity'
  | 'minAge'
  | 'deposit';

export function ruleKeys(type: BookingType): RuleKey[] {
  switch (type) {
    case 'per_person':
      return ['minQty', 'maxQty', 'capacity', 'leadTimeHours', 'setupHours', 'dismantleHours'];
    case 'staffing':
      return ['minQty', 'maxQty', 'minHours', 'maxHours', 'leadTimeHours'];
    case 'appointment':
      return ['perPersonMin', 'minQty', 'maxQty', 'leadTimeHours', 'bufferHours'];
    case 'transport':
      return ['minHours', 'maxHours', 'leadTimeHours', 'bufferHours', 'minAge', 'deposit'];
    case 'quote':
      return ['leadTimeHours'];
    default:
      return ['minHours', 'maxHours', 'leadTimeHours', 'setupHours', 'dismantleHours', 'bufferHours', 'deposit'];
  }
}

const HOUR_RULES: Partial<Record<RuleKey, keyof EngineRules>> = {
  minHours: 'minDurationMin',
  maxHours: 'maxDurationMin',
  setupHours: 'setupMin',
  dismantleHours: 'dismantleMin',
  bufferHours: 'bufferAfterMin',
};
const PLAIN_RULES: Partial<Record<RuleKey, keyof EngineRules>> = {
  minQty: 'minQty',
  maxQty: 'maxQty',
  leadTimeHours: 'leadTimeHours',
  perPersonMin: 'perPersonMin',
  capacity: 'capacity',
  minAge: 'minAge',
};

export type RuleForm = Partial<Record<RuleKey, string>> & {
  approval: 'vendor' | 'auto';
  instructions: string;
};

const hoursText = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);

/** Saved rules (or the category defaults) as form text. */
export function ruleForm(saved: EngineRules | undefined): RuleForm {
  const r = saved ?? {};
  const out: RuleForm = {
    approval: r.approval ?? 'vendor',
    instructions: r.instructions ?? '',
  };
  for (const [k, rk] of Object.entries(HOUR_RULES) as [RuleKey, keyof EngineRules][]) if (typeof r[rk] === 'number') out[k] = hoursText(r[rk] as number);
  for (const [k, rk] of Object.entries(PLAIN_RULES) as [RuleKey, keyof EngineRules][]) if (typeof r[rk] === 'number') out[k] = String(r[rk]);
  if (r.deposit?.fixedPaise) out.deposit = String(r.deposit.fixedPaise / 100);
  return out;
}

/** The rules to send (only what the vendor filled), or the first wrong field. */
export function toRules(
  type: BookingType,
  f: RuleForm,
  floorLeadHours?: number,
): { ok: true; rules: EngineRules } | { ok: false; field: RuleKey; reason: 'invalid' | 'range' | 'lead' } {
  const rules: EngineRules = { approval: f.approval };
  if (f.instructions.trim()) rules.instructions = f.instructions.trim();
  for (const k of ruleKeys(type)) {
    const text = (f[k] ?? '').trim();
    if (!text) continue;
    if (k === 'deposit') {
      const paise = rupeesInputToPaise(text);
      if (paise === null) return { ok: false, field: k, reason: 'invalid' };
      rules.deposit = { fixedPaise: paise };
    } else if (HOUR_RULES[k]) {
      if (!/^\d{1,4}(\.\d)?$/.test(text)) return { ok: false, field: k, reason: 'invalid' };
      (rules as Record<string, unknown>)[HOUR_RULES[k]!] = Math.round(Number(text) * 60);
    } else {
      if (!/^\d{1,6}$/.test(text)) return { ok: false, field: k, reason: 'invalid' };
      (rules as Record<string, unknown>)[PLAIN_RULES[k]!] = Number(text);
    }
  }
  if (rules.minDurationMin !== undefined && rules.maxDurationMin !== undefined && rules.minDurationMin > rules.maxDurationMin)
    return { ok: false, field: 'maxHours', reason: 'range' };
  if (rules.minQty !== undefined && rules.maxQty !== undefined && rules.minQty > rules.maxQty) return { ok: false, field: 'maxQty', reason: 'range' };
  if (floorLeadHours !== undefined && rules.leadTimeHours !== undefined && rules.leadTimeHours < floorLeadHours) return { ok: false, field: 'leadTimeHours', reason: 'lead' };
  return { ok: true, rules };
}

// ---------- vehicles, drivers, staff, halls ----------

/** What the vendor lists for their category: cars and drivers, a hall, artists or staff. */
export function resourceKinds(setup: Pick<ServiceSetup, 'bookingType' | 'resourceKind' | 'staffKind'>): ResourceKind[] {
  if (setup.resourceKind === 'vehicle') return ['vehicle', 'driver'];
  if (setup.resourceKind === 'venue') return ['venue'];
  if (setup.resourceKind === 'artist') return ['artist'];
  if (setup.bookingType === 'staffing' || setup.staffKind) return ['staff'];
  return [];
}

export const DOC_TYPES: Partial<Record<ResourceKind, { type: string; required: boolean }[]>> = {
  vehicle: [
    { type: 'vehicle_rc', required: true },
    { type: 'vehicle_insurance', required: true },
    { type: 'vehicle_permit', required: false },
    { type: 'vehicle_puc', required: false },
  ],
  driver: [
    { type: 'driver_licence', required: true },
    { type: 'police_verification', required: false },
  ],
};

/** Required documents not yet uploaded (or rejected), so the vendor knows what blocks verification. */
export const missingDocs = (r: Pick<VendorResource, 'kind' | 'documents'>) =>
  (DOC_TYPES[r.kind] ?? []).filter((d) => d.required && !r.documents.some((x) => x.docType === d.type && x.status !== 'rejected')).map((d) => d.type);

/** Vehicles and drivers need EventSeva's check before customers can book them. */
export const bookable = (r: Pick<VendorResource, 'status' | 'verification'>) => r.status === 'active' && (r.verification === 'approved' || r.verification === 'not_required');

// ---------- car trips ----------

export type TripStep = 'assign' | 'handover' | 'return' | 'done';

export function nextTripStep(trip: Pick<TripView, 'fulfilment' | 'mode' | 'driver'>, confirmed: boolean): TripStep {
  if (!confirmed || trip.fulfilment === 'closed') return 'done';
  if (trip.fulfilment === 'in_progress') return 'return';
  if (trip.mode === 'with_driver' && !trip.driver) return 'assign';
  return 'handover';
}

/** Odometer and fuel as the vendor types them. */
export function checkReadings(odometer: string, fuel: number | null, handoverKm?: number): 'odometer' | 'fuel' | 'below' | null {
  if (!/^\d{1,7}$/.test(odometer.trim())) return 'odometer';
  if (fuel === null || fuel < 0 || fuel > 8) return 'fuel';
  if (handoverKm !== undefined && Number(odometer) < handoverKm) return 'below';
  return null;
}

// ---------- the customer's answers on a booking ----------

/** Answers with the question and option labels in the vendor's language; internal keys (car mode, km estimate) left out. */
export function answerRows(b: Pick<Booking, 'answers' | 'questions'>, lang: Language): { key: string; label: string; value: string | boolean | number }[] {
  const answers = b.answers ?? {};
  const name = (l: { en: string; hi: string }) => (lang === 'hi' ? l.hi : l.en);
  const rows: { key: string; label: string; value: string | boolean | number }[] = [];
  for (const q of b.questions ?? []) {
    const v = answers[q.key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const option = (x: unknown) => {
      const o = q.options?.find((op) => op.value === x);
      return o ? name(o.label) : String(x);
    };
    rows.push({ key: q.key, label: name(q.label), value: Array.isArray(v) ? v.map(option).join(', ') : typeof v === 'boolean' || typeof v === 'number' ? v : option(v) });
  }
  return rows;
}
