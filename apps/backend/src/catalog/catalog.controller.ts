import { Controller, Get, Headers } from '@nestjs/common';
import { Db } from '../db/db.service';

/** "hi", "hi-IN", "hi;q=0.9,en" → hi; anything else → en. */
export const pickLanguage = (header?: string): 'en' | 'hi' =>
  /^\s*hi\b/i.test(header ?? '') ? 'hi' : 'en';

@Controller('v1')
export class CatalogController {
  constructor(private readonly db: Db) {}

  @Get('cities')
  async cities() {
    const { rows } = await this.db.query('SELECT id, name, state FROM cities WHERE is_active ORDER BY name');
    return { items: rows };
  }

  /** Category names come back in the app's language (Accept-Language: en | hi). */
  @Get('categories')
  async categories(@Headers('accept-language') acceptLanguage?: string) {
    const lang = pickLanguage(acceptLanguage);
    const { rows } = await this.db.query(
      `SELECT id, slug, ${lang === 'hi' ? 'name_hi' : 'name_en'} AS name, icon, default_unit AS "defaultUnit"
         FROM categories WHERE is_active ORDER BY sort_order, id`,
    );
    return { items: rows, language: lang };
  }
}
