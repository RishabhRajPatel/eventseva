// Rental stock a vendor manages themselves (tent house, bartan, furniture, coolers …): items, their
// categories, date blocks and the rental settings customers book under. Bookings take stock through
// the booking engine's pools (`item:<id>`), so availability is always counted the same way.
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { lockPool, peakUsed, poolUsed } from '../engine/reservations';
import { checkPricing, checkRules, effectiveRules } from '../engine/rules';
import { recordConfigChange } from '../engine/config-history';
import type { PriceAdjustment, Pricing, RuleSet } from '../engine/types';
import { CloudinaryService } from '../media/cloudinary.service';

export const ITEM_QUALITIES = ['basic', 'standard', 'premium', 'custom'] as const;
export const ITEM_CONDITIONS = ['new', 'good', 'used', 'needs_repair'] as const;
export const RENT_PER = ['booking', 'day'] as const;
/** Units offered in the app; vendors may type their own. */
export const ITEM_UNITS = ['piece', 'set', 'pair', 'dozen'] as const;
export const MAX_ITEMS = 2000;
export const MAX_ITEM_PHOTOS = 8;
export const MAX_CUSTOM_CATEGORIES = 30;
const MAX_STOCK = 100_000;
const MAX_ITEM_PAISE = 10_000_000; // ₹1 lakh per unit

export interface ItemInput {
  name?: string;
  description?: string | null;
  categoryId?: string;
  unit?: string;
  rentPaise?: number;
  rentPer?: (typeof RENT_PER)[number];
  totalQty?: number;
  repairQty?: number;
  depositPaise?: number;
  damagePaise?: number;
  missingPaise?: number;
  minQty?: number;
  maxQty?: number | null;
  minDays?: number;
  maxDays?: number | null;
  quality?: (typeof ITEM_QUALITIES)[number];
  qualityLabel?: string | null;
  condition?: (typeof ITEM_CONDITIONS)[number];
  attributes?: Record<string, string | number | boolean>;
  isActive?: boolean;
}

export interface RentalSettings {
  deliveryFeePaise: number;
  travelFreeKm?: number;
  travelPerKmPaise?: number;
  minOrderPaise?: number;
  taxPercent?: 0 | 5 | 12 | 18 | 28;
  leadTimeHours?: number;
  setupMin?: number;
  dismantleMin?: number;
  bufferAfterMin?: number;
  approval?: 'vendor' | 'auto';
  instructions?: string;
  /** Customers may choose to pay the whole rental to the vendor in cash. */
  cashAllowed?: boolean;
  /** Price rules (weekend, season, event type) on the rent of the items. */
  adjustments?: PriceAdjustment[];
  workingDays?: number[];
  blockedDates?: string[];
  maxAdvanceDays?: number;
  maxPerDay?: number;
}

interface ItemRow {
  id: string;
  name: string;
  total_qty: number;
  repair_qty: number;
  is_active: boolean;
  deleted_at: Date | null;
}

const bad = (code: string, message: string, details?: Record<string, unknown>, status = HttpStatus.BAD_REQUEST) => new AppError(code, message, status, details);
const poolKey = (itemId: string) => `item:${itemId}`;

