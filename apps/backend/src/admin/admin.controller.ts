import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { VENDOR_STATUSES, type Language, type VendorStatus } from '@eventseva/core';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { loadVendor } from '../vendors/vendor.queries';
import { Admin, AdminContext, AdminGuard, AdminRoles, ADMIN_LOCK_MIN, ADMIN_MAX_FAILED_LOGINS, ADMIN_TTL_SEC, signAdminToken } from './admin-auth';
import { findRecoveryCode, isSealed, newRecoveryCodes, openSecret, sealSecret, StepUp } from './admin-2fa';
import { hashPassword, verifyPassword } from './password';
import { totpStep } from './totp';
import { notify } from '../notifications/notify';
import { CloudinaryService } from '../media/cloudinary.service';
import { BookingsService } from '../bookings/bookings.service';

class AdminLoginDto {
  @IsEmail() @MaxLength(120) email: string;
  @IsString() @Length(1, 200) password: string;
  /** The 6-digit code from the authenticator app … */
  @ValidateIf((o: AdminLoginDto) => o.recoveryCode === undefined)
  @IsString() @Matches(/^\d{6}$/, { message: 'totp must be 6 digits' }) totp?: string;
  /** … or, with a lost phone, one of the one-time recovery codes ("ABCDE-FGHJK"). */
  @IsOptional() @IsString() @Length(10, 12) recoveryCode?: string;
}

