// Booking types: how each kind of service turns a request into times, what it must hold, and its
// price lines. This is the extension point (docs/BOOKING_ENGINE.md, "Adding a booking type"):
// - a category picks one type (admin);
// - a new kind of service that fits none of them gets a new handler here, registered in HANDLERS,
//   with its own tests; it is never squeezed into a type that does not fit.
// Handlers are pure. The engine service loads the data, and the reservations module enforces the needs.
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors';
import { CITY_SPEED_KMPH, ROAD_FACTOR, straightKm, type Point } from '../bookings/travel';
import { checkQty, checkTimes, checkValues, fmtMinutes, istClock, istDay } from './rules';
import type { BookingTypeKey, CategoryTemplate, EngineRequest, FieldDef, Need, Pricing, QuoteLine, RuleSet } from './types';

export interface ServiceRow {
  id: string;
  vendor_id: string;
  title: string;
  booking_type: BookingTypeKey;
  pricing: Pricing;
  rules: RuleSet;
  attributes: Record<string, unknown>;
  resource_id: string | null;
  min_guests: number | null;
  max_guests: number | null;
}

export interface ItemRow {
  id: string;
  name: string;
  unit: string;
  available: number;
  rent_paise: number;
  rent_per: 'booking' | 'day';
  deposit_paise: number;
  min_qty: number;
  max_qty: number | null;
  min_days: number;
  max_days: number | null;
  damage_paise: number;
  missing_paise: number;
  quality: string;
  quality_label: string | null;
  condition: string;
  category: string | null;
}

export interface ResourceRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  verification: string;
  attributes: Record<string, unknown>;
}

export interface PlanContext {
  type: BookingTypeKey;
  service: ServiceRow;
  template: CategoryTemplate;
  rules: RuleSet;
  req: EngineRequest;
  vendorBase: Point | null;
  venue: Point | null;
  /** rental: the vendor's stock, by id. */
  items: Map<string, ItemRow>;
  /** The resource the service is (a car, a hall), if any. */
  resource: ResourceRow | null;
  /** The vendor's own team, when the service has no specific resource. */
  crewId: string | null;
  /** staffing / transport: active people in the vendor's pool. */
  poolSize: number;
  now: Date;
}

