// The booking rules engine: one quote/request path for every booking type except the old day+slot
// one (which stays in BookingsService.request). After the request, the existing BookingsService
// lifecycle (accept → pay → confirm → complete, cancel, expire, refunds, payouts) carries on, with the
// engine's holds renewed, activated and released at each step.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { decrypt } from '../common/crypto';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { postBookingEvent } from '../chat/booking-events';
import { pointOf } from '../bookings/travel';
import { HANDLERS, travelLine, type ItemRow, type PlanContext, type ResourceRow, type ServiceRow } from './booking-types';
import { checkAll, holdAll, Unavailable } from './reservations';
import { DEFAULT_CANCELLATION, effectiveRules, istDay, parseTime } from './rules';
import type { BookingTypeKey, CategoryTemplate, EngineRequest, Need, Quote, QuoteLine } from './types';

const HOUR = 3600_000;
/** The vendor answers within 24 h, and at least an hour before the service starts. */
export function engineRespondBy(starts: Date, now = new Date()): Date | null {
  const by = Math.min(now.getTime() + 24 * HOUR, starts.getTime() - HOUR);
  return by - now.getTime() < 30 * 60_000 ? null : new Date(by);
}
export const enginePayBy = (starts: Date, now = new Date()) => new Date(Math.min(now.getTime() + 24 * HOUR, starts.getTime()));

interface Loaded {
  ctx: PlanContext;
  vendor: { id: string; user_id: string; business_name: string; status: string };
  event: { id: string; event_date: string };
  category: { booking_type: BookingTypeKey; template: CategoryTemplate };
  addons: { id: string; name: string; price_paise: number; requires_approval: boolean; setup_minutes: number }[];
}

export interface Priced {
  quote: Quote;
  plan: ReturnType<(typeof HANDLERS)['rental']>;
  loaded: Loaded;
  commissionPaise: number;
  addonRows: { id: string; price: number; status: 'included' | 'pending_approval'; note?: string }[];
}

