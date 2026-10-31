// Booking several services at once (a "cart", possibly from several vendors): every booking is made
// in one transaction, so either all of them hold their times and stock, or none does. Vendor bundles
// group services that must be booked together (mandatory items) and may give a discount on them.
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError, assertExpectedTotal } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { EngineService } from './engine.service';
import type { EngineRequest, Quote } from './types';

export const MAX_CHECKOUT_ITEMS = 10;

export interface BundleInput {
  name?: string;
  description?: string | null;
  discountPercent?: number;
  items?: { serviceId: string; mandatory: boolean }[];
  isActive?: boolean;
}

interface BundleRow {
  /** null for an EventSeva package, which is not owned by any one vendor. */
  vendor_id: string | null;
  id: string;
  discount_percent: number;
  items: { serviceId: string; mandatory: boolean }[];
}

/** What an admin sends when curating an EventSeva package. */
export interface AdminPackageInput extends BundleInput {
  nameHi?: string;
  descriptionHi?: string | null;
  eventType?: string;
  sortOrder?: number;
}

const PACKAGE_COLUMNS = `b.id, b.name, b.name_hi AS "nameHi", b.description, b.description_hi AS "descriptionHi",
  b.event_type AS "eventType", b.discount_percent AS "discountPercent", b.items, b.sort_order AS "sortOrder",
  b.is_active AS "isActive", b.created_at AS "createdAt"`;