export interface Plan {
  starts: Date;
  ends: Date;
  occupyFrom: Date;
  occupyUntil: Date;
  returnDue: Date | null;
  quantity: number;
  lines: QuoteLine[];
  stock: { itemId: string; qty: number; unitPaise: number; depositPaise: number }[];
  needs: Need[];
  depositPaise: number;
  priceKind: 'confirmed' | 'indicative';
  estKm?: number;
  notes: string[];
  answers: Record<string, unknown>;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const line = (code: string, label: string, qty: number, unitPaise: number, kind: QuoteLine['kind'] = 'base'): QuoteLine => ({
  code,
  label,
  qty,
  unitPaise,
  amountPaise: Math.round(qty * unitPaise),
  kind,
});

function needEnd(ctx: PlanContext, fallbackMin?: number): Date {
  if (ctx.req.endsAt) return new Date(ctx.req.endsAt);
  if (fallbackMin) return addMin(new Date(ctx.req.startsAt), fallbackMin);
  throw new AppError('VALIDATION', 'endsAt is required for this service.', HttpStatus.BAD_REQUEST, { field: 'endsAt' });
}

/** Time-based price: fixed (covers includedHours, then overtime), hourly, or daily. */
function timePrice(p: Pricing, minutes: number, label: string, multiplier = 1): QuoteLine[] {
  const hours = minutes / 60;
  const out: QuoteLine[] = [];
  if (p.model === 'hourly') {
    out.push(line('base', `${label} (${Math.ceil(hours)} h)`, Math.ceil(hours) * multiplier, p.ratePaise));
  } else if (p.model === 'daily') {
    const days = Math.max(1, Math.ceil(hours / 24));
    out.push(line('base', `${label} (${days} day${days > 1 ? 's' : ''})`, days * multiplier, p.ratePaise));
  } else {
    out.push(line('base', label, multiplier, p.ratePaise));
    if (p.includedHours !== undefined && hours > p.includedHours && p.overtimeHourPaise) {
      const extra = Math.ceil(hours - p.includedHours);
      out.push(line('overtime', `Extra hours beyond ${p.includedHours} h`, extra * multiplier, p.overtimeHourPaise, 'extra'));
    }
  }
  return out;
}

function minCharge(p: Pricing, lines: QuoteLine[]): QuoteLine[] {
  const sum = lines.reduce((s, l) => s + l.amountPaise, 0);
  if (p.minChargePaise && sum < p.minChargePaise) return [...lines, line('minimum', 'Top-up to the minimum charge', 1, p.minChargePaise - sum, 'fee')];
  return lines;
}

/** Travel / delivery from the vendor's base to the place of service, beyond the free distance. */
export function travelLine(p: Pricing, from: Point | null, to: Point | null): QuoteLine | null {
  if (!p.travelPerKmPaise || !from || !to) return null;
  const km = Math.round(straightKm(from, to) * ROAD_FACTOR);
  const chargeable = km - (p.travelFreeKm ?? 0);
  return chargeable > 0 ? line('travel', `Travel ${km} km (${p.travelFreeKm ?? 0} km free)`, chargeable, p.travelPerKmPaise, 'fee') : null;
}

/** The service's own pool when the vendor runs several teams at once (rules.maxConcurrent). */
export const servicePoolKey = (serviceId: string) => `service:${serviceId}`;

function exclusive(ctx: PlanContext): Need[] {
  // Several teams: a place in the service's pool instead of the one team exclusively.
  if (!ctx.resource && (ctx.rules.maxConcurrent ?? 1) > 1) {
    return [{ kind: 'pool', poolKey: servicePoolKey(ctx.service.id), qty: 1, total: ctx.rules.maxConcurrent!, label: 'vendor teams' }];
  }
  const id = ctx.resource?.id ?? ctx.crewId;
  if (!id) throw new AppError('SERVICE_NOT_CONFIGURED', 'This vendor has not set up who does this service yet.', HttpStatus.CONFLICT);
  return [{ kind: 'resource', resourceId: id, label: ctx.resource?.name ?? 'vendor team' }];
}

function answersFor(ctx: PlanContext) {
  return checkValues(ctx.template.questions ?? [], ctx.req.answers, 'answers');
}

/** Per-person extras from priced menu choices (e.g. "Jain menu +₹50 a plate"). */
function choiceLines(questions: FieldDef[], answers: Record<string, unknown>, people: number): QuoteLine[] {
  const out: QuoteLine[] = [];
  for (const q of questions) {
    const chosen = ([] as unknown[]).concat(answers[q.key] ?? []);
    for (const value of chosen) {
      const o = q.options?.find((x) => x.value === value);
      if (o?.pricePaise) out.push(line(`choice_${q.key}_${o.value}`, `${q.label.en}: ${o.label.en}`, o.perPerson ? people : 1, o.pricePaise, 'extra'));
    }
  }
  return out;
}

type Handler = (ctx: PlanContext) => Plan;

// A: DJ, lighting, decoration, photography, venues, entertainers, pandit … one exclusive team or hall for a time window.
const timeWindow: Handler = (ctx) => {
  const { rules, service } = ctx;
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx);
  checkTimes(starts, ends, rules, ctx.now);
  const answers = answersFor(ctx);
  const minutes = (ends.getTime() - starts.getTime()) / MIN;
  const lines = minCharge(service.pricing, [...timePrice(service.pricing, minutes, service.title), ...choiceLines(ctx.template.questions ?? [], answers, 1)]);
  return {
    starts,
    ends,
    occupyFrom: addMin(starts, -(rules.setupMin ?? 0)),
    occupyUntil: addMin(ends, (rules.dismantleMin ?? 0) + (rules.bufferAfterMin ?? 0)),
    returnDue: null,
    quantity: 1,
    lines,
    stock: [],
    needs: exclusive(ctx),
    depositPaise: 0,
    priceKind: 'confirmed',
    notes: rules.setupMin ? [`Setup starts ${fmtMinutes(rules.setupMin)} before, at ${istClock(addMin(starts, -rules.setupMin))}.`] : [],
    answers,
  };
};

