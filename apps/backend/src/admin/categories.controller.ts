import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CATEGORY_ICONS } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { PRICING_UNITS, type PricingUnit } from '../vendors/vendor.queries';
import { Admin, AdminContext, AdminGuard, AdminRoles } from './admin-auth';

class CreateCategoryDto {
  @IsString() @Length(2, 60) nameEn: string;
  @IsString() @Length(2, 60) nameHi: string;
  @IsIn(CATEGORY_ICONS) icon: string;
  @IsIn(PRICING_UNITS) defaultUnit: PricingUnit;
  /** Optional; made from the English name when left out. Used in links, so it never changes later. */
  @IsOptional() @Matches(/^[a-z][a-z0-9-]{1,39}$/, { message: 'slug: lowercase letters, digits and dashes' }) slug?: string;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(2, 60) nameEn?: string;
  @IsOptional() @IsString() @Length(2, 60) nameHi?: string;
  @IsOptional() @IsIn(CATEGORY_ICONS) icon?: string;
  @IsOptional() @IsIn(PRICING_UNITS) defaultUnit?: PricingUnit;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class OrderDto {
  @IsArray() @ArrayMaxSize(200) @IsInt({ each: true }) ids: number[];
}

const COLUMNS = `c.id, c.slug, c.name_en AS "nameEn", c.name_hi AS "nameHi", c.icon, c.default_unit AS "defaultUnit",
  c.sort_order AS "sortOrder", c.is_active AS "isActive",
  (SELECT count(*)::int FROM vendors v WHERE v.category_id = c.id AND v.status = 'approved') AS "liveVendors",
  (SELECT count(*)::int FROM vendors v WHERE v.category_id = c.id) AS "allVendors"`;

/** "Bartan & Kitchen Equipment" → "bartan-kitchen-equipment". */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'category';

async function audit(q: Queryable, adminId: string, action: string, id: number, before: object | null, after: object | null) {
  await q.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'category', $3, $4, $5)`,
    [adminId, action, String(id), before, after],
  );
}

/**
 * The service types customers browse and vendors register under. Super admins only: a change shows
 * up in both apps at once. Categories are hidden instead of deleted, because vendors and old
 * bookings point at them.
 */
@UseGuards(AdminGuard)
@AdminRoles('super')
@Controller('v1/admin/categories')
export class AdminCategoriesController {
  constructor(private readonly db: Db) {}

  @Get()
  async list() {
    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM categories c ORDER BY c.is_active DESC, c.sort_order, c.id`);
    return { items: rows, icons: CATEGORY_ICONS, units: PRICING_UNITS };
  }

  @Post()
  async create(@Admin() admin: AdminContext, @Body() body: CreateCategoryDto) {
    return this.db.tx(async (client) => {
      const slug = body.slug ?? slugify(body.nameEn);
      const taken = await this.db.one(client, 'SELECT 1 FROM categories WHERE slug = $1 OR lower(name_en) = lower($2)', [slug, body.nameEn.trim()]);
      if (taken) throw new AppError('CATEGORY_EXISTS', 'A category with this name already exists.', HttpStatus.CONFLICT);
      // New categories go to the end of the visible list.
      const row = await this.db.one<{ id: number }>(
        client,
        `INSERT INTO categories (slug, name_en, name_hi, icon, default_unit, sort_order)
         VALUES ($1, $2, $3, $4, $5, COALESCE((SELECT max(sort_order) + 1 FROM categories WHERE is_active), 1))
         RETURNING id`,
        [slug, body.nameEn.trim(), body.nameHi.trim(), body.icon, body.defaultUnit],
      );
      await audit(client, admin.adminId, 'category.create', row!.id, null, { slug, nameEn: body.nameEn, nameHi: body.nameHi });
      return this.db.one(client, `SELECT ${COLUMNS} FROM categories c WHERE c.id = $1`, [row!.id]);
    });
  }

  @Patch(':id')
  async update(@Admin() admin: AdminContext, @Param('id', ParseIntPipe) id: number, @Body() body: UpdateCategoryDto) {
    return this.db.tx(async (client) => {
      const before = await this.db.one(client, `SELECT ${COLUMNS} FROM categories c WHERE c.id = $1 FOR UPDATE`, [id]);
      if (!before) throw new AppError('NOT_FOUND', 'Category not found.', HttpStatus.NOT_FOUND);
      if (body.nameEn) {
        const dup = await this.db.one(client, 'SELECT 1 FROM categories WHERE lower(name_en) = lower($1) AND id <> $2', [body.nameEn.trim(), id]);
        if (dup) throw new AppError('CATEGORY_EXISTS', 'A category with this name already exists.', HttpStatus.CONFLICT);
      }
      await client.query(
        `UPDATE categories SET name_en = COALESCE($2, name_en), name_hi = COALESCE($3, name_hi), icon = COALESCE($4, icon),
                default_unit = COALESCE($5, default_unit), is_active = COALESCE($6, is_active)
          WHERE id = $1`,
        [id, body.nameEn?.trim() ?? null, body.nameHi?.trim() ?? null, body.icon ?? null, body.defaultUnit ?? null, body.isActive ?? null],
      );
      const after = await this.db.one(client, `SELECT ${COLUMNS} FROM categories c WHERE c.id = $1`, [id]);
      const action = body.isActive === false && before.isActive ? 'category.hide' : body.isActive && !before.isActive ? 'category.show' : 'category.update';
      await audit(client, admin.adminId, action, id, before, after);
      return after;
    });
  }

  /** The order categories appear in the apps. Ids not listed keep their place after these. */
  @Put('order')
  async order(@Admin() admin: AdminContext, @Body() body: OrderDto) {
    await this.db.tx(async (client) => {
      await client.query(
        `UPDATE categories c SET sort_order = o.pos FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos) WHERE c.id = o.id`,
        [body.ids],
      );
      await audit(client, admin.adminId, 'category.order', 0, null, { ids: body.ids });
    });
    return this.list();
  }
}
