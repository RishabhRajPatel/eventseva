import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { LANGUAGES, type Language } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';

class UpdateMeDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsIn(LANGUAGES) language?: Language;
  @IsOptional() @IsInt() @Min(1) cityId?: number;
}

interface MeRow {
  id: string;
  phone: string;
  name: string | null;
  language: Language;
  city_id: number | null;
}

const toMe = (u: MeRow) => ({ id: u.id, phone: u.phone, name: u.name, language: u.language, cityId: u.city_id });

@UseGuards(AuthGuard)
@Controller('v1/me')
export class MeController {
  constructor(private readonly db: Db) {}

  @Get()
  async get(@Auth() auth: AuthContext) {
    const me = await this.db.one<MeRow>(this.db, 'SELECT id, phone, name, language, city_id FROM users WHERE id = $1', [auth.userId]);
    return toMe(me!);
  }

  /** Name, city, and language (English / Hindi from Profile → Language). */
  @Patch()
  async update(@Auth() auth: AuthContext, @Body() body: UpdateMeDto) {
    if (body.cityId !== undefined) {
      const city = await this.db.one(this.db, 'SELECT 1 FROM cities WHERE id = $1 AND is_active', [body.cityId]);
      if (!city) throw new AppError('CITY_NOT_FOUND', 'We are not in this city yet.');
    }
    const me = await this.db.one<MeRow>(
      this.db,
      `UPDATE users SET name = COALESCE($2, name), language = COALESCE($3, language), city_id = COALESCE($4, city_id)
        WHERE id = $1 RETURNING id, phone, name, language, city_id`,
      [auth.userId, body.name?.trim() ?? null, body.language ?? null, body.cityId ?? null],
    );
    return toMe(me!);
  }
}