// D, C, L …: bartan, tent, furniture, generators, coolers, outfits: items × quantity from stock, dispatch → return.
const rental: Handler = (ctx) => {
  const { rules, service } = ctx;
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx);
  checkTimes(starts, ends, rules, ctx.now);
  const answers = answersFor(ctx);
  const req = ctx.req.lines ?? [];
  if (!req.length) throw new AppError('ITEMS_REQUIRED', 'Choose the items and how many.', HttpStatus.BAD_REQUEST);
  if (new Set(req.map((l) => l.itemId)).size !== req.length) throw new AppError('VALIDATION', 'Each item once, please.', HttpStatus.BAD_REQUEST);
  const days = Math.max(1, Math.ceil((ends.getTime() - starts.getTime()) / (24 * HOUR)));
  const lines: QuoteLine[] = [];
  const stock: Plan['stock'] = [];
  const needs: Need[] = [];
  let deposit = 0;
  for (const l of req) {
    const item = ctx.items.get(l.itemId);
    if (!item) throw new AppError('ITEM_NOT_FOUND', 'One of the items is not offered by this vendor.', HttpStatus.BAD_REQUEST, { itemId: l.itemId });
    if (!Number.isInteger(l.qty) || l.qty < item.min_qty || (item.max_qty !== null && l.qty > item.max_qty)) {
      throw new AppError('QUANTITY_OUT_OF_RANGE', item.max_qty !== null ? `${item.name}: ${item.min_qty} to ${item.max_qty} ${item.unit}.` : `${item.name}: at least ${item.min_qty} ${item.unit}.`,
        HttpStatus.BAD_REQUEST, { itemId: item.id, min: item.min_qty, max: item.max_qty });
    }
    if (days < item.min_days || (item.max_days !== null && days > item.max_days)) {
      throw new AppError('RENTAL_DAYS_OUT_OF_RANGE', item.max_days !== null ? `${item.name} is rented for ${item.min_days} to ${item.max_days} days.` : `${item.name} is rented for at least ${item.min_days} days.`,
        HttpStatus.BAD_REQUEST, { itemId: item.id, minDays: item.min_days, maxDays: item.max_days });
    }
    if (item.available < l.qty) {
      throw new AppError('NOT_AVAILABLE', `Only ${Math.max(0, item.available)} ${item.unit} of ${item.name} exist.`, HttpStatus.CONFLICT, { what: item.name, itemId: item.id, available: Math.max(0, item.available), requested: l.qty });
    }
    const unit = item.rent_per === 'day' ? item.rent_paise * days : item.rent_paise;
    lines.push(line(`item_${item.id}`, `${item.name} × ${l.qty}${item.rent_per === 'day' ? ` × ${days} day${days > 1 ? 's' : ''}` : ''}`, l.qty, unit));
    stock.push({ itemId: item.id, qty: l.qty, unitPaise: unit, depositPaise: item.deposit_paise });
    needs.push({ kind: 'pool', poolKey: `item:${item.id}`, qty: l.qty, total: item.available, label: item.name });
    deposit += item.deposit_paise * l.qty;
  }
  // The service's own rate is the flat delivery and setup fee (items carry their own rent).
  if (service.pricing.ratePaise) lines.unshift(line('base', 'Delivery and setup', 1, service.pricing.ratePaise, 'fee'));
  return {
    starts,
    ends,
    occupyFrom: addMin(starts, -(rules.setupMin ?? 0)),
    occupyUntil: addMin(ends, (rules.dismantleMin ?? 0) + (rules.bufferAfterMin ?? 0)),
    returnDue: ends,
    quantity: req.reduce((s, l) => s + l.qty, 0),
    lines: minCharge(service.pricing, lines),
    stock,
    needs,
    depositPaise: deposit,
    priceKind: 'confirmed',
    notes: [`Return everything by ${istDay(ends)} ${istClock(ends)}. Missing or broken items are charged.`],
    answers,
  };
};

