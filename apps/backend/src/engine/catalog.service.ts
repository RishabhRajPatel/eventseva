// What a vendor offers through the booking engine: services (priced and ruled per their category's
// template), the resources they use (vehicles, drivers, staff, artists, halls) and optional add-ons.
// Customers read the public side of it per vendor.
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { CloudinaryService } from '../media/cloudinary.service';
import { checkPricing, checkRules, checkValues, effectiveRules, VENDOR_RULE_KEYS } from './rules';
import type { BookingTypeKey, CategoryTemplate, FieldDef, Pricing, ResourceKind, RuleSet } from './types';

export const MAX_ENGINE_SERVICES = 30;
export const MAX_RESOURCES = 300;
export const MAX_ADDONS = 50;
const MAX_PRICE = 100_000_000;

/** Resource kinds a vendor can add (the "crew" resource is made by the system). */
export const VENDOR_RESOURCE_KINDS = ['vehicle', 'driver', 'staff', 'artist', 'venue', 'equipment'] as const;
export type VendorResourceKind = (typeof VENDOR_RESOURCE_KINDS)[number];
/** Kinds the EventSeva team checks before they can be booked. */
const VERIFIED_KINDS: ResourceKind[] = ['vehicle', 'driver'];

const bilingual = (en: string, hi: string) => ({ en, hi });
const opt = (value: string, en: string, hi: string) => ({ value, label: bilingual(en, hi) });

/** Details asked for each kind of resource; checked like any template's attributes. */
export const RESOURCE_FIELDS: Record<VendorResourceKind, FieldDef[]> = {
  vehicle: [
    { key: 'registration', label: bilingual('Registration number', 'रजिस्ट्रेशन नंबर'), type: 'text', required: true, maxLength: 13 },
    { key: 'make', label: bilingual('Make', 'कंपनी'), type: 'text', required: true, maxLength: 40 },
    { key: 'model', label: bilingual('Model', 'मॉडल'), type: 'text', required: true, maxLength: 40 },
    { key: 'colour', label: bilingual('Colour', 'रंग'), type: 'text', maxLength: 30 },
    { key: 'year', label: bilingual('Year', 'साल'), type: 'number', min: 1990, max: 2100 },
    { key: 'seats', label: bilingual('Seats', 'सीटें'), type: 'number', required: true, min: 1, max: 60 },
    { key: 'fuel', label: bilingual('Fuel', 'ईंधन'), type: 'select', options: [opt('petrol', 'Petrol', 'पेट्रोल'), opt('diesel', 'Diesel', 'डीज़ल'), opt('cng', 'CNG', 'सीएनजी'), opt('ev', 'Electric', 'इलेक्ट्रिक')] },
    { key: 'ac', label: bilingual('Air-conditioned', 'एसी'), type: 'boolean' },
    { key: 'with_driver', label: bilingual('With driver', 'ड्राइवर के साथ'), type: 'boolean' },
    { key: 'self_drive', label: bilingual('Self-drive', 'खुद चलाएँ'), type: 'boolean' },
    { key: 'fuel_policy', label: bilingual('Fuel', 'ईंधन का हिसाब'), type: 'select', options: [opt('included', 'Included', 'शामिल'), opt('full_to_full', 'Full to full', 'फुल से फुल'), opt('at_actuals', 'At actuals', 'असल खर्च')] },
    { key: 'toll_parking', label: bilingual('Tolls and parking', 'टोल और पार्किंग'), type: 'select', options: [opt('included', 'Included', 'शामिल'), opt('at_actuals', 'At actuals', 'असल खर्च')] },
    { key: 'decorated', label: bilingual('Can be decorated', 'सजावट हो सकती है'), type: 'boolean' },
  ],
  driver: [
    { key: 'licence_last4', label: bilingual('Licence (last 4)', 'लाइसेंस (आख़िरी 4)'), type: 'text', required: true, maxLength: 4 },
    { key: 'licence_expires', label: bilingual('Licence valid till (YYYY-MM-DD)', 'लाइसेंस कब तक (YYYY-MM-DD)'), type: 'text', required: true, maxLength: 10 },
    { key: 'experience_years', label: bilingual('Years driving', 'कितने साल से'), type: 'number', min: 0, max: 60 },
    { key: 'languages', label: bilingual('Languages', 'भाषाएँ'), type: 'text', maxLength: 100 },
  ],
  staff: [
    { key: 'role', label: bilingual('Role', 'काम'), type: 'text', required: true, maxLength: 40 },
    { key: 'experience_years', label: bilingual('Years of experience', 'अनुभव (साल)'), type: 'number', min: 0, max: 60 },
  ],
  artist: [
    { key: 'speciality', label: bilingual('Speciality', 'ख़ासियत'), type: 'text', maxLength: 80 },
    { key: 'experience_years', label: bilingual('Years of experience', 'अनुभव (साल)'), type: 'number', min: 0, max: 60 },
  ],
  venue: [
    { key: 'capacity', label: bilingual('Guests', 'मेहमान'), type: 'number', required: true, min: 1, max: 20000 },
    { key: 'ac', label: bilingual('Air-conditioned', 'एसी'), type: 'boolean' },
  ],
  equipment: [{ key: 'details', label: bilingual('Details', 'विवरण'), type: 'text', maxLength: 200 }],
};