const BUNDLE_COLUMNS = `b.id, b.name, b.description, b.discount_percent AS "discountPercent", b.items, b.is_active AS "isActive", b.created_at AS "createdAt"`;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly db: Db,
    private readonly engine: EngineService,
  ) {}

  // ---------- vendor bundles ----------

  private async vendorId(q: Queryable, userId: string) {
    const v = await this.db.one<{ id: string }>(q, 'SELECT id FROM vendors WHERE user_id = $1', [userId]);
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v.id;
  }

  private async checkItems(q: Queryable, vendorId: string, items: { serviceId: string; mandatory: boolean }[]) {
    if (items.length < 2 || items.length > MAX_CHECKOUT_ITEMS) throw new AppError('VALIDATION', `A bundle has 2 to ${MAX_CHECKOUT_ITEMS} services.`, HttpStatus.BAD_REQUEST, { field: 'items' });
    if (new Set(items.map((i) => i.serviceId)).size !== items.length) throw new AppError('VALIDATION', 'Each service once, please.', HttpStatus.BAD_REQUEST, { field: 'items' });
    if (!items.some((i) => i.mandatory)) throw new AppError('VALIDATION', 'Mark at least one service as included in every booking.', HttpStatus.BAD_REQUEST, { field: 'items' });
    const ok = await this.db.one<{ n: number }>(
      q,
      `SELECT count(*)::int AS n FROM services WHERE vendor_id = $1 AND is_active AND booking_type <> 'slot' AND id = ANY($2::uuid[])`,
      [vendorId, items.map((i) => i.serviceId)],
    );
    if (ok!.n !== items.length) throw new AppError('SERVICE_NOT_FOUND', 'Bundles can only contain your own active services booked by time or quantity.', HttpStatus.BAD_REQUEST);
  }

  async bundles(userId: string) {
    const vendorId = await this.vendorId(this.db, userId);
    return (await this.db.query(`SELECT ${BUNDLE_COLUMNS} FROM service_bundles b WHERE b.vendor_id = $1 AND b.is_active ORDER BY b.created_at`, [vendorId])).rows;
  }

  async createBundle(userId: string, body: BundleInput & { name: string; items: { serviceId: string; mandatory: boolean }[] }) {
    const vendorId = await this.vendorId(this.db, userId);
    await this.checkItems(this.db, vendorId, body.items);
    return this.db.one(
      this.db,
      `INSERT INTO service_bundles (vendor_id, name, description, discount_percent, items) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, description, discount_percent AS "discountPercent", items, is_active AS "isActive", created_at AS "createdAt"`,
      [vendorId, body.name.trim(), body.description?.trim() || null, body.discountPercent ?? 0, JSON.stringify(body.items)],
    );
  }

  async updateBundle(userId: string, id: string, body: BundleInput) {
    const vendorId = await this.vendorId(this.db, userId);
    if (body.items) await this.checkItems(this.db, vendorId, body.items);
    const row = await this.db.one(
      this.db,
      `UPDATE service_bundles SET name = COALESCE($3, name), description = CASE WHEN $4 THEN $5 ELSE description END,
              discount_percent = COALESCE($6, discount_percent), items = COALESCE($7, items), is_active = COALESCE($8, is_active)
        WHERE id = $1 AND vendor_id = $2 AND is_active
        RETURNING id, name, description, discount_percent AS "discountPercent", items, is_active AS "isActive", created_at AS "createdAt"`,
      [id, vendorId, body.name?.trim() ?? null, body.description !== undefined, body.description?.trim() || null, body.discountPercent ?? null,
        body.items ? JSON.stringify(body.items) : null, body.isActive ?? null],
    );
    if (!row) throw new AppError('NOT_FOUND', 'Bundle not found.', HttpStatus.NOT_FOUND);
    return row;
  }

  async removeBundle(userId: string, id: string) {
    await this.updateBundle(userId, id, { isActive: false });
  }

  /** Bundles customers can pick on a vendor page. */
  async publicBundles(vendorId: string) {
    const { rows } = await this.db.query(
      `SELECT ${BUNDLE_COLUMNS} FROM service_bundles b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.vendor_id = $1 AND b.is_active AND v.status = 'approved' ORDER BY b.created_at`,
      [vendorId],
    );
    return rows;
  }

  // ---------- EventSeva packages (admin-curated, across vendors) ----------

  /** Every service in an EventSeva package must be live and belong to an approved vendor. */
  private async assertVendorsLive(q: Queryable, serviceIds: string[]) {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT s.id FROM services s JOIN vendors v ON v.id = s.vendor_id
        WHERE s.id = ANY($1::uuid[]) AND s.is_active AND s.admin_disabled_at IS NULL AND v.status = 'approved'`,
      [serviceIds],
    );
    const live = new Set(rows.map((r) => r.id));
    const gone = serviceIds.filter((id) => !live.has(id));
    if (gone.length) {
      throw new AppError('PACKAGE_UNAVAILABLE', 'Part of this package is not available right now. Please pick the services yourself.',
        HttpStatus.CONFLICT, { unavailable: gone });
    }
  }

  private async checkPackageItems(items: { serviceId: string; mandatory: boolean }[]) {
    if (items.length < 2 || items.length > MAX_CHECKOUT_ITEMS) throw new AppError('VALIDATION', `A package has 2 to ${MAX_CHECKOUT_ITEMS} services.`, HttpStatus.BAD_REQUEST, { field: 'items' });
    if (new Set(items.map((i) => i.serviceId)).size !== items.length) throw new AppError('VALIDATION', 'Each service once, please.', HttpStatus.BAD_REQUEST, { field: 'items' });
    if (!items.some((i) => i.mandatory)) throw new AppError('VALIDATION', 'Mark at least one service as part of every booking.', HttpStatus.BAD_REQUEST, { field: 'items' });
    await this.assertVendorsLive(this.db, items.map((i) => i.serviceId));
  }

  /** Admin: every package, live or not. */
  async adminPackages() {
    const { rows } = await this.db.query(
      `SELECT ${PACKAGE_COLUMNS},
              (SELECT json_agg(json_build_object('serviceId', s.id, 'title', s.title, 'vendorId', v.id, 'vendorName', v.business_name,
                                                 'pricePaise', s.price_paise, 'live', s.is_active AND s.admin_disabled_at IS NULL AND v.status = 'approved'))
                 FROM services s JOIN vendors v ON v.id = s.vendor_id
                WHERE s.id = ANY(ARRAY(SELECT jsonb_array_elements(b.items)->>'serviceId')::uuid[])) AS services
         FROM service_bundles b WHERE b.vendor_id IS NULL ORDER BY b.is_active DESC, b.sort_order, b.created_at`,
    );
    return { items: rows };
  }

  /** Services an admin can put in a package: live ones, from approved vendors, searchable by name. */
  async packageableServices(q: string | undefined) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.title, s.price_paise AS "pricePaise", s.booking_type AS "bookingType",
              v.id AS "vendorId", v.business_name AS "vendorName", c.name_en AS "category"
         FROM services s JOIN vendors v ON v.id = s.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE s.is_active AND s.admin_disabled_at IS NULL AND v.status = 'approved'
          AND ($1::text IS NULL OR s.title ILIKE '%' || $1 || '%' OR v.business_name ILIKE '%' || $1 || '%')
        ORDER BY v.business_name, s.title LIMIT 50`,
      [q?.trim().replace(/[%_\\]/g, '\\$&') || null],
    );
    return { items: rows };
  }

  /**
   * A package decides what customers are offered and at what discount, so — like categories,
   * coupons and the platform settings — every change is written to the audit log with its before
   * and after, inside the same transaction as the change itself.
   */
  private async auditPackage(q: Queryable, adminId: string, action: string, id: string, before: object | null, after: object | null) {
    await q.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'package', $3, $4, $5)`,
      [adminId, action, id, before, after],
    );
  }

  async createPackage(adminId: string, body: AdminPackageInput & { name: string; nameHi: string; eventType: string; items: { serviceId: string; mandatory: boolean }[] }) {
    await this.checkPackageItems(body.items);
    return this.db.tx(async (client) => {
      const row = await this.db.one<{ id: string } & Record<string, unknown>>(
        client,
        `INSERT INTO service_bundles (vendor_id, name, name_hi, description, description_hi, event_type, discount_percent, items, sort_order, created_by)
         VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PACKAGE_COLUMNS.replace(/\bb\./g, '')}`,
        [body.name.trim(), body.nameHi.trim(), body.description?.trim() || null, body.descriptionHi?.trim() || null,
          body.eventType, body.discountPercent ?? 0, JSON.stringify(body.items), body.sortOrder ?? 0, adminId],
      );
      await this.auditPackage(client, adminId, 'package.create', row!.id, null, row!);
      return row;
    });
  }

  async updatePackage(adminId: string, id: string, body: AdminPackageInput) {
    if (body.items) await this.checkPackageItems(body.items);
    return this.db.tx(async (client) => {
      // Locked, so two admins editing the same package cannot both read the same "before".
      const before = await this.db.one(client, `SELECT ${PACKAGE_COLUMNS} FROM service_bundles b WHERE b.id = $1 AND b.vendor_id IS NULL FOR UPDATE`, [id]);
      if (!before) throw new AppError('NOT_FOUND', 'Package not found.', HttpStatus.NOT_FOUND);
      const row = await this.db.one(
        client,
        `UPDATE service_bundles SET name = COALESCE($2, name), name_hi = COALESCE($3, name_hi),
                description = CASE WHEN $4 THEN $5 ELSE description END,
                description_hi = CASE WHEN $6 THEN $7 ELSE description_hi END,
                event_type = COALESCE($8, event_type), discount_percent = COALESCE($9, discount_percent),
                items = COALESCE($10, items), sort_order = COALESCE($11, sort_order), is_active = COALESCE($12, is_active)
          WHERE id = $1 AND vendor_id IS NULL
          RETURNING ${PACKAGE_COLUMNS.replace(/\bb\./g, '')}`,
        [id, body.name?.trim() ?? null, body.nameHi?.trim() ?? null,
          body.description !== undefined, body.description?.trim() || null,
          body.descriptionHi !== undefined, body.descriptionHi?.trim() || null,
          body.eventType ?? null, body.discountPercent ?? null,
          body.items ? JSON.stringify(body.items) : null, body.sortOrder ?? null, body.isActive ?? null],
      );
      await this.auditPackage(client, adminId, 'package.update', id, before, row!);
      return row;
    });
  }

  /**
   * Customers browsing packages. Each one carries what it is made of and whether every part is
   * bookable right now, so the app can grey out a package instead of failing at checkout.
   */
  async publicPackages(eventType: string | undefined, lang: 'en' | 'hi') {
    const { rows } = await this.db.query(
      // One pass over each package's services: the list the app shows and whether all of it is
      // bookable come from the same join. Checking availability separately read every service and
      // vendor a second time.
      `SELECT b.id, ${lang === 'hi' ? 'b.name_hi' : 'b.name'} AS name, ${lang === 'hi' ? 'b.description_hi' : 'b.description'} AS description,
              b.event_type AS "eventType", b.discount_percent AS "discountPercent",
              -- Always a list, never null: a package pointing at a service row that no longer
              -- exists aggregates to null, and the apps would crash reading it before they ever
              -- saw that it is unavailable.
              COALESCE(p.services, '[]'::json) AS services,
              -- Bookable only when every part is live AND none has gone missing from the catalogue
              -- (the join would quietly drop a deleted service, so the count is checked too).
              COALESCE(p.all_live AND p.found = jsonb_array_length(b.items), false) AS available
         FROM service_bundles b
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object('serviceId', s.id, 'title', s.title,
                                             'vendorId', v.id, 'vendorName', v.business_name,
                                             'pricePaise', s.price_paise, 'unit', s.unit,
                                             'mandatory', (i->>'mandatory')::boolean) ORDER BY s.title) AS services,
                  bool_and(s.is_active AND s.admin_disabled_at IS NULL AND v.status = 'approved') AS all_live,
                  count(*) AS found
             FROM jsonb_array_elements(b.items) i
             JOIN services s ON s.id = (i->>'serviceId')::uuid
             JOIN vendors v ON v.id = s.vendor_id
         ) p ON true
        WHERE b.vendor_id IS NULL AND b.is_active AND ($1::text IS NULL OR b.event_type = $1)
        ORDER BY b.sort_order, b.created_at`,
      [eventType ?? null],
    );
    return { items: rows, language: lang };
  }

  // ---------- checkout ----------

  /** Which items get the bundle discount; refuses a bundle with a mandatory service missing. */
  private async bundleFor(q: Queryable, bundleId: string | undefined, items: EngineRequest[]): Promise<{ id: string; percent: number; services: Set<string> } | null> {
    if (!bundleId) return null;
    const b = await this.db.one<BundleRow>(
      q,
      // LEFT JOIN: an EventSeva package has no vendor of its own, so there is nothing to approve.
      `SELECT b.id, b.vendor_id, b.discount_percent, b.items FROM service_bundles b LEFT JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND b.is_active AND (b.vendor_id IS NULL OR v.status = 'approved')`,
      [bundleId],
    );
    if (!b) throw new AppError('BUNDLE_NOT_FOUND', 'This package is not offered any more.', HttpStatus.NOT_FOUND);
    const chosen = new Set(items.map((i) => i.serviceId));
    const missing = b.items.filter((i) => i.mandatory && !chosen.has(i.serviceId)).map((i) => i.serviceId);
    if (missing.length) throw new AppError('BUNDLE_INCOMPLETE', 'This package needs all its included services booked together.', HttpStatus.BAD_REQUEST, { missing });
    // An EventSeva package spans vendors, so "the vendor is approved" has to be asked of each one.
    // A vendor bundle was already checked through its own vendor in the query above.
    if (b.vendor_id === null) await this.assertVendorsLive(q, b.items.map((i) => i.serviceId));
    return { id: b.id, percent: b.discount_percent, services: new Set(b.items.map((i) => i.serviceId)) };
  }

  private checkCart(items: EngineRequest[]) {
    if (!items.length || items.length > MAX_CHECKOUT_ITEMS) throw new AppError('VALIDATION', `Book 1 to ${MAX_CHECKOUT_ITEMS} services at once.`, HttpStatus.BAD_REQUEST, { field: 'items' });
    if (new Set(items.map((i) => i.eventId)).size !== 1) throw new AppError('VALIDATION', 'Everything in one checkout is for the same event.', HttpStatus.BAD_REQUEST, { field: 'items' });
  }

  /** Says which line of the cart failed, so the app can point at it. */
  private atLine<T>(index: number, work: () => Promise<T>): Promise<T> {
    return work().catch((err) => {
      if (err instanceof AppError) throw new AppError(err.code, err.message, err.getStatus(), { ...(err.details ?? {}), itemIndex: index });
      throw err;
    });
  }

  /** Prices every line (with any bundle discount). Nothing is held. */
  async quote(customerId: string, items: EngineRequest[], bundleId?: string) {
    this.checkCart(items);
    const bundle = await this.bundleFor(this.db, bundleId, items);
    const quotes: Quote[] = [];
    for (const [i, item] of items.entries()) {
      quotes.push(await this.atLine(i, () => this.engine.quote(customerId, item, bundle?.services.has(item.serviceId) ? bundle.percent : 0)));
    }
    const sum = (k: 'totalPaise' | 'advancePaise' | 'depositPaise') => quotes.reduce((s, q) => s + q[k], 0);
    return { items: quotes, totalPaise: sum('totalPaise'), advancePaise: sum('advancePaise'), depositPaise: sum('depositPaise') };
  }

  /**
   * Makes every booking or none. Each line is checked and held exactly like a single request; one
   * conflict (`itemIndex` in the error) rolls the whole checkout back. The same Idempotency-Key
   * returns the same checkout.
   */
  async checkout(customerId: string, items: EngineRequest[], bundleId?: string, idempotencyKey?: string, expectedTotalPaise?: number) {
    this.checkCart(items);
    if (idempotencyKey) {
      const existing = await this.db.one<{ id: string }>(this.db, 'SELECT id FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2', [customerId, idempotencyKey]);
      if (existing) return this.view(customerId, existing.id);
    }
    let id: string;
    try {
      id = await this.db.tx(async (client) => {
        const bundle = await this.bundleFor(client, bundleId, items);
        const row = await this.db.one<{ id: string }>(
          client,
          'INSERT INTO checkouts (customer_id, event_id, idempotency_key) VALUES ($1, $2, $3) RETURNING id',
          [customerId, items[0].eventId, idempotencyKey ?? null],
        );
        for (const [i, item] of items.entries()) {
          const inBundle = bundle?.services.has(item.serviceId);
          await this.atLine(i, () => this.engine.create(client, customerId, item, {
            groupId: row!.id,
            ...(inBundle ? { bundleId: bundle!.id, discountPercent: bundle!.percent } : {}),
          }));
        }
        // The whole cart as priced now must be what the customer saw, or nothing is booked.
        const total = (await this.db.one<{ total: number }>(client, 'SELECT COALESCE(sum(amount_paise), 0)::int AS total FROM bookings WHERE group_id = $1', [row!.id]))!.total;
        assertExpectedTotal(expectedTotalPaise, total);
        return row!.id;
      });
    } catch (err) {
      if (idempotencyKey && (err as { code?: string }).code === '23505') {
        const existing = await this.db.one<{ id: string }>(this.db, 'SELECT id FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2', [customerId, idempotencyKey]);
        if (existing) return this.view(customerId, existing.id);
      }
      throw err;
    }
    return this.view(customerId, id);
  }

  async view(customerId: string, checkoutId: string) {
    const c = await this.db.one(this.db, 'SELECT id, event_id AS "eventId", created_at AS "createdAt" FROM checkouts WHERE id = $1 AND customer_id = $2', [checkoutId, customerId]);
    if (!c) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    const { rows } = await this.db.query(
      `SELECT b.id, b.status, b.state, b.pay_mode AS "payMode", b.pay_by AS "payBy", b.vendor_id AS "vendorId", v.business_name AS "businessName", s.title,
              b.amount_paise AS "amountPaise", b.advance_paise AS "advancePaise", (b.advance_paise - b.discount_paise) AS "payNowPaise",
              b.deposit_paise AS "depositPaise", b.starts_at AS "startsAt", b.ends_at AS "endsAt"
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN services s ON s.id = b.service_id
        WHERE b.group_id = $1 ORDER BY b.created_at`,
      [checkoutId],
    );
    // What "Pay together" would charge now: accepted online bookings still inside their payment time.
    const payable = rows.filter((r) => r.status === 'accepted' && r.payMode === 'online' && (!r.payBy || new Date(r.payBy) > new Date()));
    return { ...c, bookings: rows, payableNowPaise: payable.reduce((sum, r) => sum + Number(r.payNowPaise), 0), payableCount: payable.length };
  }
}