class VendorListQuery {
  @IsOptional() @IsIn(VENDOR_STATUSES) status?: VendorStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class ReasonDto {
  @IsString() @Length(5, 300) reason: string;
}

const DOC_NAMES: Record<string, { en: string; hi: string }> = {
  aadhaar: { en: 'Aadhaar', hi: 'आधार' },
  pan: { en: 'PAN card', hi: 'पैन कार्ड' },
  gst: { en: 'GST certificate', hi: 'जीएसटी प्रमाणपत्र' },
  shop_photo: { en: 'Shop photo', hi: 'दुकान की फ़ोटो' },
};

const PAGE_SIZE = 20;

type Decision = 'approve' | 'reject' | 'hold';

/** Which statuses each decision can start from. */
const ALLOWED_FROM: Record<Decision, VendorStatus[]> = {
  approve: ['pending', 'on_hold'],
  reject: ['pending'],
  hold: ['pending', 'approved'],
};
const RESULT: Record<Decision, VendorStatus> = { approve: 'approved', reject: 'rejected', hold: 'on_hold' };

/** What the vendor sees in the Partner app, in their chosen language. */
const NOTICE: Record<Decision, Record<Language, { title: string; body: (reason: string | null) => string }>> = {
  approve: {
    en: { title: 'Your profile is live', body: () => 'Customers can now find and book you on EventSeva.' },
    hi: { title: 'आपकी प्रोफ़ाइल लाइव है', body: () => 'अब ग्राहक EventSeva पर आपको ढूँढ और बुक कर सकते हैं।' },
  },
  reject: {
    en: { title: 'Profile needs changes', body: (r) => `Please fix this and send again: ${r}` },
    hi: { title: 'प्रोफ़ाइल में बदलाव ज़रूरी', body: (r) => `कृपया इसे ठीक करके दोबारा भेजें: ${r}` },
  },
  hold: {
    en: { title: 'Profile paused', body: (r) => `Your profile is hidden from customers for now: ${r}` },
    hi: { title: 'प्रोफ़ाइल रोकी गई', body: (r) => `आपकी प्रोफ़ाइल अभी ग्राहकों से छिपी है: ${r}` },
  },
};

@Controller('v1/admin')
export class AdminController {
  /** Compared against when the email is unknown, so a wrong email and a wrong password take the same time. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly cloudinary: CloudinaryService,
    private readonly bookings: BookingsService,
  ) {}

  @Throttle({ default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MIN || 10), ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: AdminLoginDto) {
    const admin = await this.db.one<{
      id: string; email: string; role: string; password_hash: string; totp_secret: string; totp_last_step: string | null; locked: boolean;
      recovery_codes: string[];
    }>(
      this.db,
      `SELECT id, email, role, password_hash, totp_secret, totp_last_step, recovery_codes, locked_until > now() AS locked
         FROM admin_users WHERE email = $1 AND is_active`,
      [body.email.trim().toLowerCase()],
    );
    if (admin?.locked) {
      throw new AppError('ADMIN_LOCKED', 'Too many wrong attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const hash = admin?.password_hash ?? (await (this.dummyHash ??= hashPassword('dummy-password')));
    const passwordOk = await verifyPassword(body.password, hash);
    // One message for every failure, so the response does not reveal which part was wrong.
    // A code works once: a step at or before the last accepted one is refused (replayed or shoulder-surfed).
    const key = this.config.bankDetailsKey;
    const step = admin && body.totp ? totpStep(openSecret(admin.totp_secret, key), body.totp) : null;
    const freshStep = step !== null && (admin!.totp_last_step === null || step > Number(admin!.totp_last_step));
    const recoveryIndex = admin && body.recoveryCode && passwordOk ? findRecoveryCode(body.recoveryCode, admin.recovery_codes, key) : -1;
    if (!admin || !passwordOk || (!freshStep && recoveryIndex < 0)) {
      if (admin) {
        await this.db.query(
          `UPDATE admin_users SET
             locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
             failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
           WHERE id = $1`,
          [admin.id, ADMIN_MAX_FAILED_LOGINS, ADMIN_LOCK_MIN],
        );
      }
      throw new AppError('ADMIN_LOGIN_FAILED', 'Email, password or 2FA code is wrong.', HttpStatus.UNAUTHORIZED);
    }
    let recoveryCodesLeft = admin.recovery_codes.length;
    if (freshStep) {
      // Only one login can claim a step, even when two arrive at the same moment.
      const claimed = await this.db.query(
        `UPDATE admin_users SET failed_logins = 0, locked_until = NULL, totp_last_step = $2
          WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
        [admin.id, step],
      );
      if (!claimed.rowCount) throw new AppError('ADMIN_LOGIN_FAILED', 'Email, password or 2FA code is wrong.', HttpStatus.UNAUTHORIZED);
    } else {
      // A recovery code works once: it is removed (only if still there, so two logins cannot share it).
      const hash = admin.recovery_codes[recoveryIndex];
      const used = await this.db.query(
        `UPDATE admin_users SET failed_logins = 0, locked_until = NULL, recovery_codes = array_remove(recovery_codes, $2)
          WHERE id = $1 AND $2 = ANY(recovery_codes)`,
        [admin.id, hash],
      );
      if (!used.rowCount) throw new AppError('ADMIN_LOGIN_FAILED', 'Email, password or 2FA code is wrong.', HttpStatus.UNAUTHORIZED);
      recoveryCodesLeft -= 1;
      await this.db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1::uuid, 'admin.recovery_code_used', 'admin', $1::text, NULL, $2)`,
        [admin.id, { recoveryCodesLeft }],
      );
    }
    // 2FA secrets saved before encryption existed are encrypted now.
    if (!isSealed(admin.totp_secret)) {
      await this.db.query('UPDATE admin_users SET totp_secret = $2 WHERE id = $1 AND totp_secret = $3', [admin.id, sealSecret(admin.totp_secret, key), admin.totp_secret]);
    }
    return {
      accessToken: signAdminToken(this.config, admin.id),
      expiresInSec: ADMIN_TTL_SEC,
      admin: { id: admin.id, email: admin.email, role: admin.role },
      /** Shown as a warning when low: new ones can be made under Security. */
      recoveryCodesLeft,
      usedRecoveryCode: !freshStep,
    };
  }

  /** Ends every admin token issued to this admin so far (all browsers). */
  @UseGuards(AdminGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Admin() admin: AdminContext) {
    await this.db.query('UPDATE admin_users SET tokens_valid_after = now() WHERE id = $1', [admin.adminId]);
  }

  @UseGuards(AdminGuard)
  @Get('me')
  async me(@Admin() admin: AdminContext) {
    return this.db.one(
      this.db,
      `SELECT id, email, role, cardinality(recovery_codes) AS "recoveryCodesLeft",
              CASE WHEN step_up_until > now() AND step_up_session = $2::bigint THEN step_up_until END AS "stepUpUntil"
         FROM admin_users WHERE id = $1`,
      [admin.adminId, admin.session],
    );
  }

  /**
   * New one-time recovery codes (the old ones stop working). Shown once: the admin must save them.
   * Needs a fresh 2FA code, so a stolen session cannot replace them.
   */
  @UseGuards(AdminGuard)
  @StepUp()
  @Post('me/recovery-codes')
  @HttpCode(HttpStatus.OK)
  async newRecoveryCodes(@Admin() admin: AdminContext) {
    const { codes, hashes } = newRecoveryCodes(this.config.bankDetailsKey);
    await this.db.query('UPDATE admin_users SET recovery_codes = $2 WHERE id = $1', [admin.adminId, hashes]);
    await this.db.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1::uuid, 'admin.recovery_codes_reset', 'admin', $1::text, NULL, $2)`,
      [admin.adminId, { count: codes.length }],
    );
    return { codes };
  }

  /** The approval queue. Pending vendors come oldest first, so nobody waits longest. */
  @UseGuards(AdminGuard)
  @AdminRoles('verifier', 'support')
  @Get('vendors')
  async vendors(@Query() query: VendorListQuery) {
    const page = query.page ?? 1;
    const status = query.status ?? 'pending';
    const { rows } = await this.db.query(
      `SELECT v.id, v.business_name AS "businessName", v.status, v.area, v.created_at AS "createdAt",
              u.phone, c.slug AS category, c.name_en AS "categoryName", ci.name AS city,
              (SELECT count(*)::int FROM services s WHERE s.vendor_id = v.id AND s.is_active AND s.booking_type = 'slot') AS "serviceCount",
              (SELECT count(*)::int FROM packages p WHERE p.vendor_id = v.id AND p.is_active) AS "packageCount"
         FROM vendors v
         JOIN users u ON u.id = v.user_id
         JOIN categories c ON c.id = v.category_id
         JOIN cities ci ON ci.id = v.city_id
        WHERE v.status = $1
        ORDER BY v.created_at ${status === 'pending' ? 'ASC' : 'DESC'}, v.id
        LIMIT $2 OFFSET $3`,
      [status, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    );
    return { items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE };
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier', 'support')
  @Get('vendors/:id')
  async vendor(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    const v = await loadVendor(this.db, id, 'en', 'admin');
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Vendor not found.', HttpStatus.NOT_FOUND);
    const owner = await this.db.one(
      this.db,
      'SELECT u.id, u.phone, u.name FROM users u JOIN vendors v ON v.user_id = u.id WHERE v.id = $1',
      [id],
    );
    const history = await this.db.query(
      `SELECT l.action, l.after->>'reason' AS reason, l.after->>'docType' AS "docType", a.email AS "adminEmail", l.created_at AS "createdAt"
         FROM admin_audit_log l JOIN admin_users a ON a.id = l.admin_id
        WHERE l.target_type = 'vendor' AND l.target_id = $1 ORDER BY l.created_at DESC`,
      [id],
    );
    // ID documents are private files; only verifiers get a link, and it expires in 10 minutes.
    const canSeeDocs = admin.role === 'super' || admin.role === 'verifier';
    const docs = await this.db.query<{ id: string; docType: string; last4: string | null; status: string; rejectReason: string | null; createdAt: Date; storage_key: string; format: string }>(
      `SELECT DISTINCT ON (doc_type) id, doc_type AS "docType", last4, status, reject_reason AS "rejectReason",
              created_at AS "createdAt", storage_key, format
         FROM vendor_documents WHERE vendor_id = $1 ORDER BY doc_type, created_at DESC`,
      [id],
    );
    const documents = docs.rows.map(({ storage_key, format, ...d }) => ({
      ...d,
      viewUrl: canSeeDocs && this.config.cloudinary ? this.cloudinary.privateDownloadUrl(storage_key, format) : null,
    }));
    return { ...v, owner, history: history.rows, documents };
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier')
  @Post('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveDocument(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewDocument(admin, id, 'approved', null);
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier')
  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectDocument(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.reviewDocument(admin, id, 'rejected', body.reason.trim());
  }

  private async reviewDocument(admin: AdminContext, id: string, status: 'approved' | 'rejected', reason: string | null) {
    return this.db.tx(async (client) => {
      const d = await this.db.one<{ status: string; vendor_id: string; doc_type: string }>(
        client,
        'SELECT status, vendor_id, doc_type FROM vendor_documents WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!d) throw new AppError('NOT_FOUND', 'Document not found.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE vendor_documents SET status = $2, reject_reason = $3, reviewed_by = $4 WHERE id = $1', [id, status, reason, admin.adminId]);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'vendor', $3, $4, $5)`,
        [admin.adminId, `document.${status === 'approved' ? 'approve' : 'reject'}`, d.vendor_id, { docType: d.doc_type, status: d.status }, { docType: d.doc_type, status, reason }],
      );
      if (status === 'rejected') {
        const owner = await this.db.one<{ user_id: string }>(client, 'SELECT user_id FROM vendors WHERE id = $1', [d.vendor_id]);
        const name = DOC_NAMES[d.doc_type] ?? { en: d.doc_type, hi: d.doc_type };
        await notify(client, owner!.user_id, 'document_rejected', {
          en: { title: `${name.en} not accepted`, body: `${reason}. Please upload it again.` },
          hi: { title: `${name.hi} स्वीकार नहीं हुआ`, body: `${reason}। कृपया दोबारा अपलोड करें।` },
        }, { documentId: id }, 'partner');
      }
      return { id, status, rejectReason: reason };
    });
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier')
  @Post('vendors/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.decide(admin, id, 'approve', null);
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier')
  @Post('vendors/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.decide(admin, id, 'reject', body.reason.trim());
  }

  @UseGuards(AdminGuard)
  @AdminRoles('verifier')
  @Post('vendors/:id/hold')
  @HttpCode(HttpStatus.OK)
  hold(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.decide(admin, id, 'hold', body.reason.trim());
  }

  /** Status change + audit log + Partner app notification, all in one transaction. */
  private async decide(admin: AdminContext, vendorId: string, decision: Decision, reason: string | null) {
    return this.db.tx(async (client) => {
      const v = await this.db.one<{ status: VendorStatus; reject_reason: string | null; user_id: string; language: Language }>(
        client,
        `SELECT v.status, v.reject_reason, v.user_id, u.language
           FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = $1 FOR UPDATE OF v`,
        [vendorId],
      );
      if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Vendor not found.', HttpStatus.NOT_FOUND);
      if (!ALLOWED_FROM[decision].includes(v.status)) {
        throw new AppError('VENDOR_BAD_STATUS', `This vendor is ${v.status.replace('_', ' ')}, so this cannot be done.`, HttpStatus.CONFLICT, {
          status: v.status,
        });
      }
      const status = RESULT[decision];
      await client.query(
        `UPDATE vendors SET status = $2::vendor_status, reject_reason = $3,
                approved_at = CASE WHEN $2::vendor_status = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END
          WHERE id = $1`,
        [vendorId, status, reason],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after)
         VALUES ($1, $2, 'vendor', $3, $4, $5)`,
        [admin.adminId, `vendor.${decision}`, vendorId, { status: v.status, reason: v.reject_reason }, { status, reason }],
      );
      // A paused vendor cannot answer or honour new bookings, so those customers hear now.
      const open = status === 'on_hold' ? await this.bookings.closeOpenFor(client, vendorId) : null;
      const text = (lang: Language) => ({ title: NOTICE[decision][lang].title, body: NOTICE[decision][lang].body(reason) });
      await notify(client, v.user_id, `vendor_${status}`, { en: text('en'), hi: text('hi') }, { vendorId }, 'partner');
      return { id: vendorId, status, rejectReason: reason, ...(open && { closedBookings: open.closed, confirmedBookings: open.confirmed }) };
    });
  }
}
