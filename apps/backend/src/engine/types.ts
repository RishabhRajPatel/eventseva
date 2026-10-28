// The booking rules engine (docs/BOOKING_ENGINE.md): shared shapes. Money is paise, times are ISO
// timestamps (stored as timestamptz, shown in India time).

export const BOOKING_TYPES = ['slot', 'time_window', 'rental', 'per_person', 'staffing', 'appointment', 'transport', 'quote'] as const;
export type BookingTypeKey = (typeof BOOKING_TYPES)[number];

export const RESOURCE_KINDS = ['vehicle', 'driver', 'staff', 'artist', 'venue', 'equipment', 'crew'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const PRICING_MODELS = ['fixed', 'hourly', 'daily', 'per_unit', 'per_person', 'per_trip', 'quote'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export type Bilingual = { en: string; hi: string };

/** A field a vendor fills (attributes) or a customer answers (questions). */
export interface FieldDef {
  key: string;
  label: Bilingual;
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect';
  required?: boolean;
  options?: { value: string; label: Bilingual; /** per-person or flat extra, for priced choices (menus) */ pricePaise?: number; perPerson?: boolean }[];
  min?: number;
  max?: number;
  unit?: string;
  maxLength?: number;
}

export interface CancellationPolicy {
  /** Refund % of what was paid (deposit always comes back), by whole days before the service starts. */
  customer: { minDays: number; percent: number }[];
  /** When the vendor cancels. */
  vendorPercent: number;
}

/** Booking rules. Category templates set defaults; vendors may tighten them within the allowed keys. */
export interface RuleSet {
  minDurationMin?: number;
  maxDurationMin?: number;
  minQty?: number;
  maxQty?: number;
  /** India time; a booking must start and end inside it (an end at or before the start time means next day). */
  workingHours?: { from: string; to: string };
  /** Hours of notice needed before the start. */
  leadTimeHours?: number;
  /** Days of the week the service works, India time (0 = Sunday … 6 = Saturday). Unset: every day. */
  workingDays?: number[];
  /** India dates the service is not offered (holidays, already promised elsewhere): YYYY-MM-DD. */
  blockedDates?: string[];
  /** How far ahead a booking may start, in days (the platform allows up to 730). */
  maxAdvanceDays?: number;
  /** Bookings of this service that may start on one India day (requests waiting for an answer count). */
  maxPerDay?: number;
  setupMin?: number;
  dismantleMin?: number;
  /** Cleaning / turnaround / repair time after the booking before the resource is free again. */
  bufferAfterMin?: number;
  advance?: { percent?: number; fixedPaise?: number };
  deposit?: { fixedPaise?: number; percent?: number };
  approval?: 'vendor' | 'auto';
  cancellation?: CancellationPolicy;
  /** e.g. 'driving_licence' for self-drive cars. */
  requiredDocuments?: string[];
  /** per_person: guests one vendor can serve in a day; staffing: workers available when none are listed. */
  capacity?: number;
  /** appointment: minutes per person. */
  perPersonMin?: number;
  /** transport self-drive: minimum age. */
  minAge?: number;
  instructions?: string;
}

export interface Pricing {
  model: PricingModel;
  ratePaise: number;
  minChargePaise?: number;
  /** fixed / per_trip: hours and km covered by the rate. */
  includedHours?: number;
  includedKm?: number;
  overtimeHourPaise?: number;
  extraKmPaise?: number;
  /** transport with driver, per duty day. */
  driverDayPaise?: number;
  /** multi-day: each extra 24 h. */
  dayRatePaise?: number;
  /** Travel / delivery: free up to this many km from the vendor, then per km. */
  travelFreeKm?: number;
  travelPerKmPaise?: number;
  /** appointment: starting before 07:00. */
  earlyMorningPaise?: number;
  /** GST the vendor charges on this service. */
  taxPercent?: 0 | 5 | 12 | 18 | 28;
  /** Price rules: weekends, peak dates, event types … applied to the service's own price lines, in order. */
  adjustments?: PriceAdjustment[];
}

/**
 * A price rule. It applies when every condition it sets holds (unset conditions match everything);
 * `percent` changes the service's price lines (negative for a discount), `amountPaise` adds a flat sum.
 */
export interface PriceAdjustment {
  label: Bilingual;
  /** India weekdays the booking starts on (0 = Sunday). */
  days?: number[];
  /** India date range the booking starts in, both ends included (YYYY-MM-DD). */
  from?: string;
  until?: string;
  /** The customer's event types (wedding, birthday …). */
  eventTypes?: string[];
  percent?: number;
  amountPaise?: number;
}

/**
 * One way to book a service with its own price (and optionally rules): a car "Local, by the hour" and
 * "Outstation, per day", a DJ "Per hour" and "Full night". The customer picks one (`planId`).
 */
export interface RatePlan {
  id: string;
  name: Bilingual;
  description?: Bilingual;
  pricing: Pricing;
  /** Vendor rule keys only; they override the service's rules for this plan. */
  rules?: RuleSet;
}

export interface CategoryTemplate {
  attributes?: FieldDef[];
  questions?: FieldDef[];
  rules?: RuleSet;
  pricingModels?: PricingModel[];
  /** time_window / appointment / transport: the resource kind one booking takes exclusively. */
  resourceKind?: ResourceKind;
  /** staffing: the staff pool. */
  staffKind?: string;
}

export interface Place {
  address: string;
  lat: number;
  lng: number;
}

/** What a customer asks for. The same body gets a quote or makes the booking. */
export interface EngineRequest {
  eventId: string;
  serviceId: string;
  startsAt: string;
  endsAt?: string;
  quantity?: number;
  guestCount?: number;
  people?: number;
  lines?: { itemId: string; qty: number }[];
  addons?: { addonId: string; note?: string }[];
  answers?: Record<string, unknown>;
  route?: { pickup: Place; destination: Place; stops?: Place[] };
  mode?: 'with_driver' | 'self_drive';
  note?: string;
  /** cash: the whole booking is paid to the vendor in person (only where the vendor accepts cash). */
  payMode?: 'online' | 'cash';
  /** The total the customer saw; a different server total answers PRICE_CHANGED instead of booking. */
  expectedTotalPaise?: number;
  /** Which of the service's rate plans (required when it has any). */
  planId?: string;
}

export interface QuoteLine {
  code: string;
  label: string;
  qty: number;
  unitPaise: number;
  amountPaise: number;
  kind: 'base' | 'extra' | 'addon' | 'fee' | 'tax' | 'deposit';
}

export interface Quote {
  lines: QuoteLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
  depositPaise: number;
  /** 'indicative' until the vendor confirms (custom quotation, add-ons needing approval). */
  priceKind: 'confirmed' | 'indicative';
  startsAt: string;
  endsAt: string;
  occupyFrom: string;
  occupyUntil: string;
  returnDueAt: string | null;
  estKm?: number;
  cancellation: CancellationPolicy;
  approval: 'vendor' | 'auto';
  notes: string[];
}

/** One thing a booking must take while it is held: an exclusive resource or a quantity from a pool. */
export type Need =
  | { kind: 'resource'; resourceId: string; label: string }
  | { kind: 'pool'; poolKey: string; qty: number; total: number; label: string; period?: [Date, Date] };
