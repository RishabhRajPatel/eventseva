import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { Equals, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { LANGUAGES, type Language } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { CloudinaryService } from '../media/cloudinary.service';

class UpdateMeDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsIn(LANGUAGES) language?: Language;
  @IsOptional() @IsInt() @Min(1) cityId?: number;
}

class DeleteMeDto {
  /** The app makes the user type or tap a clear confirmation; the API double-checks it. */
  @Equals('DELETE') confirm: 'DELETE';
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
  constructor(
    private readonly db: Db,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  async get(@Auth() auth: AuthContext) {
    const me = await this.db.one<MeRow>(this.db, 'SELECT id, phone, name, language, city_id FROM users WHERE id = $1', [auth.userId]);
    return toMe(me!);
  }

  /**
   * Deletes the account (a Google Play requirement). Personal data goes: phone, name, devices, saved
   * vendors, the business profile's photos, documents and bank account. Bookings and payments stay
   * (anonymised) because tax and payment records must be kept, and the other side still needs them.
   * The same phone number can sign up again later as a new account.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Auth() auth: AuthContext, @Body() _body: DeleteMeDto) {
    const files = await this.db.tx(async (client) => {
      const busy = await this.db.one<{ bookings: number; payouts: number }>(
        client,
        `SELECT
           (SELECT count(*)::int FROM bookings b LEFT JOIN vendors v ON v.id = b.vendor_id
             WHERE (b.customer_id = $1 OR v.user_id = $1) AND b.status IN ('requested', 'accepted', 'confirmed')) AS bookings,
           (SELECT count(*)::int FROM payouts p JOIN vendors v ON v.id = p.vendor_id
             WHERE v.user_id = $1 AND p.status IN ('scheduled', 'processing', 'held')) AS payouts`,
        [auth.userId],
      );
      if (busy!.bookings > 0) {
        throw new AppError('ACCOUNT_HAS_ACTIVE_BOOKINGS', 'Finish or cancel your open bookings before deleting your account.', HttpStatus.CONFLICT, {
          bookings: busy!.bookings,
        });
      }
      if (busy!.payouts > 0) {
        throw new AppError('ACCOUNT_HAS_PENDING_PAYOUT', 'Your last payouts are still on the way. You can delete your account once they arrive.', HttpStatus.CONFLICT);
      }

      const vendor = await this.db.one<{ id: string }>(client, 'SELECT id FROM vendors WHERE user_id = $1', [auth.userId]);
      let removed: { public_id: string; kind: 'image' | 'video'; type: 'upload' | 'private' }[] = [];
      if (vendor) {
        const media = await client.query<{ public_id: string; type: string }>('DELETE FROM media WHERE vendor_id = $1 RETURNING public_id, type', [vendor.id]);
        const docs = await client.query<{ storage_key: string }>('DELETE FROM vendor_documents WHERE vendor_id = $1 RETURNING storage_key', [vendor.id]);
        removed = [
          ...media.rows.map((m) => ({ public_id: m.public_id, kind: (m.type === 'video' ? 'video' : 'image') as 'image' | 'video', type: 'upload' as const })),
          ...docs.rows.map((d) => ({ public_id: d.storage_key, kind: 'image' as const, type: 'private' as const })),
        ];
        await client.query('DELETE FROM vendor_bank_accounts WHERE vendor_id = $1', [vendor.id]);
        await client.query('DELETE FROM availability WHERE vendor_id = $1', [vendor.id]);
        await client.query('DELETE FROM shortlists WHERE vendor_id = $1', [vendor.id]);
        // The row stays for old bookings, hidden from customers for good.
        await client.query(
          `UPDATE vendors SET status = 'on_hold', reject_reason = 'Account deleted', address = NULL, lat = NULL, lng = NULL, featured_until = NULL
            WHERE id = $1`,
          [vendor.id],
        );
      }
      const user = await this.db.one<{ phone: string }>(client, 'SELECT phone FROM users WHERE id = $1', [auth.userId]);
      await client.query('DELETE FROM otp_requests WHERE phone = $1', [user!.phone]);
      await client.query('DELETE FROM device_tokens WHERE user_id = $1', [auth.userId]);
      await client.query('DELETE FROM shortlists WHERE customer_id = $1', [auth.userId]);
      await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [auth.userId]);
      // phone is UNIQUE; freeing it lets the same number sign up again as a new person.
      await client.query(`UPDATE users SET deleted_at = now(), phone = 'deleted:' || id, name = NULL WHERE id = $1`, [auth.userId]);
      return removed;
    });
    // After the commit, so a failed delete never leaves a half-deleted account.
    for (const f of files) await this.cloudinary.destroy(f.public_id, f.kind, f.type);
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