// E: catering: guests × per-person rate (+ priced menu choices), daily guest capacity.
const perPerson: Handler = (ctx) => {
  const { service } = ctx;
  const rules = { ...ctx.rules, minQty: service.min_guests ?? ctx.rules.minQty, maxQty: service.max_guests ?? ctx.rules.maxQty };
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx, 4 * 60);
  checkTimes(starts, ends, rules, ctx.now);
  const guests = checkQty(ctx.req.guestCount, rules, 'guest count');
  const answers = answersFor(ctx);
  const base = service.pricing.model === 'per_person' || service.pricing.model === 'per_unit'
    ? [line('base', `${service.title} × ${guests} guests`, guests, service.pricing.ratePaise)]
    : timePrice(service.pricing, (ends.getTime() - starts.getTime()) / MIN, service.title);
  const day = istDay(starts);
  const dayStart = new Date(`${day}T00:00:00+05:30`);
  const needs: Need[] = rules.capacity
    ? [{ kind: 'pool', poolKey: `guests:${service.id}:${day}`, qty: guests, total: rules.capacity, label: `guests on ${day}`, period: [dayStart, new Date(dayStart.getTime() + 24 * HOUR)] }]
    : [];
  return {
    starts,
    ends,
    occupyFrom: addMin(starts, -(rules.setupMin ?? 0)),
    occupyUntil: addMin(ends, rules.dismantleMin ?? 0),
    returnDue: null,
    quantity: guests,
    lines: minCharge(service.pricing, [...base, ...choiceLines(ctx.template.questions ?? [], answers, guests)]),
    stock: [],
    needs,
    depositPaise: 0,
    priceKind: 'confirmed',
    notes: [],
    answers,
  };
};

// F: cooks, waiters, security, valet: N workers for a shift, from the vendor's staff pool.
const staffing: Handler = (ctx) => {
  const { rules, service } = ctx;
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx);
  checkTimes(starts, ends, rules, ctx.now);
  const workers = checkQty(ctx.req.quantity, rules, 'number of workers');
  const answers = answersFor(ctx);
  const total = ctx.poolSize || rules.capacity || 0;
  if (!total) throw new AppError('SERVICE_NOT_CONFIGURED', 'This vendor has not listed their staff yet.', HttpStatus.CONFLICT);
  const minutes = (ends.getTime() - starts.getTime()) / MIN;
  return {
    starts,
    ends,
    occupyFrom: starts,
    occupyUntil: addMin(ends, rules.bufferAfterMin ?? 0),
    returnDue: null,
    quantity: workers,
    lines: minCharge(service.pricing, timePrice(service.pricing, minutes, `${service.title} × ${workers}`, workers)),
    stock: [],
    needs: [{ kind: 'pool', poolKey: `staff:${ctx.template.staffKind ?? service.id}:${service.vendor_id}`, qty: workers, total, label: 'workers' }],
    depositPaise: 0,
    priceKind: 'confirmed',
    notes: [],
    answers,
  };
};

