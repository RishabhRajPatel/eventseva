import { Body, Controller, Get, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { checkPolicy } from '../engine/rules';
import type { CancellationPolicy } from '../engine/types';
import { Admin, AdminContext, AdminGuard, AdminRoles } from './admin-auth';
import { StepUp } from './admin-2fa';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) advancePercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) commissionPercent?: number;
  @IsOptional() @IsInt() @Min(0) cashDuesLimitPaise?: number;
  /** Shape is checked by checkPolicy, which the category and vendor editors use too. */
  @IsOptional() @IsObject() cancellation?: CancellationPolicy;
  @IsOptional() @IsString() @Length(2, 120) platformName?: string;
  /** Empty string clears it. */
  @IsOptional() @IsString() @Length(0, 300) platformAddress?: string;
  @IsOptional() @IsString() @Matches(/^$|^[0-9A-Z]{15}$/, { message: 'platformGstin: 15 characters, digits and capitals' }) platformGstin?: string;
}

/**
 * The money settings that used to need a deploy: the advance and commission percentages, the cash
 * dues limit, the default cancellation policy and the name and GSTIN that go on invoices.
 *
 * Super admins only, with a fresh 2FA code, and every change is written to the audit log with its
 * before and after. Bookings already made are untouched — each one carries its own price, commission
 * and cancellation policy from the moment it was made.
 */
@UseGuards(AdminGuard)
@AdminRoles('super')
@Controller('v1/admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async get(): Promise<{ settings: Awaited<ReturnType<SettingsService['get']>>; updatedAt: string | null; updatedBy: string | null }> {
    const meta = await this.db.one<{ updatedAt: Date | null; updatedBy: string | null }>(
      this.db,
      `SELECT s.updated_at AS "updatedAt", a.email AS "updatedBy"
         FROM platform_settings s LEFT JOIN admin_users a ON a.id = s.updated_by WHERE s.id = 1`,
    );
    return {
      settings: await this.settings.get(),
      updatedAt: meta?.updatedAt ? new Date(meta.updatedAt).toISOString() : null,
      updatedBy: meta?.updatedBy ?? null,
    };
  }

  @StepUp()
  @Patch()
  async update(@Admin() admin: AdminContext, @Body() body: UpdateSettingsDto) {
    // Not Object.keys: the validation pipe hands back a class instance whose unsent fields are
    // present and undefined, so the keys are always there.
    if (Object.values(body).every((v) => v === undefined)) throw new AppError('VALIDATION', 'Nothing to change.');
    if (body.cancellation) checkPolicy(body.cancellation, 'cancellation');

    const saved = await this.db.tx(async (client) => {
      // Locked: two admins saving at once must not read the same "before" and lose one change.
      const before = await this.settings.fresh(client, true);
      if (!before) throw new AppError('NOT_FOUND', 'Settings row is missing; run the migrations.', HttpStatus.NOT_FOUND);

      const after = {
        advancePercent: body.advancePercent ?? before.advancePercent,
        commissionPercent: body.commissionPercent ?? before.commissionPercent,
        cashDuesLimitPaise: body.cashDuesLimitPaise ?? before.cashDuesLimitPaise,
        cancellation: body.cancellation ?? before.cancellation,
        name: body.platformName ?? before.platform.name,
        address: body.platformAddress === undefined ? before.platform.address : body.platformAddress.trim() || null,
        gstin: body.platformGstin === undefined ? before.platform.gstin : body.platformGstin.trim() || null,
      };
      // The commission is taken out of the advance, so it can never be the larger of the two. The
      // table checks this too; saying it here gives the admin a message instead of a 500.
      if (after.commissionPercent > after.advancePercent) {
        throw new AppError('COMMISSION_OVER_ADVANCE', 'The commission comes out of the advance, so it cannot be larger than it.', HttpStatus.BAD_REQUEST, {
          advancePercent: after.advancePercent,
          commissionPercent: after.commissionPercent,
        });
      }

      await client.query(
        `UPDATE platform_settings SET advance_percent = $1, commission_percent = $2, cash_dues_limit_paise = $3,
                cancellation = $4, platform_name = $5, platform_address = $6, platform_gstin = $7,
                updated_at = now(), updated_by = $8
          WHERE id = 1`,
        [after.advancePercent, after.commissionPercent, after.cashDuesLimitPaise, JSON.stringify(after.cancellation),
          after.name, after.address, after.gstin, admin.adminId],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after)
         VALUES ($1, 'settings.update', 'settings', '1', $2, $3)`,
        [admin.adminId, before, after],
      );
      return after;
    });

    this.settings.invalidate();
    return {
      advancePercent: saved.advancePercent,
      commissionPercent: saved.commissionPercent,
      cashDuesLimitPaise: saved.cashDuesLimitPaise,
      cancellation: saved.cancellation,
      platform: { name: saved.name, address: saved.address, gstin: saved.gstin },
    };
  }
}