const REGISTRATION = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;

export interface EngineServiceInput {
  title?: string;
  description?: string | null;
  pricing?: Pricing;
  rules?: RuleSet;
  attributes?: Record<string, unknown>;
  resourceId?: string | null;
  minGuests?: number | null;
  maxGuests?: number | null;
  isActive?: boolean;
}

export interface ResourceInput {
  kind?: VendorResourceKind;
  name?: string;
  attributes?: Record<string, unknown>;
  status?: 'active' | 'maintenance' | 'inactive';
}

export interface AddonInput {
  serviceId?: string | null;
  name?: string;
  kind?: string;
  inclusions?: string[];
  exclusions?: string[];
  pricePaise?: number;
  setupMinutes?: number;
  requiresApproval?: boolean;
  isActive?: boolean;
}

interface VendorCategory {
  id: string;
  user_id: string;
  status: string;
  booking_type: BookingTypeKey;
  template: CategoryTemplate;
  default_unit: string;
}

const SERVICE_COLUMNS = `s.id, s.title, s.description, s.booking_type AS "bookingType", s.pricing, s.rules, s.attributes, s.resource_id AS "resourceId",
  s.min_guests AS "minGuests", s.max_guests AS "maxGuests", s.is_active AS "isActive", s.created_at AS "createdAt"`;
const RESOURCE_COLUMNS = `r.id, r.kind, r.name, r.attributes, r.status, r.verification, r.reject_reason AS "rejectReason", r.created_at AS "createdAt",
  COALESCE((SELECT json_agg(json_build_object('id', d.id, 'docType', d.doc_type, 'status', d.status, 'rejectReason', d.reject_reason) ORDER BY d.created_at)
     FROM vendor_documents d WHERE d.resource_id = r.id), '[]') AS documents`;
const ADDON_COLUMNS = `a.id, a.service_id AS "serviceId", a.name, a.kind, a.inclusions, a.exclusions, a.price_paise AS "pricePaise",
  a.setup_minutes AS "setupMinutes", a.requires_approval AS "requiresApproval", a.is_active AS "isActive"`;

const bad = (message: string, field?: string) => new AppError('VALIDATION', message, HttpStatus.BAD_REQUEST, field ? { field } : undefined);

