import { Controller, Get, Headers, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { pickLanguage } from '../catalog/catalog.controller';
import { loadVendor } from './vendor.queries';

class VendorSearchQuery {
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) cityId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class MonthQuery {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month: string;
}

/** Customer app: browse and open vendors. Only approved vendors exist here. */
@Controller('v1/vendors')
export class VendorsController {
  constructor(private readonly db: Db) {}

  @Get()
  async list(@Query() query: VendorSearchQuery, @Headers('accept-language') acceptLanguage?: string) {
    const lang = pickLanguage(acceptLanguage);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows } = await this.db.query(
      `SELECT v.id, v.business_name AS "businessName", v.area,
              json_build_object('slug', c.slug, 'name', ${lang === 'hi' ? 'c.name_hi' : 'c.name_en'}) AS category,
              v.rating_avg::float AS "ratingAvg", v.rating_count AS "ratingCount",
              v.featured_until > now() AS "isFeatured",
              (SELECT json_build_object('publicId', m.public_id, 'width', m.width, 'height', m.height, 'blurhash', m.blurhash)
                 FROM media m WHERE m.vendor_id = v.id AND m.status = 'approved' AND m.type = 'photo'
                ORDER BY m.is_cover DESC, m.sort_order LIMIT 1) AS cover,
              LEAST((SELECT min(price_paise) FROM services s WHERE s.vendor_id = v.id AND s.is_active),
                    (SELECT min(price_paise) FROM packages p WHERE p.vendor_id = v.id AND p.is_active)) AS "startingPricePaise"
         FROM vendors v JOIN categories c ON c.id = v.category_id
        WHERE v.status = 'approved'
          AND ($1::text IS NULL OR c.slug = $1)
          AND ($2::int IS NULL OR v.city_id = $2)
        ORDER BY (v.featured_until > now()) IS TRUE DESC, v.rating_avg DESC, v.rating_count DESC, v.approved_at DESC, v.id
        LIMIT $3 OFFSET $4`,
      [query.category ?? null, query.cityId ?? null, limit + 1, (page - 1) * limit],
    );
    return {
      items: rows.slice(0, limit).map((r) => ({ ...r, isFeatured: !!r.isFeatured })),
      page,
      hasMore: rows.length > limit,
      language: lang,
    };
  }

  /** Busy slots in a month, for the date picker. Why a slot is busy (booked or blocked) is not shown. */
  @Get(':id/availability')
  async availability(@Param('id', ParseUUIDPipe) id: string, @Query() query: MonthQuery) {
    const { rows } = await this.db.query(
      `SELECT a.day, a.slot FROM availability a JOIN vendors v ON v.id = a.vendor_id
        WHERE v.id = $1 AND v.status = 'approved' AND to_char(a.day, 'YYYY-MM') = $2 ORDER BY a.day, a.slot`,
      [id, query.month],
    );
    return { month: query.month, busy: rows };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Headers('accept-language') acceptLanguage?: string) {
    const v = await loadVendor(this.db, id, pickLanguage(acceptLanguage), 'public');
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'This vendor is not available.', HttpStatus.NOT_FOUND);
    return v;
  }
}
