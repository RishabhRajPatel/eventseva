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
  id: string;
  vendor_id: string;
  discount_percent: number;
  items: { serviceId: string; mandatory: boolean }[];
}

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

  // ---------- checkout ----------

  /** Which items get the bundle discount; refuses a bundle with a mandatory service missing. */
  private async bundleFor(q: Queryable, bundleId: string | undefined, items: EngineRequest[]): Promise<{ id: string; percent: number; services: Set<string> } | null> {
    if (!bundleId) return null;
    const b = await this.db.one<BundleRow>(
      q,
      `SELECT b.id, b.vendor_id, b.discount_percent, b.items FROM service_bundles b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND b.is_active AND v.status = 'approved'`,
      [bundleId],
    );
    if (!b) throw new AppError('BUNDLE_NOT_FOUND', 'This package is not offered any more.', HttpStatus.NOT_FOUND);
    const chosen = new Set(items.map((i) => i.serviceId));
    const missing = b.items.filter((i) => i.mandatory && !chosen.has(i.serviceId)).map((i) => i.serviceId);
    if (missing.length) throw new AppError('BUNDLE_INCOMPLETE', 'This package needs all its included services booked together.', HttpStatus.BAD_REQUEST, { missing });
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