@Injectable()
export class EngineCatalogService {
  constructor(
    private readonly db: Db,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async vendor(q: Queryable, userId: string, lock = false): Promise<VendorCategory> {
    const v = await this.db.one<VendorCategory>(
      q,
      `SELECT v.id, v.user_id, v.status, c.booking_type, c.template, c.default_unit FROM vendors v JOIN categories c ON c.id = v.category_id
        WHERE v.user_id = $1 ${lock ? 'FOR UPDATE OF v' : ''}`,
      [userId],
    );
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v;
  }

  /** What the vendor's category asks for, so the app can build the form. */
  async setup(userId: string) {
    const v = await this.vendor(this.db, userId);
    const tpl = v.template ?? {};
    return {
      bookingType: v.booking_type,
      pricingModels: tpl.pricingModels ?? [],
      attributes: tpl.attributes ?? [],
      questions: tpl.questions ?? [],
      resourceKind: tpl.resourceKind ?? null,
      staffKind: tpl.staffKind ?? null,
      defaultRules: v.booking_type === 'slot' ? {} : effectiveRules(v.booking_type, tpl, {}),
      vendorRuleKeys: VENDOR_RULE_KEYS,
      resourceFields: RESOURCE_FIELDS,
    };
  }

  // ---------- services ----------

  async services(userId: string) {
    const v = await this.vendor(this.db, userId);
    const { rows } = await this.db.query(
      `SELECT ${SERVICE_COLUMNS} FROM services s WHERE s.vendor_id = $1 AND s.booking_type NOT IN ('slot', 'rental') AND s.is_active ORDER BY s.created_at`,
      [v.id],
    );
    return rows;
  }

  /** Server-side checks: the category decides the booking type, pricing models and attributes. */
  private async checkService(q: Queryable, v: VendorCategory, body: EngineServiceInput, current?: { pricing: Pricing; resource_id: string | null }) {
    const type = v.booking_type;
    if (type === 'slot' || type === 'rental') {
      throw new AppError('WRONG_SERVICE_KIND', type === 'rental' ? 'Rental vendors list items in Rental items.' : 'This category is booked by day and slot. Use Services.', HttpStatus.CONFLICT);
    }
    const tpl = v.template ?? {};
    const out: { pricing?: Pricing; rules?: RuleSet; attributes?: Record<string, unknown> } = {};
    if (body.pricing !== undefined) {
      out.pricing = checkPricing(body.pricing, tpl.pricingModels?.length ? tpl.pricingModels : undefined);
      if (out.pricing.ratePaise > MAX_PRICE) throw bad('pricing.ratePaise: at most ₹10 lakh.', 'pricing.ratePaise');
    }
    if (body.rules !== undefined) {
      const extra = Object.keys(body.rules ?? {}).filter((k) => !VENDOR_RULE_KEYS.includes(k as keyof RuleSet));
      if (extra.length) throw bad(`rules.${extra[0]} is set by EventSeva, not by the vendor.`, `rules.${extra[0]}`);
      out.rules = checkRules(body.rules);
      // Vendors cannot loosen the minimum notice EventSeva sets for the category.
      const floor = tpl.rules?.leadTimeHours;
      if (floor !== undefined && out.rules.leadTimeHours !== undefined && out.rules.leadTimeHours < floor) {
        throw bad(`rules.leadTimeHours: at least ${floor} for this category.`, 'rules.leadTimeHours');
      }
    }
    if (body.attributes !== undefined) out.attributes = checkValues(tpl.attributes ?? [], body.attributes, 'attributes');
    const resourceId = body.resourceId === undefined ? current?.resource_id ?? null : body.resourceId;
    if (resourceId) {
      const r = await this.db.one<{ kind: string }>(q, `SELECT kind FROM resources WHERE id = $1 AND vendor_id = $2 AND status <> 'inactive'`, [resourceId, v.id]);
      if (!r) throw new AppError('RESOURCE_NOT_FOUND', 'Choose one of your own vehicles, people or halls.', HttpStatus.BAD_REQUEST, { field: 'resourceId' });
      if (tpl.resourceKind && r.kind !== tpl.resourceKind) throw bad(`This service needs a ${tpl.resourceKind}.`, 'resourceId');
    } else if (type === 'transport') {
      throw new AppError('RESOURCE_REQUIRED', 'Choose the vehicle this service is for.', HttpStatus.BAD_REQUEST, { field: 'resourceId' });
    }
    if (body.minGuests != null && body.maxGuests != null && body.minGuests > body.maxGuests) throw bad('minGuests is more than maxGuests.', 'minGuests');
    return { ...out, resourceId };
  }

  async createService(userId: string, body: EngineServiceInput & { title: string; pricing: Pricing }) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const n = await this.db.one<{ n: number }>(client, `SELECT count(*)::int AS n FROM services WHERE vendor_id = $1 AND is_active AND booking_type NOT IN ('slot', 'rental')`, [v.id]);
      if (n!.n >= MAX_ENGINE_SERVICES) throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_ENGINE_SERVICES} services.`);
      const c = await this.checkService(client, v, body);
      const row = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO services (vendor_id, title, description, price_paise, unit, booking_type, pricing, rules, attributes, resource_id, min_guests, max_guests)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [v.id, body.title.trim(), body.description?.trim() || null, Math.max(100, c.pricing!.ratePaise), v.default_unit, v.booking_type, c.pricing,
          c.rules ?? {}, c.attributes ?? {}, c.resourceId, body.minGuests ?? null, body.maxGuests ?? null],
      );
      return this.db.one(client, `SELECT ${SERVICE_COLUMNS} FROM services s WHERE s.id = $1`, [row!.id]);
    });
  }

  /** Changes apply to new bookings; each booking keeps the price and rules it was made with. */
  async updateService(userId: string, id: string, body: EngineServiceInput) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const cur = await this.db.one<{ pricing: Pricing; resource_id: string | null }>(
        client,
        `SELECT pricing, resource_id FROM services WHERE id = $1 AND vendor_id = $2 AND is_active AND booking_type NOT IN ('slot', 'rental') FOR UPDATE`,
        [id, v.id],
      );
      if (!cur) throw new AppError('NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
      const c = await this.checkService(client, v, body, cur);
      await client.query(
        `UPDATE services SET title = COALESCE($3, title), description = CASE WHEN $4 THEN $5 ELSE description END,
                pricing = COALESCE($6, pricing), price_paise = COALESCE($7, price_paise), rules = COALESCE($8, rules),
                attributes = COALESCE($9, attributes), resource_id = $10,
                min_guests = CASE WHEN $11 THEN $12 ELSE min_guests END, max_guests = CASE WHEN $13 THEN $14 ELSE max_guests END
          WHERE id = $1 AND vendor_id = $2`,
        [id, v.id, body.title?.trim() ?? null, body.description !== undefined, body.description?.trim() || null, c.pricing ?? null,
          c.pricing ? Math.max(100, c.pricing.ratePaise) : null, c.rules ?? null, c.attributes ?? null, c.resourceId,
          body.minGuests !== undefined, body.minGuests ?? null, body.maxGuests !== undefined, body.maxGuests ?? null],
      );
      return this.db.one(client, `SELECT ${SERVICE_COLUMNS} FROM services s WHERE s.id = $1`, [id]);
    });
  }

  /** Soft delete: bookings keep pointing at it. Open bookings still go ahead. */
  async removeService(userId: string, id: string) {
    const v = await this.vendor(this.db, userId);
    const r = await this.db.query(
      `UPDATE services SET is_active = false WHERE id = $1 AND vendor_id = $2 AND is_active AND booking_type NOT IN ('slot', 'rental')`,
      [id, v.id],
    );
    if (!r.rowCount) throw new AppError('NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
  }

  // ---------- resources ----------

  async resources(userId: string, kind?: string) {
    const v = await this.vendor(this.db, userId);
    const { rows } = await this.db.query(
      `SELECT ${RESOURCE_COLUMNS} FROM resources r WHERE r.vendor_id = $1 AND r.kind <> 'crew' AND r.status <> 'inactive' AND ($2::text IS NULL OR r.kind = $2)
        ORDER BY r.kind, r.name`,
      [v.id, kind ?? null],
    );
    return rows;
  }

  private checkResource(kind: VendorResourceKind, name: string | undefined, attributes: Record<string, unknown> | undefined) {
    if (name !== undefined && (name.trim().length < 2 || name.trim().length > 80)) throw bad('name: 2 to 80 characters.', 'name');
    const attrs = checkValues(RESOURCE_FIELDS[kind], attributes ?? {}, 'attributes');
    if (kind === 'vehicle') {
      const reg = String(attrs.registration).replace(/[\s-]/g, '').toUpperCase();
      if (!REGISTRATION.test(reg)) throw new AppError('VALIDATION', 'Enter the registration as on the RC, e.g. UP70 AB 1234.', HttpStatus.BAD_REQUEST, { field: 'attributes.registration' });
      attrs.registration = reg;
      if (!attrs.with_driver && !attrs.self_drive) throw bad('Choose with driver, self-drive or both.', 'attributes.with_driver');
    }
    if (kind === 'driver') {
      if (!/^\d{4}$/.test(String(attrs.licence_last4))) throw bad('Licence: the last 4 digits.', 'attributes.licence_last4');
      const exp = String(attrs.licence_expires);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || Number.isNaN(Date.parse(exp))) throw bad('Licence expiry: YYYY-MM-DD.', 'attributes.licence_expires');
      if (exp < new Date().toISOString().slice(0, 10)) throw new AppError('LICENCE_EXPIRED', 'This licence has expired.', HttpStatus.BAD_REQUEST, { field: 'attributes.licence_expires' });
    }
    return attrs;
  }

  async createResource(userId: string, body: ResourceInput & { kind: VendorResourceKind; name: string }) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const n = await this.db.one<{ n: number }>(client, `SELECT count(*)::int AS n FROM resources WHERE vendor_id = $1 AND status <> 'inactive'`, [v.id]);
      if (n!.n >= MAX_RESOURCES) throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_RESOURCES}.`);
      const attrs = this.checkResource(body.kind, body.name, body.attributes);
      try {
        const row = await this.db.one<{ id: string }>(
          client,
          `INSERT INTO resources (vendor_id, kind, name, attributes, verification) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [v.id, body.kind, body.name.trim(), attrs, VERIFIED_KINDS.includes(body.kind) ? 'pending' : 'not_required'],
        );
        return this.db.one(client, `SELECT ${RESOURCE_COLUMNS} FROM resources r WHERE r.id = $1`, [row!.id]);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new AppError('VEHICLE_EXISTS', 'A vehicle with this registration is already listed.', HttpStatus.CONFLICT);
        throw err;
      }
    });
  }

  /**
   * Editing what was verified (a vehicle's registration, a driver's licence) sends it back for checks.
   * A resource with bookings ahead cannot be switched off.
   */
  async updateResource(userId: string, id: string, body: ResourceInput) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const cur = await this.db.one<{ kind: VendorResourceKind; name: string; attributes: Record<string, unknown>; verification: string }>(
        client,
        `SELECT kind, name, attributes, verification FROM resources WHERE id = $1 AND vendor_id = $2 AND kind <> 'crew' AND status <> 'inactive' FOR UPDATE`,
        [id, v.id],
      );
      if (!cur) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      const attrs = body.attributes ? this.checkResource(cur.kind, body.name, { ...cur.attributes, ...body.attributes }) : cur.attributes;
      if (body.name !== undefined) this.checkResource(cur.kind, body.name, cur.attributes);
      const keyField = cur.kind === 'vehicle' ? 'registration' : cur.kind === 'driver' ? 'licence_last4' : null;
      const recheck = keyField && attrs[keyField] !== cur.attributes[keyField];
      if (body.status && body.status !== 'active') await this.assertNoBookingsAhead(client, id);
      try {
        await client.query(
          `UPDATE resources SET name = COALESCE($2, name), attributes = $3, status = COALESCE($4, status),
                  verification = CASE WHEN $5 THEN 'pending' ELSE verification END, reject_reason = CASE WHEN $5 THEN NULL ELSE reject_reason END,
                  updated_at = now()
            WHERE id = $1`,
          [id, body.name?.trim() ?? null, attrs, body.status ?? null, !!recheck],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new AppError('VEHICLE_EXISTS', 'A vehicle with this registration is already listed.', HttpStatus.CONFLICT);
        throw err;
      }
      return this.db.one(client, `SELECT ${RESOURCE_COLUMNS} FROM resources r WHERE r.id = $1`, [id]);
    });
  }

  private async assertNoBookingsAhead(q: Queryable, resourceId: string) {
    const ahead = await this.db.one<{ n: number }>(
      q,
      `SELECT count(*)::int AS n FROM reservations WHERE resource_id = $1 AND upper(period) > now()
          AND (status = 'active' OR (status = 'hold' AND expires_at > now()))`,
      [resourceId],
    );
    if (ahead!.n) throw new AppError('RESOURCE_BOOKED', `This has ${ahead!.n} booking(s) ahead. Cancel or finish them first.`, HttpStatus.CONFLICT, { bookings: ahead!.n });
  }

  async removeResource(userId: string, id: string) {
    await this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const r = await this.db.one(client, `SELECT 1 FROM resources WHERE id = $1 AND vendor_id = $2 AND kind <> 'crew' AND status <> 'inactive' FOR UPDATE`, [id, v.id]);
      if (!r) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      await this.assertNoBookingsAhead(client, id);
      await client.query(`UPDATE resources SET status = 'inactive', updated_at = now() WHERE id = $1`, [id]);
      await client.query(`UPDATE services SET is_active = false WHERE resource_id = $1 AND booking_type = 'transport'`, [id]);
    });
  }

  /** RC, insurance, permit, PUC (vehicles); licence, police verification (drivers). Private files, as for vendor KYC. */
  async addResourceDocument(userId: string, id: string, body: { publicId: string; version: number; signature: string; docType: string; format: string }) {
    const allowed: Record<string, string[]> = {
      vehicle: ['vehicle_rc', 'vehicle_insurance', 'vehicle_permit', 'vehicle_puc'],
      driver: ['driver_licence', 'police_verification'],
    };
    const { row, old } = await this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const r = await this.db.one<{ kind: string; verification: string }>(client, `SELECT kind, verification FROM resources WHERE id = $1 AND vendor_id = $2 AND status <> 'inactive'`, [id, v.id]);
      if (!r) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      if (!(allowed[r.kind] ?? []).includes(body.docType)) throw bad('This document is not used for this.', 'docType');
      if (!body.publicId.startsWith(this.cloudinary.folderFor(v.id, 'document') + '/')) {
        throw new AppError('UPLOAD_INVALID', 'This upload does not belong to your account.', HttpStatus.FORBIDDEN);
      }
      if (!this.cloudinary.verifyUploadResponse(body.publicId, body.version, body.signature)) throw new AppError('UPLOAD_INVALID', 'We could not verify this upload. Please try again.');
      const replaced = await client.query<{ storage_key: string }>('DELETE FROM vendor_documents WHERE resource_id = $1 AND doc_type = $2 RETURNING storage_key', [id, body.docType]);
      const inserted = await this.db.one(
        client,
        `INSERT INTO vendor_documents (vendor_id, resource_id, doc_type, storage_key, format) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, doc_type AS "docType", status, reject_reason AS "rejectReason"`,
        [v.id, id, body.docType, body.publicId, body.format],
      );
      // A new document after a rejection goes back for review.
      if (r.verification === 'rejected') await client.query(`UPDATE resources SET verification = 'pending', reject_reason = NULL WHERE id = $1`, [id]);
      return { row: inserted, old: replaced.rows };
    });
    for (const o of old) await this.cloudinary.destroy(o.storage_key, 'image', 'private');
    return row;
  }

  // ---------- admin verification ----------

  async pendingResources() {
    const { rows } = await this.db.query(
      `SELECT ${RESOURCE_COLUMNS}, v.id AS "vendorId", v.business_name AS "businessName"
         FROM resources r JOIN vendors v ON v.id = r.vendor_id
        WHERE r.verification = 'pending' AND r.status <> 'inactive' ORDER BY r.created_at LIMIT 200`,
    );
    return rows;
  }

  async resourceDocuments(id: string) {
    const { rows } = await this.db.query<{ id: string; docType: string; status: string; storage_key: string; format: string }>(
      `SELECT id, doc_type AS "docType", status, storage_key, format FROM vendor_documents WHERE resource_id = $1 ORDER BY created_at`,
      [id],
    );
    return rows.map(({ storage_key, format, ...d }) => ({ ...d, viewUrl: this.cloudinary.privateDownloadUrl(storage_key, format) }));
  }

  /**
   * Approve, reject (with a reason) or suspend a vehicle or driver. Approving needs the documents the
   * kind requires; suspending stops new bookings (bookings already made are left for support to handle).
   */
  async verifyResource(adminId: string, id: string, decision: 'approve' | 'reject' | 'suspend', reason?: string) {
    return this.db.tx(async (client) => {
      const r = await this.db.one<{ kind: string; verification: string; vendor_id: string; name: string; user_id: string }>(
        client,
        `SELECT r.kind, r.verification, r.vendor_id, r.name, v.user_id FROM resources r JOIN vendors v ON v.id = r.vendor_id WHERE r.id = $1 FOR UPDATE OF r`,
        [id],
      );
      if (!r || !VERIFIED_KINDS.includes(r.kind as ResourceKind)) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      if (decision !== 'approve' && !reason?.trim()) throw bad('Give a reason.', 'reason');
      if (decision === 'approve') {
        const need = r.kind === 'vehicle' ? ['vehicle_rc', 'vehicle_insurance'] : ['driver_licence'];
        const have = (await client.query<{ doc_type: string }>(`SELECT doc_type FROM vendor_documents WHERE resource_id = $1 AND status <> 'rejected'`, [id])).rows.map((d) => d.doc_type);
        const missing = need.filter((d) => !have.includes(d));
        if (missing.length) throw new AppError('DOCUMENTS_MISSING', `Needed first: ${missing.join(', ')}.`, HttpStatus.CONFLICT, { missing });
        await client.query(`UPDATE vendor_documents SET status = 'approved', reviewed_by = $2 WHERE resource_id = $1 AND status = 'pending'`, [id, adminId]);
      }
      const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'suspended';
      await client.query(`UPDATE resources SET verification = $2, reject_reason = $3, updated_at = now() WHERE id = $1`, [id, status, decision === 'approve' ? null : reason!.trim()]);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'resource', $3, $4, $5)`,
        [adminId, `resource.${decision}`, id, { verification: r.verification }, { verification: status, reason: reason ?? null }],
      );
      await notify(client, r.user_id, 'resource_verified', decision === 'approve'
        ? { en: { title: `${r.name} approved`, body: 'Customers can now book it.' }, hi: { title: `${r.name} मंज़ूर`, body: 'अब ग्राहक इसे बुक कर सकते हैं।' } }
        : { en: { title: `${r.name} ${decision === 'reject' ? 'not approved' : 'suspended'}`, body: `${reason}.` }, hi: { title: `${r.name} ${decision === 'reject' ? 'मंज़ूर नहीं' : 'रोका गया'}`, body: `${reason}।` } },
      { resourceId: id }, 'partner');
      return { id, verification: status };
    });
  }

  // ---------- add-ons ----------

  async addons(userId: string) {
    const v = await this.vendor(this.db, userId);
    return (await this.db.query(`SELECT ${ADDON_COLUMNS} FROM service_addons a WHERE a.vendor_id = $1 AND a.is_active ORDER BY a.created_at`, [v.id])).rows;
  }

  private async checkAddon(q: Queryable, vendorId: string, body: AddonInput) {
    if (body.serviceId) {
      const s = await this.db.one(q, `SELECT 1 FROM services WHERE id = $1 AND vendor_id = $2 AND is_active`, [body.serviceId, vendorId]);
      if (!s) throw new AppError('NOT_FOUND', 'Service not found.', HttpStatus.NOT_FOUND);
    }
    for (const k of ['inclusions', 'exclusions'] as const) {
      const list = body[k];
      if (list && (list.length > 20 || list.some((x) => typeof x !== 'string' || !x.trim() || x.length > 80))) throw bad(`${k}: up to 20 lines of 80 characters.`, k);
    }
  }

  async createAddon(userId: string, body: AddonInput & { name: string; pricePaise: number }) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const n = await this.db.one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM service_addons WHERE vendor_id = $1 AND is_active', [v.id]);
      if (n!.n >= MAX_ADDONS) throw new AppError('LIMIT_REACHED', `You can add up to ${MAX_ADDONS} extras.`);
      await this.checkAddon(client, v.id, body);
      const row = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO service_addons (vendor_id, service_id, name, kind, inclusions, exclusions, price_paise, setup_minutes, requires_approval)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [v.id, body.serviceId ?? null, body.name.trim(), body.kind ?? 'extra', (body.inclusions ?? []).map((x) => x.trim()), (body.exclusions ?? []).map((x) => x.trim()),
          body.pricePaise, body.setupMinutes ?? 0, body.requiresApproval ?? false],
      );
      return this.db.one(client, `SELECT ${ADDON_COLUMNS} FROM service_addons a WHERE a.id = $1`, [row!.id]);
    });
  }

  async updateAddon(userId: string, id: string, body: AddonInput) {
    return this.db.tx(async (client) => {
      const v = await this.vendor(client, userId, true);
      const cur = await this.db.one(client, 'SELECT 1 FROM service_addons WHERE id = $1 AND vendor_id = $2 AND is_active FOR UPDATE', [id, v.id]);
      if (!cur) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
      await this.checkAddon(client, v.id, body);
      await client.query(
        `UPDATE service_addons SET name = COALESCE($2, name), kind = COALESCE($3, kind), inclusions = COALESCE($4, inclusions), exclusions = COALESCE($5, exclusions),
                price_paise = COALESCE($6, price_paise), setup_minutes = COALESCE($7, setup_minutes), requires_approval = COALESCE($8, requires_approval),
                service_id = CASE WHEN $9 THEN $10 ELSE service_id END
          WHERE id = $1`,
        [id, body.name?.trim() ?? null, body.kind ?? null, body.inclusions?.map((x) => x.trim()) ?? null, body.exclusions?.map((x) => x.trim()) ?? null,
          body.pricePaise ?? null, body.setupMinutes ?? null, body.requiresApproval ?? null, body.serviceId !== undefined, body.serviceId ?? null],
      );
      return this.db.one(client, `SELECT ${ADDON_COLUMNS} FROM service_addons a WHERE a.id = $1`, [id]);
    });
  }

  async removeAddon(userId: string, id: string) {
    const v = await this.vendor(this.db, userId);
    const r = await this.db.query('UPDATE service_addons SET is_active = false WHERE id = $1 AND vendor_id = $2 AND is_active', [id, v.id]);
    if (!r.rowCount) throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
  }

  // ---------- customers ----------

  /**
   * A vendor's bookable engine services with what the booking form needs: questions, the rules the
   * customer must meet, the vehicle's public details, and extras. Never the vendor's internal data.
   */
  async publicServices(vendorId: string) {
    const v = await this.db.one<{ template: CategoryTemplate }>(
      this.db,
      `SELECT c.template FROM vendors v JOIN categories c ON c.id = v.category_id WHERE v.id = $1 AND v.status = 'approved'`,
      [vendorId],
    );
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
    const { rows } = await this.db.query<{ id: string; title: string; description: string | null; booking_type: BookingTypeKey; pricing: Pricing; rules: RuleSet;
      attributes: Record<string, unknown>; min_guests: number | null; max_guests: number | null; resource: Record<string, unknown> | null }>(
      `SELECT s.id, s.title, s.description, s.booking_type, s.pricing, s.rules, s.attributes, s.min_guests, s.max_guests,
              CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object('id', r.id, 'kind', r.kind, 'name', r.name, 'attributes', r.attributes,
                'bookable', r.status = 'active' AND r.verification IN ('approved', 'not_required'),
                'photos', COALESCE((SELECT json_agg(json_build_object('publicId', m.public_id, 'width', m.width, 'height', m.height, 'blurhash', m.blurhash) ORDER BY m.sort_order)
                   FROM media m WHERE m.resource_id = r.id AND m.status = 'approved'), '[]')) END AS resource
         FROM services s LEFT JOIN resources r ON r.id = s.resource_id
        WHERE s.vendor_id = $1 AND s.is_active AND s.booking_type NOT IN ('slot', 'rental') ORDER BY s.created_at`,
      [vendorId],
    );
    const addons = (await this.db.query(`SELECT ${ADDON_COLUMNS} FROM service_addons a WHERE a.vendor_id = $1 AND a.is_active ORDER BY a.price_paise`, [vendorId])).rows;
    const tpl = v.template ?? {};
    return {
      items: rows.map((s) => {
        const rules = effectiveRules(s.booking_type, tpl, s.rules ?? {});
        // A vehicle's registration is shown masked; the full number is shared after confirmation.
        const resource = s.resource
          ? { ...s.resource, attributes: { ...(s.resource.attributes as object), registration: undefined, registrationMasked: maskRegistration((s.resource.attributes as { registration?: string }).registration) } }
          : null;
        return {
          id: s.id,
          title: s.title,
          description: s.description,
          bookingType: s.booking_type,
          pricing: s.pricing,
          attributes: s.attributes,
          minGuests: s.min_guests,
          maxGuests: s.max_guests,
          rules: {
            minDurationMin: rules.minDurationMin ?? null, maxDurationMin: rules.maxDurationMin ?? null, minQty: rules.minQty ?? null, maxQty: rules.maxQty ?? null,
            workingHours: rules.workingHours ?? null, leadTimeHours: rules.leadTimeHours ?? null, perPersonMin: rules.perPersonMin ?? null, minAge: rules.minAge ?? null,
            approval: rules.approval ?? 'vendor', cancellation: rules.cancellation ?? null, requiredDocuments: rules.requiredDocuments ?? [], instructions: rules.instructions ?? null,
          },
          questions: tpl.questions ?? [],
          resource,
          addons: addons.filter((a) => !a.serviceId || a.serviceId === s.id),
        };
      }),
    };
  }
}

/** "UP70AB1234" → "UP70 •• 1234". */
export const maskRegistration = (reg?: string) => (reg ? `${reg.slice(0, 4)} •• ${reg.slice(-4)}` : null);