// J: makeup, mehendi, styling: people × minutes each, one artist exclusively.
const appointment: Handler = (ctx) => {
  const { rules, service } = ctx;
  const people = checkQty(ctx.req.people, rules, 'number of people');
  const starts = new Date(ctx.req.startsAt);
  const ends = addMin(starts, people * (rules.perPersonMin ?? 60));
  checkTimes(starts, ends, { ...rules, minDurationMin: undefined, maxDurationMin: undefined }, ctx.now);
  const answers = answersFor(ctx);
  const p = service.pricing;
  const lines = p.model === 'per_person' ? [line('base', `${service.title} × ${people}`, people, p.ratePaise)] : [line('base', service.title, 1, p.ratePaise)];
  if (p.earlyMorningPaise && istClock(starts) < '07:00') lines.push(line('early', 'Early-morning start (before 7 am)', 1, p.earlyMorningPaise, 'fee'));
  return {
    starts,
    ends,
    occupyFrom: starts,
    occupyUntil: addMin(ends, rules.bufferAfterMin ?? 0),
    returnDue: null,
    quantity: people,
    lines: minCharge(p, [...lines, ...choiceLines(ctx.template.questions ?? [], answers, people)]),
    stock: [],
    needs: exclusive(ctx),
    depositPaise: 0,
    priceKind: 'confirmed',
    notes: [`About ${fmtMinutes(people * (rules.perPersonMin ?? 60))} for ${people} ${people === 1 ? 'person' : 'people'}.`],
    answers,
  };
};

/** Road km along pickup → stops → destination (estimate; the odometer decides at the end). */
export function routeKm(route: NonNullable<EngineRequest['route']>): number {
  const pts = [route.pickup, ...(route.stops ?? []), route.destination];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += straightKm(pts[i - 1], pts[i]) * ROAD_FACTOR;
  return Math.round(km);
}