/** Everything the apps show for an item (owner view adds stock in repair and the status). */
const ITEM_COLUMNS = `i.id, i.name, i.description, i.category_id AS "categoryId", c.name_en AS "categoryName", c.name_hi AS "categoryNameHi",
  i.unit, i.rent_paise AS "rentPaise", i.rent_per AS "rentPer", i.total_qty AS "totalQty", i.repair_qty AS "repairQty",
  i.deposit_paise AS "depositPaise", i.damage_paise AS "damagePaise", COALESCE(NULLIF(i.missing_paise, 0), i.damage_paise) AS "missingPaise",
  i.min_qty AS "minQty", i.max_qty AS "maxQty", i.min_days AS "minDays", i.max_days AS "maxDays", i.quality, i.quality_label AS "qualityLabel",
  i.condition, i.attributes, i.is_active AS "isActive", i.updated_at AS "updatedAt",
  COALESCE((SELECT json_agg(json_build_object('id', m.id, 'publicId', m.public_id, 'width', m.width, 'height', m.height, 'blurhash', m.blurhash,
      'status', m.status) ORDER BY m.sort_order, m.created_at) FROM media m WHERE m.inventory_item_id = i.id AND m.status %PHOTO%), '[]') AS photos`;

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: Db,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async vendorOf(userId: string, q: Queryable = this.db): Promise<string> {
    const v = await this.db.one<{ id: string }>(q, 'SELECT id FROM vendors WHERE user_id = $1', [userId]);
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v.id;
  }

  // ---------- categories ----------

  async categories(vendorId: string) {
    const { rows } = await this.db.query(
      `SELECT c.id, c.key, c.name_en AS "nameEn", c.name_hi AS "nameHi", c.examples_en AS "examplesEn", c.examples_hi AS "examplesHi",
              c.vendor_id IS NOT NULL AS "isCustom",
              (SELECT count(*)::int FROM inventory_items i WHERE i.category_id = c.id AND i.vendor_id = $1 AND i.deleted_at IS NULL) AS "itemCount"
         FROM item_categories c
        WHERE c.is_active AND (c.vendor_id IS NULL OR c.vendor_id = $1)
        ORDER BY c.vendor_id IS NOT NULL, c.sort_order, c.name_en`,
      [vendorId],
    );
    return rows;
  }

  async addCategory(vendorId: string, nameEn: string, nameHi?: string) {
    const name = nameEn.trim().replace(/\s+/g, ' ');
    return this.db.tx(async (client) => {
      await client.query('SELECT 1 FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
      const n = await this.db.one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM item_categories WHERE vendor_id = $1 AND is_active', [vendorId]);
      if (n!.n >= MAX_CUSTOM_CATEGORIES) throw bad('LIMIT_REACHED', `You can add up to ${MAX_CUSTOM_CATEGORIES} categories of your own.`);
      const clash = await this.db.one(
        client,
        `SELECT 1 FROM item_categories WHERE is_active AND (vendor_id IS NULL OR vendor_id = $1) AND lower(name_en) = lower($2)`,
        [vendorId, name],
      );
      if (clash) throw bad('CATEGORY_EXISTS', 'You already have a category with this name.', undefined, HttpStatus.CONFLICT);
      return this.db.one(
        client,
        `INSERT INTO item_categories (vendor_id, name_en, name_hi) VALUES ($1, $2, $3)
         RETURNING id, key, name_en AS "nameEn", name_hi AS "nameHi", true AS "isCustom", 0 AS "itemCount"`,
        [vendorId, name, nameHi?.trim() || name],
      );
    });
  }

  /** A vendor's own category goes away; its items move to "Other event equipment". */
  async removeCategory(vendorId: string, categoryId: string) {
    await this.db.tx(async (client) => {
      const c = await this.db.one(client, 'SELECT 1 FROM item_categories WHERE id = $1 AND vendor_id = $2 AND is_active FOR UPDATE', [categoryId, vendorId]);
      if (!c) throw new AppError('NOT_FOUND', 'Category not found.', HttpStatus.NOT_FOUND);
      await client.query(
        `UPDATE inventory_items SET category_id = (SELECT id FROM item_categories WHERE key = 'equipment'), updated_at = now()
          WHERE vendor_id = $1 AND category_id = $2`,
        [vendorId, categoryId],
      );
      await client.query('UPDATE item_categories SET is_active = false WHERE id = $1', [categoryId]);
    });
  }

  private async checkCategory(q: Queryable, vendorId: string, categoryId: string) {
    const ok = await this.db.one(q, 'SELECT 1 FROM item_categories WHERE id = $1 AND is_active AND (vendor_id IS NULL OR vendor_id = $2)', [categoryId, vendorId]);
    if (!ok) throw bad('CATEGORY_NOT_FOUND', 'Choose one of your item categories.', { field: 'categoryId' });
  }

  // ---------- items ----------

  /** The vendor's items with what is free right now (stock out at events or held by bookings is taken off). */
  async list(vendorId: string, opts: { q?: string; categoryId?: string; includeInactive?: boolean } = {}) {
    const { rows } = await this.db.query(
      `SELECT ${ITEM_COLUMNS.replace('%PHOTO%', "<> 'uploading'")},
              GREATEST(0, i.total_qty - i.repair_qty - COALESCE((
                SELECT sum(h.qty) FROM capacity_holds h
                 WHERE h.pool_key = 'item:' || i.id AND (h.status = 'active' OR (h.status = 'hold' AND h.expires_at > now()))
                   AND (h.period @> now() OR (h.until_returned AND lower(h.period) <= now()))), 0))::int AS "availableNow",
              (SELECT count(DISTINCT l.booking_id)::int FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
                WHERE l.inventory_item_id = i.id AND b.status IN ('requested', 'accepted', 'confirmed')) AS "openBookings"
         FROM inventory_items i LEFT JOIN item_categories c ON c.id = i.category_id
        WHERE i.vendor_id = $1 AND i.deleted_at IS NULL AND ($2::boolean OR i.is_active)
          AND ($3::uuid IS NULL OR i.category_id = $3) AND ($4::text IS NULL OR i.name ILIKE '%' || $4 || '%')
        ORDER BY c.sort_order NULLS LAST, i.name`,
      [vendorId, opts.includeInactive ?? true, opts.categoryId ?? null, opts.q?.replace(/[%_\\]/g, '\\$&') || null],
    );
    return rows;
  }

  async get(vendorId: string, itemId: string) {
    const row = await this.db.one(
      this.db,
      `SELECT ${ITEM_COLUMNS.replace('%PHOTO%', "<> 'uploading'")} FROM inventory_items i LEFT JOIN item_categories c ON c.id = i.category_id
        WHERE i.id = $1 AND i.vendor_id = $2 AND i.deleted_at IS NULL`,
      [itemId, vendorId],
    );
    if (!row) throw new AppError('NOT_FOUND', 'Item not found.', HttpStatus.NOT_FOUND);
    return row;
  }

  /** Server-side rules for prices, stock and limits (on top of the DTO's shape checks). */
  private validate(merged: Required<Pick<ItemInput, 'totalQty' | 'repairQty' | 'minQty' | 'minDays' | 'quality'>> & ItemInput) {
    if (merged.repairQty > merged.totalQty) throw bad('VALIDATION', 'Units in repair cannot be more than the total stock.', { field: 'repairQty' });
    if (merged.maxQty != null && merged.maxQty < merged.minQty) throw bad('VALIDATION', 'The most per booking must be at least the least per booking.', { field: 'maxQty' });
    if (merged.maxDays != null && merged.maxDays < merged.minDays) throw bad('VALIDATION', 'The longest rental must be at least the shortest.', { field: 'maxDays' });
    if (merged.quality === 'custom' && !merged.qualityLabel?.trim()) throw bad('VALIDATION', 'Name your quality grade.', { field: 'qualityLabel' });
    for (const k of ['rentPaise', 'depositPaise', 'damagePaise', 'missingPaise'] as const) {
      const v = merged[k];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MAX_ITEM_PAISE)) throw bad('VALIDATION', `${k} must be 0 to ₹1 lakh, in paise.`, { field: k });
    }
    if (merged.totalQty > MAX_STOCK) throw bad('VALIDATION', `Stock can be up to ${MAX_STOCK}.`, { field: 'totalQty' });
    if (merged.attributes) {
      const entries = Object.entries(merged.attributes);
      if (entries.length > 20) throw bad('VALIDATION', 'Up to 20 extra details.', { field: 'attributes' });
      for (const [k, v] of entries) {
        if (!/^[\p{L}\p{N} _-]{1,30}$/u.test(k)) throw bad('VALIDATION', 'Detail names: up to 30 letters or numbers.', { field: 'attributes' });
        if (!['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 100) throw bad('VALIDATION', 'Detail values: up to 100 characters.', { field: 'attributes' });
      }
    }
  }

  async create(vendorId: string, body: ItemInput & { name: string; categoryId: string; rentPaise: number; totalQty: number }) {
    // DTO instances carry every declared field, unset ones as undefined: those must not hide the defaults.
    const given = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as typeof body;
    const merged = { repairQty: 0, minQty: 1, minDays: 1, quality: 'standard' as const, ...given };
    this.validate(merged);
    return this.db.tx(async (client) => {
      await client.query('SELECT 1 FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
      const n = await this.db.one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM inventory_items WHERE vendor_id = $1 AND deleted_at IS NULL', [vendorId]);
      if (n!.n >= MAX_ITEMS) throw bad('LIMIT_REACHED', `You can list up to ${MAX_ITEMS} items.`);
      await this.checkCategory(client, vendorId, body.categoryId);
      await this.ensureRentalService(client, vendorId);
      let row: { id: string } | undefined;
      try {
        row = await this.db.one<{ id: string }>(
          client,
          `INSERT INTO inventory_items (vendor_id, name, description, category_id, unit, rent_paise, rent_per, total_qty, repair_qty, deposit_paise,
                                        damage_paise, missing_paise, min_qty, max_qty, min_days, max_days, quality, quality_label, condition, attributes, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`,
          [vendorId, body.name.trim(), body.description?.trim() || null, body.categoryId, (body.unit ?? 'piece').trim().toLowerCase(), body.rentPaise,
            body.rentPer ?? 'booking', body.totalQty, merged.repairQty, body.depositPaise ?? 0, body.damagePaise ?? 0, body.missingPaise ?? 0,
            merged.minQty, body.maxQty ?? null, merged.minDays, body.maxDays ?? null, merged.quality, merged.quality === 'custom' ? body.qualityLabel!.trim() : null,
            body.condition ?? 'good', body.attributes ?? {}, body.isActive ?? true],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw bad('ITEM_EXISTS', 'You already have an item with this name.', { field: 'name' }, HttpStatus.CONFLICT);
        throw err;
      }
      if (body.totalQty > 0) {
        await client.query(`INSERT INTO inventory_movements (inventory_item_id, kind, qty, note) VALUES ($1, 'added', $2, 'Listed')`, [row!.id, body.totalQty]);
      }
      return row!.id;
    }).then((id) => this.get(vendorId, id));
  }

  /**
   * Edits apply to new bookings only: booked lines keep their own copy of the price and details.
   * Stock cannot drop below what bookings already hold at the busiest moment ahead.
   */
  async update(vendorId: string, itemId: string, body: ItemInput, actorId: string) {
    await this.db.tx(async (client) => {
      const cur = await this.db.one<ItemRow & { min_qty: number; max_qty: number | null; min_days: number; max_days: number | null; quality: (typeof ITEM_QUALITIES)[number];
        quality_label: string | null; rent_paise: number; deposit_paise: number; damage_paise: number; missing_paise: number }>(
        client,
        'SELECT * FROM inventory_items WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL FOR UPDATE',
        [itemId, vendorId],
      );
      if (!cur) throw new AppError('NOT_FOUND', 'Item not found.', HttpStatus.NOT_FOUND);
      const merged = {
        totalQty: body.totalQty ?? cur.total_qty,
        repairQty: body.repairQty ?? cur.repair_qty,
        minQty: body.minQty ?? cur.min_qty,
        maxQty: body.maxQty === undefined ? cur.max_qty : body.maxQty,
        minDays: body.minDays ?? cur.min_days,
        maxDays: body.maxDays === undefined ? cur.max_days : body.maxDays,
        quality: body.quality ?? cur.quality,
        qualityLabel: body.qualityLabel === undefined ? cur.quality_label : body.qualityLabel,
        rentPaise: body.rentPaise,
        depositPaise: body.depositPaise,
        damagePaise: body.damagePaise,
        missingPaise: body.missingPaise,
        attributes: body.attributes,
      };
      this.validate(merged);
      if (body.categoryId) await this.checkCategory(client, vendorId, body.categoryId);

      const usableBefore = cur.total_qty - cur.repair_qty;
      const usableAfter = merged.totalQty - merged.repairQty;
      if (usableAfter < usableBefore) {
        // Same lock as bookings use, so none can slip in while this is checked.
        await lockPool(client, poolKey(itemId));
        const committed = await peakUsed(client, poolKey(itemId), new Date());
        if (usableAfter < committed) {
          throw bad('STOCK_COMMITTED', `${committed} ${committed === 1 ? 'unit is' : 'units are'} already booked or out at events. Keep at least ${committed + merged.repairQty} in stock.`,
            { committed, minTotalQty: committed + merged.repairQty }, HttpStatus.CONFLICT);
        }
      }
      const set = (k: keyof ItemInput) => body[k] !== undefined;
      try {
        await client.query(
          `UPDATE inventory_items SET
              name = CASE WHEN $3 THEN $4 ELSE name END,
              description = CASE WHEN $5 THEN $6 ELSE description END,
              category_id = COALESCE($7, category_id),
              unit = COALESCE($8, unit),
              rent_paise = COALESCE($9, rent_paise),
              rent_per = COALESCE($10, rent_per),
              total_qty = $11, repair_qty = $12,
              deposit_paise = COALESCE($13, deposit_paise),
              damage_paise = COALESCE($14, damage_paise),
              missing_paise = COALESCE($15, missing_paise),
              min_qty = $16, max_qty = $17, min_days = $18, max_days = $19,
              quality = $20, quality_label = $21,
              condition = COALESCE($22, condition),
              attributes = COALESCE($23, attributes),
              is_active = COALESCE($24, is_active),
              updated_at = now()
            WHERE id = $1 AND vendor_id = $2`,
          [itemId, vendorId, set('name'), body.name?.trim() ?? null, set('description'), body.description?.trim() || null, body.categoryId ?? null,
            body.unit?.trim().toLowerCase() ?? null, body.rentPaise ?? null, body.rentPer ?? null, merged.totalQty, merged.repairQty,
            body.depositPaise ?? null, body.damagePaise ?? null, body.missingPaise ?? null, merged.minQty, merged.maxQty, merged.minDays, merged.maxDays,
            merged.quality, merged.quality === 'custom' ? merged.qualityLabel?.trim() : null, body.condition ?? null, body.attributes ?? null, body.isActive ?? null],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw bad('ITEM_EXISTS', 'You already have an item with this name.', { field: 'name' }, HttpStatus.CONFLICT);
        throw err;
      }
      // Every stock change is on record.
      const moves: [string, number][] = [];
      if (merged.totalQty !== cur.total_qty) moves.push([merged.totalQty > cur.total_qty ? 'added' : 'removed', Math.abs(merged.totalQty - cur.total_qty)]);
      if (merged.repairQty !== cur.repair_qty) moves.push([merged.repairQty > cur.repair_qty ? 'damaged' : 'repaired', Math.abs(merged.repairQty - cur.repair_qty)]);
      for (const [kind, qty] of moves) {
        await client.query(`INSERT INTO inventory_movements (inventory_item_id, kind, qty, note, actor_id) VALUES ($1, $2, $3, 'Stock edited', $4)`, [itemId, kind, qty, actorId]);
      }
    });
    return this.get(vendorId, itemId);
  }

  /**
   * Removes an item. One that bookings or stock records point to is archived instead (hidden and
   * not bookable, history intact); bookings already made for it still go ahead.
   */
  async remove(vendorId: string, itemId: string): Promise<{ result: 'deleted' | 'archived'; openBookings: number }> {
    const out = await this.db.tx(async (client) => {
      const cur = await this.db.one<ItemRow>(client, 'SELECT * FROM inventory_items WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL FOR UPDATE', [itemId, vendorId]);
      if (!cur) throw new AppError('NOT_FOUND', 'Item not found.', HttpStatus.NOT_FOUND);
      const refs = await this.db.one<{ lines: number; open: number; holds: number }>(
        client,
        `SELECT (SELECT count(*)::int FROM booking_lines WHERE inventory_item_id = $1) AS lines,
                (SELECT count(DISTINCT l.booking_id)::int FROM booking_lines l JOIN bookings b ON b.id = l.booking_id
                  WHERE l.inventory_item_id = $1 AND b.status IN ('requested', 'accepted', 'confirmed')) AS open,
                (SELECT count(*)::int FROM capacity_holds WHERE pool_key = $2) AS holds`,
        [itemId, poolKey(itemId)],
      );
      if (refs!.lines || refs!.holds) {
        await client.query('UPDATE inventory_items SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1', [itemId]);
        return { result: 'archived' as const, openBookings: refs!.open, photos: [] as string[] };
      }
      const photos = await client.query<{ public_id: string }>('DELETE FROM media WHERE inventory_item_id = $1 RETURNING public_id', [itemId]);
      await client.query('DELETE FROM inventory_movements WHERE inventory_item_id = $1', [itemId]);
      await client.query('DELETE FROM inventory_items WHERE id = $1', [itemId]);
      return { result: 'deleted' as const, openBookings: 0, photos: photos.rows.map((p) => p.public_id) };
    });
    for (const p of out.photos) await this.cloudinary.destroy(p, 'image');
    return { result: out.result, openBookings: out.openBookings };
  }

  /** Stock history for one item, newest first. */
  async movements(vendorId: string, itemId: string) {
    await this.get(vendorId, itemId);
    const { rows } = await this.db.query(
      `SELECT m.id, m.kind, m.qty, m.note, m.booking_id AS "bookingId", m.created_at AS "createdAt"
         FROM inventory_movements m WHERE m.inventory_item_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
      [itemId],
    );
    return rows;
  }

  // ---------- date blocks (stock kept back for the vendor's own use, cleaning, another order …) ----------

  async blocks(vendorId: string, itemId: string) {
    await this.get(vendorId, itemId);
    const { rows } = await this.db.query(
      `SELECT id, qty, lower(period) AS "from", upper(period) AS "until", note FROM capacity_holds
        WHERE pool_key = $1 AND booking_id IS NULL AND status = 'active' AND upper(period) > now() ORDER BY lower(period)`,
      [poolKey(itemId)],
    );
    return rows;
  }

  async addBlock(vendorId: string, itemId: string, body: { from: Date; until: Date; qty: number; note: string }) {
    if (!(body.until > body.from)) throw bad('TIME_ORDER', 'The block must end after it starts.');
    if (body.until.getTime() < Date.now()) throw bad('DATE_IN_PAST', 'This time has already passed.');
    if (body.until.getTime() - body.from.getTime() > 366 * 86_400_000) throw bad('VALIDATION', 'Block at most a year at a time.');
    return this.db.tx(async (client) => {
      const item = await this.db.one<ItemRow>(client, 'SELECT * FROM inventory_items WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL', [itemId, vendorId]);
      if (!item) throw new AppError('NOT_FOUND', 'Item not found.', HttpStatus.NOT_FOUND);
      await lockPool(client, poolKey(itemId));
      const used = await poolUsed(client, poolKey(itemId), body.from, body.until);
      const free = item.total_qty - item.repair_qty - used;
      if (body.qty > free) {
        throw bad('NOT_AVAILABLE', `Only ${Math.max(0, free)} are free at that time.`, { what: item.name, available: Math.max(0, free), requested: body.qty }, HttpStatus.CONFLICT);
      }
      return this.db.one(
        client,
        `INSERT INTO capacity_holds (pool_key, vendor_id, qty, period, status, note) VALUES ($1, $2, $3, tstzrange($4, $5), 'active', $6)
         RETURNING id, qty, lower(period) AS "from", upper(period) AS "until", note`,
        [poolKey(itemId), vendorId, body.qty, body.from, body.until, body.note.trim()],
      );
    });
  }

  async removeBlock(vendorId: string, itemId: string, blockId: string) {
    const r = await this.db.query(
      `UPDATE capacity_holds SET status = 'released' WHERE id = $1 AND pool_key = $2 AND vendor_id = $3 AND booking_id IS NULL AND status = 'active'`,
      [blockId, poolKey(itemId), vendorId],
    );
    if (!r.rowCount) throw new AppError('NOT_FOUND', 'Block not found.', HttpStatus.NOT_FOUND);
  }

  // ---------- rental settings (the vendor's "Rental items" service) ----------

  /** The service rentals are booked under: one per vendor, made with the first item. */
  async ensureRentalService(q: Queryable, vendorId: string): Promise<string> {
    const found = await this.db.one<{ id: string }>(q, `SELECT id FROM services WHERE vendor_id = $1 AND booking_type = 'rental' ORDER BY created_at LIMIT 1`, [vendorId]);
    if (found) return found.id;
    return (await this.db.one<{ id: string }>(
      q,
      `INSERT INTO services (vendor_id, title, description, price_paise, unit, booking_type, pricing, rules)
       VALUES ($1, 'Rental items', 'Tent, furniture, utensils and equipment on rent', 100, 'per_event', 'rental', $2, '{}') RETURNING id`,
      [vendorId, { model: 'per_unit', ratePaise: 0 }],
    ))!.id;
  }

  async settings(vendorId: string) {
    const s = await this.db.one<{ id: string; pricing: Pricing; rules: RuleSet; template: Record<string, unknown>; cash_allowed: boolean }>(
      this.db,
      `SELECT s.id, s.pricing, s.rules, s.cash_allowed, c.template FROM services s JOIN vendors v ON v.id = s.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE s.vendor_id = $1 AND s.booking_type = 'rental' ORDER BY s.created_at LIMIT 1`,
      [vendorId],
    );
    const pricing: Partial<Pricing> = s?.pricing ?? {};
    const rules = effectiveRules('rental', (s?.template as never) ?? {}, s?.rules ?? {});
    return {
      serviceId: s?.id ?? null,
      deliveryFeePaise: pricing.ratePaise ?? 0,
      travelFreeKm: pricing.travelFreeKm ?? null,
      travelPerKmPaise: pricing.travelPerKmPaise ?? null,
      minOrderPaise: pricing.minChargePaise ?? null,
      taxPercent: pricing.taxPercent ?? 0,
      leadTimeHours: rules.leadTimeHours ?? null,
      setupMin: rules.setupMin ?? 0,
      dismantleMin: rules.dismantleMin ?? 0,
      bufferAfterMin: rules.bufferAfterMin ?? 0,
      approval: rules.approval ?? 'vendor',
      instructions: rules.instructions ?? null,
      cancellation: rules.cancellation ?? null,
      cashAllowed: s?.cash_allowed ?? false,
      adjustments: pricing.adjustments ?? [],
      workingDays: rules.workingDays ?? null,
      blockedDates: rules.blockedDates ?? [],
      maxAdvanceDays: rules.maxAdvanceDays ?? null,
      maxPerDay: rules.maxPerDay ?? null,
    };
  }

  async saveSettings(vendorId: string, body: RentalSettings) {
    if (body.taxPercent) {
      const v = await this.db.one<{ gstin: string | null }>(this.db, 'SELECT gstin FROM vendors WHERE id = $1', [vendorId]);
      if (!v?.gstin) throw new AppError('GSTIN_REQUIRED', 'Add your GST number to your profile before charging GST.', HttpStatus.BAD_REQUEST, { field: 'taxPercent' });
    }
    const pricing = checkPricing({
      model: 'per_unit',
      ratePaise: body.deliveryFeePaise,
      ...(body.travelFreeKm !== undefined && { travelFreeKm: body.travelFreeKm }),
      ...(body.travelPerKmPaise !== undefined && { travelPerKmPaise: body.travelPerKmPaise }),
      ...(body.minOrderPaise !== undefined && { minChargePaise: body.minOrderPaise }),
      ...(body.taxPercent !== undefined && { taxPercent: body.taxPercent }),
      ...(body.adjustments?.length && { adjustments: body.adjustments }),
    }, ['per_unit']);
    const rules = checkRules({
      ...(body.leadTimeHours !== undefined && { leadTimeHours: body.leadTimeHours }),
      ...(body.setupMin !== undefined && { setupMin: body.setupMin }),
      ...(body.dismantleMin !== undefined && { dismantleMin: body.dismantleMin }),
      ...(body.bufferAfterMin !== undefined && { bufferAfterMin: body.bufferAfterMin }),
      ...(body.approval !== undefined && { approval: body.approval }),
      ...(body.instructions?.trim() && { instructions: body.instructions.trim() }),
      ...(body.workingDays?.length && body.workingDays.length < 7 && { workingDays: body.workingDays }),
      ...(body.blockedDates?.length && { blockedDates: body.blockedDates }),
      ...(body.maxAdvanceDays !== undefined && { maxAdvanceDays: body.maxAdvanceDays }),
      ...(body.maxPerDay !== undefined && { maxPerDay: body.maxPerDay }),
    });
    await this.db.tx(async (client) => {
      const id = await this.ensureRentalService(client, vendorId);
      const cur = (await this.db.one<{ pricing: Pricing; rules: RuleSet; config_version: number; user_id: string }>(
        client,
        'SELECT s.pricing, s.rules, s.config_version, v.user_id FROM services s JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1 FOR UPDATE OF s',
        [id],
      ))!;
      await recordConfigChange(client, id, cur.user_id, cur, { pricing, rules });
      await client.query('UPDATE services SET pricing = $2, rules = $3, cash_allowed = COALESCE($4, cash_allowed) WHERE id = $1', [id, pricing, rules, body.cashAllowed ?? null]);
    });
    return this.settings(vendorId);
  }

  // ---------- customers ----------

  /**
   * What a customer can rent from an approved vendor. With a time range, each item says how many are
   * free then (the same count a booking is checked against, setup and cleaning time included).
   */
  async catalogue(vendorId: string, opts: { from?: Date; until?: Date; q?: string; categoryId?: string }) {
    const v = await this.db.one(this.db, `SELECT 1 FROM vendors WHERE id = $1 AND status = 'approved'`, [vendorId]);
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
    const settings = await this.settings(vendorId);
    if (!settings.serviceId) return { serviceId: null, settings, categories: [], items: [] };
    if (opts.from && opts.until && !(opts.until > opts.from)) throw bad('TIME_ORDER', 'The end must be after the start.');
    const { rows } = await this.db.query<{ id: string; totalQty: number; repairQty: number; categoryId: string } & Record<string, unknown>>(
      `SELECT ${ITEM_COLUMNS.replace('%PHOTO%', "= 'approved'")}
         FROM inventory_items i LEFT JOIN item_categories c ON c.id = i.category_id
        WHERE i.vendor_id = $1 AND i.is_active AND i.deleted_at IS NULL AND i.condition <> 'needs_repair' AND i.total_qty > i.repair_qty
          AND ($2::uuid IS NULL OR i.category_id = $2) AND ($3::text IS NULL OR i.name ILIKE '%' || $3 || '%')
        ORDER BY c.sort_order NULLS LAST, i.name`,
      [vendorId, opts.categoryId ?? null, opts.q?.replace(/[%_\\]/g, '\\$&') || null],
    );
    const items = [];
    for (const r of rows) {
      const { repairQty, totalQty, ...pub } = r;
      let available: number | null = null;
      if (opts.from && opts.until) {
        const from = new Date(opts.from.getTime() - settings.setupMin * 60_000);
        const until = new Date(opts.until.getTime() + (settings.dismantleMin + settings.bufferAfterMin) * 60_000);
        available = Math.max(0, totalQty - repairQty - (await poolUsed(this.db, poolKey(r.id), from, until)));
      }
      items.push({ ...pub, stock: totalQty - repairQty, available });
    }
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.categoryId as string, (counts.get(i.categoryId as string) ?? 0) + 1);
    const cats = await this.db.query(
      `SELECT id, name_en AS "nameEn", name_hi AS "nameHi" FROM item_categories WHERE id = ANY($1::uuid[]) ORDER BY vendor_id IS NOT NULL, sort_order, name_en`,
      [[...counts.keys()]],
    );
    const { serviceId, ...shown } = settings;
    return {
      serviceId,
      settings: { deliveryFeePaise: shown.deliveryFeePaise, travelFreeKm: shown.travelFreeKm, travelPerKmPaise: shown.travelPerKmPaise, minOrderPaise: shown.minOrderPaise,
        taxPercent: shown.taxPercent, leadTimeHours: shown.leadTimeHours, approval: shown.approval, instructions: shown.instructions },
      categories: cats.rows.map((c) => ({ ...c, itemCount: counts.get(c.id) ?? 0 })),
      items,
    };
  }
}