@Injectable()
export class EngineService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Everything needed to price and hold one request. Throws clear errors for anything not bookable. */
  private async load(q: Queryable, customerId: string, req: EngineRequest, now: Date): Promise<Loaded> {
    parseTime(req.startsAt, 'startsAt');
    if (req.endsAt !== undefined) parseTime(req.endsAt, 'endsAt');
    const event = await this.db.one<{ id: string; event_date: string; venue_lat: string | null; venue_lng: string | null }>(
      q,
      'SELECT id, event_date, venue_lat, venue_lng FROM events WHERE id = $1 AND customer_id = $2',
      [req.eventId, customerId],
    );
    if (!event) throw new AppError('EVENT_NOT_FOUND', 'Event not found.', HttpStatus.NOT_FOUND);
    const svc = await this.db.one<ServiceRow & { is_active: boolean; vendor_status: string; vendor_user_id: string; business_name: string;
      vendor_lat: string | null; vendor_lng: string | null; booking_type_cat: BookingTypeKey; template: CategoryTemplate }>(
      q,
      `SELECT s.id, s.vendor_id, s.title, s.booking_type, s.pricing, s.rules, s.attributes, s.resource_id, s.min_guests, s.max_guests, s.is_active,
              v.status AS vendor_status, v.user_id AS vendor_user_id, v.business_name, v.lat AS vendor_lat, v.lng AS vendor_lng,
              c.booking_type AS booking_type_cat, c.template
         FROM services s JOIN vendors v ON v.id = s.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE s.id = $1`,
      [req.serviceId],
    );
    if (!svc || !svc.is_active || svc.vendor_status !== 'approved') throw new AppError('ITEM_NOT_FOUND', 'This service is not offered any more.', HttpStatus.NOT_FOUND);
    if (svc.vendor_user_id === customerId) throw new AppError('OWN_VENDOR', 'You cannot book your own business.');
    if (svc.booking_type === 'slot') throw new AppError('USE_SLOT_BOOKING', 'Book this service by date and slot.', HttpStatus.BAD_REQUEST);
    const type = svc.booking_type as Exclude<BookingTypeKey, 'slot'>;
    const rules = effectiveRules(type, svc.template ?? {}, svc.rules ?? {});

    // A wedding's services can sit a few days around the main date (mehendi before, returns after).
    const startDay = istDay(new Date(req.startsAt));
    const gap = Math.abs(Date.parse(`${startDay}T00:00:00Z`) - Date.parse(`${event.event_date}T00:00:00Z`)) / 86_400_000;
    if (gap > 7) throw new AppError('OUTSIDE_EVENT_DATES', 'Pick a time within a week of the event date.', HttpStatus.BAD_REQUEST, { eventDate: event.event_date });

    const items = new Map<string, ItemRow>();
    if (type === 'rental') {
      const { rows } = await q.query<ItemRow>(
        `SELECT i.id, i.name, i.unit, i.total_qty - i.repair_qty AS available, i.rent_paise, i.rent_per, i.deposit_paise, i.min_qty, i.max_qty,
                i.min_days, i.max_days, i.damage_paise, i.missing_paise, i.quality, i.quality_label, i.condition, c.name_en AS category
           FROM inventory_items i LEFT JOIN item_categories c ON c.id = i.category_id
          WHERE i.vendor_id = $1 AND i.is_active AND i.deleted_at IS NULL AND i.condition <> 'needs_repair' AND i.id = ANY($2::uuid[])`,
        [svc.vendor_id, (req.lines ?? []).map((l) => l.itemId).filter((id) => /^[0-9a-f-]{36}$/i.test(id))],
      );
      for (const r of rows) items.set(r.id, r);
    }
    const resource = svc.resource_id
      ? ((await this.db.one<ResourceRow>(q, 'SELECT id, kind, name, status, verification, attributes FROM resources WHERE id = $1', [svc.resource_id])) ?? null)
      : null;
    let crewId: string | null = null;
    if (!resource && (type === 'time_window' || type === 'appointment')) crewId = await this.crewOf(q, svc.vendor_id);
    let poolSize = 0;
    const poolKind = type === 'transport' ? 'driver' : type === 'staffing' ? (svc.template?.staffKind ?? null) : null;
    if (poolKind) {
      poolSize = (await this.db.one<{ n: number }>(
        q,
        `SELECT count(*)::int AS n FROM resources WHERE vendor_id = $1 AND kind = $2 AND status = 'active' AND verification IN ('approved', 'not_required')`,
        [svc.vendor_id, poolKind === 'driver' ? 'driver' : 'staff'],
      ))!.n;
    }
    const addons = (await q.query(
      `SELECT id, name, price_paise, requires_approval, setup_minutes FROM service_addons
        WHERE vendor_id = $1 AND is_active AND (service_id IS NULL OR service_id = $2) AND id = ANY($3::uuid[])`,
      [svc.vendor_id, svc.id, (req.addons ?? []).map((a) => a.addonId).filter((id) => /^[0-9a-f-]{36}$/i.test(id))],
    )).rows as Loaded['addons'];
    if (addons.length !== (req.addons ?? []).length) throw new AppError('ADDON_NOT_FOUND', 'One of the extras is not offered.', HttpStatus.BAD_REQUEST);

    return {
      ctx: {
        type,
        service: svc,
        template: svc.template ?? {},
        rules,
        req,
        vendorBase: pointOf(svc.vendor_lat, svc.vendor_lng),
        venue: pointOf(event.venue_lat, event.venue_lng),
        items,
        resource,
        crewId,
        poolSize,
        now,
      },
      vendor: { id: svc.vendor_id, user_id: svc.vendor_user_id, business_name: svc.business_name, status: svc.vendor_status },
      event,
      category: { booking_type: svc.booking_type_cat, template: svc.template ?? {} },
      addons,
    };
  }

  /** The vendor's own team as one exclusive resource, made the first time it is needed. */
  private async crewOf(q: Queryable, vendorId: string): Promise<string> {
    const found = await this.db.one<{ id: string }>(q, `SELECT id FROM resources WHERE vendor_id = $1 AND kind = 'crew' ORDER BY created_at LIMIT 1`, [vendorId]);
    if (found) return found.id;
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crew:${vendorId}`]);
    const again = await this.db.one<{ id: string }>(q, `SELECT id FROM resources WHERE vendor_id = $1 AND kind = 'crew' ORDER BY created_at LIMIT 1`, [vendorId]);
    if (again) return again.id;
    return (await this.db.one<{ id: string }>(q, `INSERT INTO resources (vendor_id, kind, name) VALUES ($1, 'crew', 'Main team') RETURNING id`, [vendorId]))!.id;
  }

  private async price(q: Queryable, customerId: string, req: EngineRequest, now = new Date()): Promise<Priced> {
    const loaded = await this.load(q, customerId, req, now);
    const { ctx } = loaded;
    const plan = HANDLERS[ctx.type as Exclude<BookingTypeKey, 'slot'>](ctx);
    const p = ctx.service.pricing;
    const lines: QuoteLine[] = [...plan.lines];

    // Add-ons (decoration packages, album, drone …). Ones needing approval are priced but not promised.
    const addonRows: Priced['addonRows'] = [];
    let priceKind = plan.priceKind;
    for (const a of loaded.addons) {
      const note = req.addons!.find((x) => x.addonId === a.id)?.note?.trim().slice(0, 500);
      lines.push({ code: `addon_${a.id}`, label: a.requires_approval ? `${a.name} (needs vendor approval)` : a.name, qty: 1, unitPaise: a.price_paise, amountPaise: a.price_paise, kind: 'addon' });
      addonRows.push({ id: a.id, price: a.price_paise, status: a.requires_approval ? 'pending_approval' : 'included', note });
      if (a.requires_approval) priceKind = 'indicative';
    }
    // Travel / delivery to the venue for services that come to the customer (transport prices its own pickup).
    if (ctx.type !== 'transport') {
      const t = travelLine(p, ctx.vendorBase, ctx.venue);
      if (t) lines.push(t);
    }
    const subtotal = lines.reduce((s, l) => s + l.amountPaise, 0);
    const taxPaise = p.taxPercent ? Math.round((subtotal * p.taxPercent) / 100) : 0;
    if (taxPaise) lines.push({ code: 'tax', label: `GST ${p.taxPercent}%`, qty: 1, unitPaise: taxPaise, amountPaise: taxPaise, kind: 'tax' });
    const total = subtotal + taxPaise;
    const r = ctx.rules;
    const advance = total === 0 ? 0 : r.advance?.fixedPaise ? Math.min(r.advance.fixedPaise, total) : Math.round((total * (r.advance?.percent ?? this.config.advancePercent)) / 100);
    const deposit = plan.depositPaise + (r.deposit?.fixedPaise && ctx.type !== 'transport' ? r.deposit.fixedPaise : 0) + (r.deposit?.percent ? Math.round((subtotal * r.deposit.percent) / 100) : 0);
    if (deposit) lines.push({ code: 'deposit', label: 'Refundable security deposit', qty: 1, unitPaise: deposit, amountPaise: deposit, kind: 'deposit' });

    const quote: Quote = {
      lines,
      subtotalPaise: subtotal,
      taxPaise,
      totalPaise: total,
      advancePaise: advance,
      balancePaise: total - advance,
      depositPaise: deposit,
      priceKind,
      startsAt: plan.starts.toISOString(),
      endsAt: plan.ends.toISOString(),
      occupyFrom: plan.occupyFrom.toISOString(),
      occupyUntil: plan.occupyUntil.toISOString(),
      returnDueAt: plan.returnDue?.toISOString() ?? null,
      estKm: plan.estKm,
      cancellation: r.cancellation ?? DEFAULT_CANCELLATION,
      approval: priceKind === 'indicative' ? 'vendor' : (r.approval ?? 'vendor'),
      notes: [...plan.notes, ...(r.instructions ? [r.instructions] : [])],
    };
    return { quote, plan, loaded, commissionPaise: Math.round((subtotal * this.config.commissionPercent) / 100), addonRows };
  }

  /** Customers and vendors may hold a self-drive car only with a valid licence and the minimum age. */
  private async checkLicence(q: Queryable, customerId: string, p: Priced) {
    const { ctx } = p.loaded;
    const needs = ctx.type === 'transport' && (p.plan.answers.mode === 'self_drive');
    const docs = ctx.rules.requiredDocuments ?? [];
    if (!needs && !docs.includes('driving_licence')) return;
    const lic = await this.db.one<{ date_of_birth: string; expires_on: string; status: string }>(
      q,
      'SELECT date_of_birth, expires_on, status FROM customer_licences WHERE user_id = $1',
      [customerId],
    );
    if (!lic || lic.status === 'rejected') {
      throw new AppError('LICENCE_REQUIRED', 'Add your driving licence before booking a self-drive car.', HttpStatus.BAD_REQUEST);
    }
    const ends = p.plan.ends;
    if (new Date(`${lic.expires_on}T23:59:59+05:30`) < ends) throw new AppError('LICENCE_EXPIRED', 'Your driving licence expires before the booking ends.', HttpStatus.BAD_REQUEST);
    const minAge = Math.max(18, ctx.rules.minAge ?? 18);
    const dob = new Date(`${lic.date_of_birth}T00:00:00Z`);
    const starts = p.plan.starts;
    const age = starts.getUTCFullYear() - dob.getUTCFullYear() - (starts.getUTCMonth() * 100 + starts.getUTCDate() < dob.getUTCMonth() * 100 + dob.getUTCDate() ? 1 : 0);
    if (age < minAge) throw new AppError('TOO_YOUNG', `Self-drive needs a driver aged ${minAge} or more.`, HttpStatus.BAD_REQUEST, { minAge });
  }

  /** The vendor's own calendar blocks (and old slot bookings) also stop their team being booked. */
  private async checkVendorCalendar(q: Queryable, vendorId: string, needs: Need[], from: Date, until: Date, crewId: string | null) {
    if (!crewId || !needs.some((n) => n.kind === 'resource' && n.resourceId === crewId)) return;
    const clash = await this.db.one(
      q,
      `SELECT 1 FROM availability a
        WHERE a.vendor_id = $1 AND tstzrange(
                (a.day + CASE a.slot WHEN 'day' THEN time '10:00' WHEN 'night' THEN time '18:00' ELSE time '00:00' END) AT TIME ZONE 'Asia/Kolkata',
                (a.day + CASE a.slot WHEN 'day' THEN time '16:00' WHEN 'night' THEN time '23:59' ELSE time '23:59' END) AT TIME ZONE 'Asia/Kolkata')
              && tstzrange($2, $3) LIMIT 1`,
      [vendorId, from, until],
    );
    if (clash) throw new Unavailable('vendor calendar');
  }

  async quote(customerId: string, req: EngineRequest): Promise<Quote> {
    return this.db.tx(async (client) => {
      const p = await this.price(client, customerId, req);
      await this.checkLicence(client, customerId, p);
      await this.checkVendorCalendar(client, p.loaded.vendor.id, p.plan.needs, p.plan.occupyFrom, p.plan.occupyUntil, p.loaded.ctx.crewId);
      await checkAll(client, p.plan.needs, p.plan.occupyFrom, p.plan.occupyUntil);
      return p.quote;
    });
  }

  /**
   * Creates the booking and holds what it needs until the vendor answers (or, with automatic
   * approval, until the advance is due). Repeating the same Idempotency-Key returns the same booking.
   */
  async request(customerId: string, req: EngineRequest, idempotencyKey?: string): Promise<string> {
    if (idempotencyKey) {
      const existing = await this.db.one<{ id: string }>(this.db, 'SELECT id FROM bookings WHERE customer_id = $1 AND idempotency_key = $2', [customerId, idempotencyKey]);
      if (existing) return existing.id;
    }
    try {
      return await this.db.tx(async (client) => {
        const now = new Date();
        const p = await this.price(client, customerId, req, now);
        await this.checkLicence(client, customerId, p);
        const { plan, quote, loaded } = p;
        await this.checkVendorCalendar(client, loaded.vendor.id, plan.needs, plan.occupyFrom, plan.occupyUntil, loaded.ctx.crewId);
        const respondBy = engineRespondBy(plan.starts, now);
        if (!respondBy) throw new AppError('TOO_LATE_TO_BOOK', 'This starts too soon to book in the app. Please call or chat with the vendor.', HttpStatus.CONFLICT);
        const auto = quote.approval === 'auto';
        const payBy = auto ? enginePayBy(plan.starts, now) : null;
        const snapshot = {
          bookingType: loaded.ctx.type,
          service: { id: loaded.ctx.service.id, title: loaded.ctx.service.title, pricing: loaded.ctx.service.pricing, attributes: loaded.ctx.service.attributes },
          resource: loaded.ctx.resource ? { id: loaded.ctx.resource.id, name: loaded.ctx.resource.name, attributes: loaded.ctx.resource.attributes } : null,
          rules: loaded.ctx.rules,
          quote,
          answers: plan.answers,
          route: req.route ?? null,
          mode: plan.answers.mode ?? null,
          needs: plan.needs,
          addons: p.addonRows,
        };
        const booking = await this.db.one<{ id: string }>(
          client,
          `INSERT INTO bookings (event_id, customer_id, vendor_id, service_id, day, slot, quantity, details, amount_paise, advance_paise,
                                 commission_paise, tax_paise, deposit_paise, respond_by, pay_by, status, booking_type, starts_at, ends_at,
                                 occupy_from, occupy_until, return_due_at, snapshot, cancellation_policy, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, 'full', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::booking_status, $16, $17, $18, $19, $20, $21, $22, $23, $24)
           RETURNING id`,
          [req.eventId, customerId, loaded.vendor.id, loaded.ctx.service.id, istDay(plan.starts), plan.quantity,
            { note: req.note?.trim().slice(0, 500) || null }, quote.totalPaise, quote.advancePaise, p.commissionPaise, quote.taxPaise, quote.depositPaise,
            respondBy, payBy, auto ? 'accepted' : 'requested', loaded.ctx.type, plan.starts, plan.ends, plan.occupyFrom, plan.occupyUntil,
            plan.returnDue, snapshot, quote.cancellation, idempotencyKey ?? null],
        );
        const id = booking!.id;
        for (const s of plan.stock) {
          // What was agreed stays with the booking even if the vendor edits the listing later.
          const it = loaded.ctx.items.get(s.itemId)!;
          await client.query(
            `INSERT INTO booking_lines (booking_id, inventory_item_id, qty, unit_paise, deposit_paise, damage_paise, missing_paise, item_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, s.itemId, s.qty, s.unitPaise, s.depositPaise, it.damage_paise, it.missing_paise || it.damage_paise, {
              name: it.name, unit: it.unit, category: it.category, quality: it.quality, qualityLabel: it.quality_label, condition: it.condition,
              rentPaise: it.rent_paise, rentPer: it.rent_per, depositPaise: it.deposit_paise,
            }],
          );
        }
        for (const a of p.addonRows) {
          await client.query(`INSERT INTO booking_addons (booking_id, addon_id, price_paise, request_note, status) VALUES ($1, $2, $3, $4, $5)`, [
            id, a.id, a.price, a.note ?? null, a.status,
          ]);
        }
        await holdAll(client, plan.needs, {
          bookingId: id,
          vendorId: loaded.vendor.id,
          from: plan.occupyFrom,
          until: plan.occupyUntil,
          status: 'hold',
          expiresAt: payBy ?? respondBy,
        });
        await client.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, 'requested', $2, $3)`, [
          id, customerId, { type: loaded.ctx.type, totalPaise: quote.totalPaise, priceKind: quote.priceKind, auto },
        ]);
        const when = plan.starts.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
        await notify(client, loaded.vendor.user_id, 'booking_requested', {
          en: { title: auto ? 'New booking' : 'New booking request', body: `${loaded.ctx.service.title}, ${when}.${auto ? ' The customer is paying the advance.' : ' Please reply soon.'}` },
          hi: { title: auto ? 'नई बुकिंग' : 'नई बुकिंग रिक्वेस्ट', body: `${loaded.ctx.service.title}, ${when}।${auto ? ' ग्राहक एडवांस दे रहे हैं।' : ' जल्दी जवाब दें।'}` },
        }, { bookingId: id }, 'partner');
        await notify(client, customerId, 'booking_request_received', {
          en: { title: 'Request sent', body: auto ? `Pay the advance to confirm ${loaded.ctx.service.title}.` : `${loaded.vendor.business_name} will reply soon.` },
          hi: { title: 'रिक्वेस्ट भेजी गई', body: auto ? `${loaded.ctx.service.title} पक्का करने के लिए एडवांस दें।` : `${loaded.vendor.business_name} जल्द जवाब देंगे।` },
        }, { bookingId: id }, 'customer');
        await postBookingEvent(client, { id, customer_id: customerId, vendor_id: loaded.vendor.id }, auto ? 'accepted' : 'requested', customerId, {
          item: loaded.ctx.service.title,
          day: istDay(plan.starts),
        });
        return id;
      });
    } catch (err) {
      // Two taps with the same key at once: the second hits the unique index; return the first.
      if (idempotencyKey && (err as { code?: string }).code === '23505') {
        const existing = await this.db.one<{ id: string }>(this.db, 'SELECT id FROM bookings WHERE customer_id = $1 AND idempotency_key = $2', [customerId, idempotencyKey]);
        if (existing) return existing.id;
      }
      throw err;
    }
  }

  /** Licence for self-drive: the number is encrypted; only the last 4 digits are ever shown. */
  async saveLicence(userId: string, body: { number: string; dateOfBirth: string; expiresOn: string; storageKey?: string }) {
    const number = body.number.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,14}$/.test(number)) throw new AppError('VALIDATION', 'Enter the licence number as printed (e.g. UP70 20190012345).', HttpStatus.BAD_REQUEST, { field: 'number' });
    const { encrypt } = await import('../common/crypto');
    await this.db.query(
      `INSERT INTO customer_licences (user_id, number_enc, number_last4, date_of_birth, expires_on, storage_key, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', now())
       ON CONFLICT (user_id) DO UPDATE SET number_enc = $2, number_last4 = $3, date_of_birth = $4, expires_on = $5,
         storage_key = COALESCE($6, customer_licences.storage_key), status = 'pending', reject_reason = NULL, updated_at = now()`,
      [userId, encrypt(number, this.config.bankDetailsKey), number.slice(-4), body.dateOfBirth, body.expiresOn, body.storageKey ?? null],
    );
    return this.licence(userId);
  }

  async licence(userId: string) {
    return (
      (await this.db.one(
        this.db,
        `SELECT number_last4 AS "last4", date_of_birth AS "dateOfBirth", expires_on AS "expiresOn", status, reject_reason AS "rejectReason"
           FROM customer_licences WHERE user_id = $1`,
        [userId],
      )) ?? null
    );
  }

  /** Licences waiting for a verifier, oldest first, with the full number (verifiers only). */
  async pendingLicences() {
    const { rows } = await this.db.query<{ userId: string; name: string | null; number_enc: string; dateOfBirth: string; expiresOn: string; createdAt: Date }>(
      `SELECT l.user_id AS "userId", u.name, l.number_enc, l.date_of_birth AS "dateOfBirth", l.expires_on AS "expiresOn", l.updated_at AS "createdAt"
         FROM customer_licences l JOIN users u ON u.id = l.user_id WHERE l.status = 'pending' ORDER BY l.updated_at LIMIT 200`,
    );
    return rows.map(({ number_enc, ...r }) => ({ ...r, number: decrypt(number_enc, this.config.bankDetailsKey) }));
  }

  async verifyLicence(adminId: string, userId: string, decision: 'verify' | 'reject', reason?: string) {
    return this.db.tx(async (client) => {
      const l = await this.db.one<{ status: string }>(client, 'SELECT status FROM customer_licences WHERE user_id = $1 FOR UPDATE', [userId]);
      if (!l) throw new AppError('NOT_FOUND', 'Licence not found.', HttpStatus.NOT_FOUND);
      if (decision === 'reject' && !reason?.trim()) throw new AppError('VALIDATION', 'Give a reason.', HttpStatus.BAD_REQUEST, { field: 'reason' });
      const status = decision === 'verify' ? 'verified' : 'rejected';
      await client.query('UPDATE customer_licences SET status = $2, reject_reason = $3, updated_at = now() WHERE user_id = $1', [userId, status, decision === 'reject' ? reason!.trim() : null]);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'licence', $3, $4, $5)`,
        [adminId, `licence.${decision}`, userId, { status: l.status }, { status, reason: reason ?? null }],
      );
      await notify(client, userId, 'licence_checked', decision === 'verify'
        ? { en: { title: 'Licence verified', body: 'You can now take self-drive cars.' }, hi: { title: 'लाइसेंस सत्यापित', body: 'अब आप खुद चलाने वाली गाड़ियाँ ले सकते हैं।' } }
        : { en: { title: 'Licence not accepted', body: `${reason}. Please check and add it again.` }, hi: { title: 'लाइसेंस स्वीकार नहीं', body: `${reason}। कृपया जाँचकर दोबारा जोड़ें।` } },
      {}, 'customer');
      return { userId, status };
    });
  }

  /** Full licence number, for the vendor at handover or a verifier (audited by the caller). */
  async licenceNumber(userId: string): Promise<string | null> {
    const row = await this.db.one<{ number_enc: string }>(this.db, 'SELECT number_enc FROM customer_licences WHERE user_id = $1', [userId]);
    return row ? decrypt(row.number_enc, this.config.bankDetailsKey) : null;
  }
}