// G, N: dulha-dulhan cars, guest buses: one vehicle (exclusive), a driver from the pool or self-drive.
const transport: Handler = (ctx) => {
  const { rules, service, resource } = ctx;
  if (!resource || resource.kind !== 'vehicle') throw new AppError('SERVICE_NOT_CONFIGURED', 'This service is not linked to a vehicle.', HttpStatus.CONFLICT);
  if (resource.verification !== 'approved' || resource.status !== 'active') {
    throw new AppError('VEHICLE_NOT_AVAILABLE', 'This vehicle is not available for booking right now.', HttpStatus.CONFLICT);
  }
  const route = ctx.req.route;
  if (!route?.pickup || !route.destination) throw new AppError('ROUTE_REQUIRED', 'Add the pickup and destination.', HttpStatus.BAD_REQUEST);
  if ((route.stops?.length ?? 0) > 8) throw new AppError('VALIDATION', 'Up to 8 stops.', HttpStatus.BAD_REQUEST);
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx);
  checkTimes(starts, ends, rules, ctx.now);
  const answers = answersFor(ctx);
  const a = resource.attributes as { with_driver?: boolean; self_drive?: boolean; seats?: number };
  const mode = ctx.req.mode ?? (a.with_driver ? 'with_driver' : 'self_drive');
  if (mode === 'with_driver' && !a.with_driver) throw new AppError('MODE_NOT_OFFERED', 'This vehicle is self-drive only.', HttpStatus.BAD_REQUEST);
  if (mode === 'self_drive' && !a.self_drive) throw new AppError('MODE_NOT_OFFERED', 'This vehicle is only available with a driver.', HttpStatus.BAD_REQUEST);
  const p = service.pricing;
  const minutes = (ends.getTime() - starts.getTime()) / MIN;
  const hours = minutes / 60;
  const days = Math.max(1, Math.ceil(hours / 24));
  const km = routeKm(route);
  const lines: QuoteLine[] = [];
  if (p.model === 'daily' || (days > 1 && p.dayRatePaise)) {
    lines.push(line('base', `${service.title} (${days} day${days > 1 ? 's' : ''})`, days, p.model === 'daily' ? p.ratePaise : p.dayRatePaise!));
  } else if (p.model === 'hourly') {
    lines.push(line('base', `${service.title} (${Math.ceil(hours)} h)`, Math.ceil(hours), p.ratePaise));
  } else {
    lines.push(line('base', `${service.title} (up to ${p.includedHours ?? '—'} h, ${p.includedKm ?? '—'} km)`, 1, p.ratePaise));
    if (p.includedHours !== undefined && hours > p.includedHours && p.overtimeHourPaise) {
      lines.push(line('overtime', `Extra ${Math.ceil(hours - p.includedHours)} h (waiting / overtime)`, Math.ceil(hours - p.includedHours), p.overtimeHourPaise, 'extra'));
    }
  }
  const includedKm = (p.includedKm ?? 0) * (p.model === 'daily' || days > 1 ? days : 1);
  if (p.extraKmPaise && km > includedKm && p.includedKm !== undefined) {
    lines.push(line('extra_km', `Estimated ${km - includedKm} km beyond the included ${includedKm} km`, km - includedKm, p.extraKmPaise, 'extra'));
  }
  const needs: Need[] = [{ kind: 'resource', resourceId: resource.id, label: resource.name }];
  if (mode === 'with_driver') {
    if (p.driverDayPaise) lines.push(line('driver', `Driver (${days} duty day${days > 1 ? 's' : ''})`, days, p.driverDayPaise));
    if (!ctx.poolSize) throw new AppError('NO_DRIVER', 'This vendor has no driver free for these times.', HttpStatus.CONFLICT);
    needs.push({ kind: 'pool', poolKey: `staff:driver:${service.vendor_id}`, qty: 1, total: ctx.poolSize, label: 'driver' });
  }
  const pickupFee = travelLine(p, ctx.vendorBase, route.pickup);
  if (pickupFee) lines.push({ ...pickupFee, code: 'pickup', label: pickupFee.label.replace('Travel', 'Pickup distance') });
  const deposit = mode === 'self_drive' ? (rules.deposit?.fixedPaise ?? 0) : 0;
  const notes = [
    `Estimated ${km} km and ${Math.round(hours * 10) / 10} h. Final km and hours come from the odometer and actual times.`,
    `Fuel: ${String(resource.attributes.fuel_policy ?? 'included').replace(/_/g, ' ')}. Tolls and parking: ${String(resource.attributes.toll_parking ?? 'at actuals').replace(/_/g, ' ')}.`,
  ];
  if (mode === 'self_drive') notes.push('Self-drive needs a verified driving licence; the car is handed over after an inspection.');
  return {
    starts,
    ends,
    occupyFrom: addMin(starts, -(rules.setupMin ?? 0)),
    occupyUntil: addMin(ends, rules.bufferAfterMin ?? 0),
    returnDue: ends,
    quantity: 1,
    lines: minCharge(p, [...lines, ...choiceLines(ctx.template.questions ?? [], answers, 1)]),
    stock: [],
    needs,
    depositPaise: deposit,
    priceKind: 'confirmed',
    estKm: km,
    notes,
    answers: { ...answers, mode, estKm: km, avgSpeedKmph: CITY_SPEED_KMPH },
  };
};

// Custom quotation (invitations, custom decoration, special menus): requirements now, price from the vendor.
const quote: Handler = (ctx) => {
  const starts = new Date(ctx.req.startsAt);
  const ends = needEnd(ctx, 60);
  checkTimes(starts, ends, { ...ctx.rules, minDurationMin: undefined, maxDurationMin: undefined }, ctx.now);
  const answers = answersFor(ctx);
  return {
    starts,
    ends,
    occupyFrom: starts,
    occupyUntil: ends,
    returnDue: null,
    quantity: ctx.req.quantity ?? 1,
    lines: [],
    stock: [],
    needs: [],
    depositPaise: 0,
    priceKind: 'indicative',
    notes: ['The vendor sends a price after reading your requirements. Nothing is paid until you accept it.'],
    answers,
  };
};

export const HANDLERS: Record<Exclude<BookingTypeKey, 'slot'>, Handler> = {
  time_window: timeWindow,
  rental,
  per_person: perPerson,
  staffing,
  appointment,
  transport,
  quote,
};
