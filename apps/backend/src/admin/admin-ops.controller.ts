import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';
import { BOOKING_STATUSES, type BookingStatus } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { todayIst } from '../bookings/booking.rules';
import { notify } from '../notifications/notify';
import { BookingsService } from '../bookings/bookings.service';
import { refreshRating } from '../social/social.controller';
import { AppConfig, CONFIG } from '../config';
import { decrypt } from '../common/crypto';
import { BANK_COLUMNS } from '../partner/partner-home.controller';
import { Admin, AdminContext, AdminGuard, AdminRoles } from './admin-auth';
import { StepUp } from './admin-2fa';

const PAGE_SIZE = 20;

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class BookingsQuery extends PageQuery {
  @IsOptional() @IsIn(BOOKING_STATUSES) status?: BookingStatus;
  @IsOptional() @IsString() @MaxLength(40) q?: string;
}

class PayoutsQuery extends PageQuery {
  @IsOptional() @IsIn(['scheduled', 'processing', 'paid', 'failed', 'held']) status?: string;
  /** Only payouts whose release time has come. */
  @IsOptional() @IsIn(['true', 'false']) due?: string;
}

class ComplaintsQuery extends PageQuery {
  @IsOptional() @IsIn(['open', 'in_progress', 'resolved']) status?: string;
}

class UsersQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(40) q?: string;
}

class MediaQuery extends PageQuery {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: string;
}

class ReasonDto {
  @IsString() @Length(3, 300) reason: string;
}

class ReferenceDto {
  @IsString() @Length(3, 100) reference: string;
}

class ComplaintUpdateDto {
  @IsIn(['open', 'in_progress', 'resolved']) status: string;
  @IsOptional() @IsString() @Length(3, 2000) resolution?: string;
}

const page = (q: PageQuery) => q.page ?? 1;
const paged = <T>(rows: T[], p: number) => ({ items: rows.slice(0, PAGE_SIZE), page: p, hasMore: rows.length > PAGE_SIZE });

async function audit(q: Queryable, adminId: string, action: string, targetType: string, targetId: string, before: object | null, after: object | null) {
  await q.query(
    `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, $3, $4, $5, $6)`,
    [adminId, action, targetType, targetId, before, after],
  );
}

/** Admin panel pages beyond vendor approval: dashboard, bookings, payouts, complaints, users, moderation. */
@UseGuards(AdminGuard)
@Controller('v1/admin')
export class AdminOpsController {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly bookingsService: BookingsService,
  ) {}

  @Get('dashboard')
  async dashboard() {
    const today = todayIst();
    const month = today.slice(0, 7);
    const stats = await this.db.one(
      this.db,
      `SELECT
         (SELECT count(*)::int FROM vendors WHERE status = 'pending') AS "pendingVendors",
         (SELECT count(*)::int FROM vendors WHERE status = 'approved') AS "liveVendors",
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM users WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS "newUsersToday",
         (SELECT count(*)::int FROM bookings WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS "bookingsToday",
         (SELECT count(*)::int FROM bookings WHERE status IN ('confirmed', 'completed') AND to_char(day, 'YYYY-MM') = $1) AS "monthConfirmed",
         (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM bookings WHERE status IN ('confirmed', 'completed') AND to_char(day, 'YYYY-MM') = $1) AS "monthGmvPaise",
         (SELECT COALESCE(sum(commission_paise), 0)::bigint FROM bookings WHERE status IN ('confirmed', 'completed') AND to_char(day, 'YYYY-MM') = $1) AS "monthCommissionPaise",
         (SELECT count(*)::int FROM complaints WHERE status <> 'resolved') AS "openComplaints",
         (SELECT count(*)::int FROM media WHERE status = 'pending') AS "pendingMedia",
         (SELECT count(*)::int FROM payouts WHERE status = 'scheduled' AND release_after <= now()) AS "duePayouts",
         (SELECT COALESCE(sum(r.discount_paise), 0)::bigint FROM coupon_redemptions r JOIN bookings b ON b.id = r.booking_id
           WHERE r.status = 'used' AND to_char(b.day, 'YYYY-MM') = $1) AS "monthDiscountPaise",
         (SELECT COALESCE(sum(amount_paise), 0)::bigint FROM featured_purchases
           WHERE status = 'paid' AND to_char(paid_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $1) AS "monthFeaturedPaise",
         (SELECT count(*)::int FROM vendors WHERE featured_until > now()) AS "featuredVendors",
         (SELECT count(*)::int FROM otp_requests WHERE sms_sent AND created_at > now() - interval '24 hours') AS "smsLast24h",
         (SELECT count(*)::int FROM system_alerts WHERE resolved_at IS NULL) AS "openAlerts"`,
      [month],
    );
    const byStatus = await this.db.query(
      `SELECT status, count(*)::int AS n FROM bookings WHERE to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $1 GROUP BY status`,
      [month],
    );
    const daily = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT count(*)::int FROM bookings b WHERE (b.created_at AT TIME ZONE 'Asia/Kolkata')::date = d) AS bookings
         FROM generate_series($1::date - 13, $1::date, interval '1 day') d ORDER BY d`,
      [today],
    );
    const topCategories = await this.db.query(
      `SELECT c.slug, c.name_en AS name, count(*)::int AS bookings
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id JOIN categories c ON c.id = v.category_id
        WHERE b.status IN ('confirmed', 'completed') AND to_char(b.day, 'YYYY-MM') = $1
        GROUP BY c.slug, c.name_en ORDER BY bookings DESC LIMIT 5`,
      [month],
    );
    return {
      month,
      ...stats,
      monthGmvPaise: Number(stats!.monthGmvPaise),
      monthCommissionPaise: Number(stats!.monthCommissionPaise),
      smsBudgetPerDay: this.config.smsBudget.perDay,
      monthDiscountPaise: Number(stats!.monthDiscountPaise),
      monthFeaturedPaise: Number(stats!.monthFeaturedPaise),
      // What EventSeva earned: commission − coupon discounts + featured sales.
      monthNetRevenuePaise: Number(stats!.monthCommissionPaise) - Number(stats!.monthDiscountPaise) + Number(stats!.monthFeaturedPaise),
      bookingsByStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
      last14Days: daily.rows,
      topCategories: topCategories.rows,
    };
  }

  /** Problems the system raised (SMS budget …), newest first; open ones first. */
  @Get('alerts')
  async alerts() {
    const { rows } = await this.db.query(
      `SELECT al.id::int, al.kind, al.message, al.data, al.created_at AS "createdAt", al.resolved_at AS "resolvedAt", a.email AS "resolvedBy"
         FROM system_alerts al LEFT JOIN admin_users a ON a.id = al.resolved_by
        ORDER BY (al.resolved_at IS NULL) DESC, al.id DESC LIMIT 50`,
    );
    return { items: rows };
  }

  @AdminRoles('support')
  @Post('alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveAlert(@Admin() admin: AdminContext, @Param('id', ParseIntPipe) id: number) {
    const row = await this.db.one(
      this.db,
      `UPDATE system_alerts SET resolved_at = now(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING id::int`,
      [id, admin.adminId],
    );
    if (!row) throw new AppError('NOT_FOUND', 'Alert not found or already resolved.', HttpStatus.NOT_FOUND);
    await audit(this.db, admin.adminId, 'alert.resolve', 'alert', String(id), null, null);
    return { id, resolved: true };
  }

  @AdminRoles('support', 'finance')
  @Get('bookings')
  async bookings(@Query() query: BookingsQuery) {
    const p = page(query);
    const { rows } = await this.db.query(
      `SELECT b.id, b.status, b.day, b.slot, b.amount_paise AS "amountPaise", b.advance_paise AS "advancePaise",
              b.commission_paise AS "commissionPaise", b.refund_paise AS "refundPaise", b.created_at AS "createdAt",
              e.title AS "eventTitle", v.id AS "vendorId", v.business_name AS "vendorName",
              cu.phone AS "customerPhone", cu.name AS "customerName"
         FROM bookings b JOIN events e ON e.id = b.event_id JOIN vendors v ON v.id = b.vendor_id JOIN users cu ON cu.id = b.customer_id
        WHERE ($1::booking_status IS NULL OR b.status = $1)
          AND ($2::text IS NULL OR v.business_name ILIKE '%' || $2 || '%' OR cu.phone LIKE '%' || $2 || '%' OR b.id::text = $2)
        ORDER BY b.created_at DESC LIMIT $3 OFFSET $4`,
      [query.status ?? null, query.q?.trim() || null, PAGE_SIZE + 1, (p - 1) * PAGE_SIZE],
    );
    return paged(rows, p);
  }

  @AdminRoles('support', 'finance')
  @Get('bookings/:id')
  async booking(@Param('id', ParseUUIDPipe) id: string) {
    const b = await this.db.one(
      this.db,
      `SELECT b.*, e.title AS event_title, e.event_type, v.business_name, vu.phone AS vendor_phone, cu.phone AS customer_phone, cu.name AS customer_name
         FROM bookings b JOIN events e ON e.id = b.event_id JOIN vendors v ON v.id = b.vendor_id
         JOIN users vu ON vu.id = v.user_id JOIN users cu ON cu.id = b.customer_id WHERE b.id = $1`,
      [id],
    );
    if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const payments = await this.db.query(
      `SELECT id, type, amount_paise AS "amountPaise", status, razorpay_order_id AS "orderId", razorpay_payment_id AS "paymentId",
              razorpay_refund_id AS "refundId", created_at AS "createdAt", paid_at AS "paidAt"
         FROM payments WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    );
    const payout = await this.db.one(
      this.db,
      `SELECT id, amount_paise AS "amountPaise", status, release_after AS "releaseAfter", razorpay_transfer_id AS reference
         FROM payouts WHERE booking_id = $1`,
      [id],
    );
    const refunds = await this.db.query(
      `SELECT id, amount_paise AS "amountPaise", reason, status, attempts, last_error AS "lastError",
              razorpay_refund_id AS "refundId", created_at AS "createdAt", sent_at AS "sentAt"
         FROM refunds WHERE booking_id = $1 ORDER BY created_at`,
      [id],
    );
    return {
      id: b.id,
      status: b.status,
      day: b.day,
      slot: b.slot,
      quantity: b.quantity,
      note: b.details?.note ?? null,
      amountPaise: b.amount_paise,
      advancePaise: b.advance_paise,
      commissionPaise: b.commission_paise,
      refundPaise: b.refund_paise,
      discountPaise: b.discount_paise,
      payoutDeductionPaise: b.payout_deduction_paise,
      cancelReason: b.cancel_reason,
      event: { id: b.event_id, title: b.event_title, eventType: b.event_type },
      vendor: { id: b.vendor_id, businessName: b.business_name, phone: b.vendor_phone },
      customer: { id: b.customer_id, name: b.customer_name, phone: b.customer_phone },
      createdAt: b.created_at,
      payments: payments.rows,
      /** The refund queue: pending / sending ones are still on their way to Razorpay. */
      refunds: refunds.rows,
      payout: payout ?? null,
    };
  }

  @AdminRoles('finance')
  @Get('payouts')
  async payouts(@Query() query: PayoutsQuery) {
    const p = page(query);
    const { rows } = await this.db.query(
      `SELECT po.id, po.amount_paise AS "amountPaise", po.status, po.release_after AS "releaseAfter",
              po.razorpay_transfer_id AS reference, po.booking_id AS "bookingId", b.day,
              v.id AS "vendorId", v.business_name AS "vendorName", ba.status AS "bankStatus"
         FROM payouts po JOIN bookings b ON b.id = po.booking_id JOIN vendors v ON v.id = po.vendor_id
         LEFT JOIN vendor_bank_accounts ba ON ba.vendor_id = v.id
        WHERE ($1::payout_status IS NULL OR po.status = $1) AND ($2::boolean IS NOT TRUE OR po.release_after <= now())
        ORDER BY po.release_after LIMIT $3 OFFSET $4`,
      [query.status ?? null, query.due === undefined ? null : query.due === 'true', PAGE_SIZE + 1, (p - 1) * PAGE_SIZE],
    );
    return paged(rows, p);
  }

  /** Full account number for paying a vendor by bank transfer. Every view is written to the audit log. */
  @AdminRoles('finance')
  @StepUp()
  @Get('vendors/:id/bank-account')
  async vendorBank(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.db.one(this.db, `SELECT ${BANK_COLUMNS}, account_enc FROM vendor_bank_accounts WHERE vendor_id = $1`, [id]);
    if (!row) throw new AppError('NOT_FOUND', 'This vendor has not added a bank account yet.', HttpStatus.NOT_FOUND);
    await audit(this.db, admin.adminId, 'bank.view', 'vendor', id, null, null);
    const { account_enc, ...rest } = row;
    return { ...rest, accountNumber: decrypt(account_enc, this.config.bankDetailsKey) };
  }

  @AdminRoles('finance')
  @StepUp()
  @Post('vendors/:id/bank-account/verify')
  @HttpCode(HttpStatus.OK)
  verifyBank(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviewBank(admin, id, 'verified', null);
  }

  @AdminRoles('finance')
  @StepUp()
  @Post('vendors/:id/bank-account/reject')
  @HttpCode(HttpStatus.OK)
  rejectBank(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.reviewBank(admin, id, 'rejected', body.reason.trim());
  }

  private async reviewBank(admin: AdminContext, vendorId: string, status: 'verified' | 'rejected', reason: string | null) {
    return this.db.tx(async (client) => {
      const ba = await this.db.one<{ status: string; vendor_user_id: string }>(
        client,
        `SELECT ba.status, v.user_id AS vendor_user_id FROM vendor_bank_accounts ba JOIN vendors v ON v.id = ba.vendor_id
          WHERE ba.vendor_id = $1 FOR UPDATE OF ba`,
        [vendorId],
      );
      if (!ba) throw new AppError('NOT_FOUND', 'This vendor has not added a bank account yet.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE vendor_bank_accounts SET status = $2, reject_reason = $3, verified_by = $4 WHERE vendor_id = $1', [vendorId, status, reason, admin.adminId]);
      await audit(client, admin.adminId, `bank.${status === 'verified' ? 'verify' : 'reject'}`, 'vendor', vendorId, { status: ba.status }, { status, reason });
      await notify(client, ba.vendor_user_id, `bank_${status}`, status === 'verified'
        ? { en: { title: 'Bank account verified', body: 'Your payouts will be sent to this account.' }, hi: { title: 'बैंक खाता सत्यापित', body: 'आपका पेमेंट इसी खाते में भेजा जाएगा।' } }
        : { en: { title: 'Please check your bank details', body: reason! }, hi: { title: 'कृपया बैंक विवरण जाँचें', body: reason! } },
        {}, 'partner');
      return { vendorId, status, rejectReason: reason };
    });
  }

  /**
   * Until Razorpay Route transfers are automated, finance pays vendors by bank transfer and
   * records the UTR / reference here.
   */
  @AdminRoles('finance')
  @StepUp()
  @Post('payouts/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  async markPaid(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReferenceDto) {
    return this.db.tx(async (client) => {
      const po = await this.db.one<{ status: string; vendor_user_id: string; amount_paise: number }>(
        client,
        `SELECT po.status, v.user_id AS vendor_user_id, po.amount_paise FROM payouts po JOIN vendors v ON v.id = po.vendor_id
          WHERE po.id = $1 FOR UPDATE OF po`,
        [id],
      );
      if (!po) throw new AppError('NOT_FOUND', 'Payout not found.', HttpStatus.NOT_FOUND);
      if (!['scheduled', 'processing', 'held', 'failed'].includes(po.status)) {
        throw new AppError('PAYOUT_BAD_STATUS', 'This payout is already paid.', HttpStatus.CONFLICT, { status: po.status });
      }
      await client.query(`UPDATE payouts SET status = 'paid', razorpay_transfer_id = $2 WHERE id = $1`, [id, body.reference.trim()]);
      await audit(client, admin.adminId, 'payout.mark_paid', 'payout', id, { status: po.status }, { status: 'paid', reference: body.reference.trim() });
      const amount = `₹${(po.amount_paise / 100).toLocaleString('en-IN')}`;
      await notify(client, po.vendor_user_id, 'payout_paid', {
        en: { title: 'Payout sent', body: `${amount} has been sent to your bank. Reference: ${body.reference.trim()}` },
        hi: { title: 'पेमेंट भेजा गया', body: `${amount} आपके बैंक में भेज दिया गया। रेफ़रेंस: ${body.reference.trim()}` },
      }, { payoutId: id }, 'partner');
      return { id, status: 'paid' };
    });
  }

  @AdminRoles('finance')
  @StepUp()
  @Post('payouts/:id/hold')
  @HttpCode(HttpStatus.OK)
  async holdPayout(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.db.tx(async (client) => {
      const po = await this.db.one<{ status: string }>(client, 'SELECT status FROM payouts WHERE id = $1 FOR UPDATE', [id]);
      if (!po) throw new AppError('NOT_FOUND', 'Payout not found.', HttpStatus.NOT_FOUND);
      if (!['scheduled', 'processing'].includes(po.status)) {
        throw new AppError('PAYOUT_BAD_STATUS', 'Only scheduled payouts can be held.', HttpStatus.CONFLICT, { status: po.status });
      }
      await client.query(`UPDATE payouts SET status = 'held' WHERE id = $1`, [id]);
      await audit(client, admin.adminId, 'payout.hold', 'payout', id, { status: po.status }, { status: 'held', reason: body.reason });
      return { id, status: 'held' };
    });
  }

  @AdminRoles('support')
  @Get('complaints')
  async complaints(@Query() query: ComplaintsQuery) {
    const p = page(query);
    const { rows } = await this.db.query(
      `SELECT c.id, c.subject, c.details, c.status, c.resolution, c.booking_id AS "bookingId", c.created_at AS "createdAt",
              u.phone AS "raisedByPhone", u.name AS "raisedByName",
              EXISTS (SELECT 1 FROM vendors v WHERE v.user_id = u.id) AS "raisedByVendor"
         FROM complaints c JOIN users u ON u.id = c.raised_by
        WHERE ($1::text IS NULL OR c.status = $1)
        ORDER BY (c.status = 'resolved'), c.created_at LIMIT $2 OFFSET $3`,
      [query.status ?? null, PAGE_SIZE + 1, (p - 1) * PAGE_SIZE],
    );
    return paged(rows, p);
  }

  @AdminRoles('support')
  @Post('complaints/:id')
  @HttpCode(HttpStatus.OK)
  async updateComplaint(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ComplaintUpdateDto) {
    if (body.status === 'resolved' && !body.resolution) throw new AppError('VALIDATION', 'Write how it was resolved.');
    return this.db.tx(async (client) => {
      const c = await this.db.one<{ status: string; raised_by: string; subject: string }>(
        client,
        'SELECT status, raised_by, subject FROM complaints WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!c) throw new AppError('NOT_FOUND', 'Complaint not found.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE complaints SET status = $2, resolution = COALESCE($3, resolution) WHERE id = $1', [id, body.status, body.resolution ?? null]);
      await audit(client, admin.adminId, 'complaint.update', 'complaint', id, { status: c.status }, { status: body.status, resolution: body.resolution ?? null });
      if (body.status === 'resolved') {
        await notify(client, c.raised_by, 'complaint_resolved', {
          en: { title: 'Your complaint is resolved', body: `${c.subject}: ${body.resolution}` },
          hi: { title: 'आपकी शिकायत हल हो गई', body: `${c.subject}: ${body.resolution}` },
        }, { complaintId: id });
      }
      return { id, status: body.status, resolution: body.resolution ?? null };
    });
  }

  @AdminRoles('support')
  @Get('users')
  async users(@Query() query: UsersQuery) {
    const p = page(query);
    const { rows } = await this.db.query(
      `SELECT u.id, u.phone, u.name, u.language, u.is_blocked AS "isBlocked", u.created_at AS "createdAt",
              v.id AS "vendorId", v.business_name AS "vendorName", v.status AS "vendorStatus",
              (SELECT count(*)::int FROM bookings b WHERE b.customer_id = u.id) AS "bookingCount"
         FROM users u LEFT JOIN vendors v ON v.user_id = u.id
        WHERE u.deleted_at IS NULL AND ($1::text IS NULL OR u.phone LIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%')
        ORDER BY u.created_at DESC LIMIT $2 OFFSET $3`,
      [query.q?.trim() || null, PAGE_SIZE + 1, (p - 1) * PAGE_SIZE],
    );
    return paged(rows, p);
  }

  /** Blocking also logs the user out everywhere at once. */
  @AdminRoles('support')
  @StepUp()
  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  async block(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.db.tx(async (client) => {
      const res = await client.query('UPDATE users SET is_blocked = true WHERE id = $1 AND NOT is_blocked', [id]);
      if (!res.rowCount) throw new AppError('NOT_FOUND', 'User not found or already blocked.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      // A blocked vendor must not stay in search or keep receiving requests. Unblocking does not
      // put it back: a verifier approves the profile again.
      const vendor = await this.db.one<{ id: string }>(
        client,
        `UPDATE vendors SET status = 'on_hold', reject_reason = 'Owner account blocked'
          WHERE user_id = $1 AND status IN ('pending', 'approved') RETURNING id`,
        [id],
      );
      const open = vendor ? await this.bookingsService.closeOpenFor(client, vendor.id) : null;
      await audit(client, admin.adminId, 'user.block', 'user', id, { isBlocked: false }, { isBlocked: true, reason: body.reason });
      return { id, isBlocked: true, ...(open && { vendorOnHold: true, closedBookings: open.closed, confirmedBookings: open.confirmed }) };
    });
  }

  @AdminRoles('support')
  @StepUp()
  @Post('users/:id/unblock')
  @HttpCode(HttpStatus.OK)
  async unblock(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(async (client) => {
      const res = await client.query('UPDATE users SET is_blocked = false WHERE id = $1 AND is_blocked', [id]);
      if (!res.rowCount) throw new AppError('NOT_FOUND', 'User not found or not blocked.', HttpStatus.NOT_FOUND);
      await audit(client, admin.adminId, 'user.unblock', 'user', id, { isBlocked: true }, { isBlocked: false });
      return { id, isBlocked: false };
    });
  }

  /** Photo / video moderation queue (uploads arrive as "pending"). */
  @AdminRoles('verifier')
  @Get('media')
  async media(@Query() query: MediaQuery) {
    const p = page(query);
    const { rows } = await this.db.query(
      `SELECT m.id, m.type, m.public_id AS "publicId", m.width, m.height, m.duration_sec AS "durationSec", m.status,
              m.reject_reason AS "rejectReason", m.created_at AS "createdAt", v.id AS "vendorId", v.business_name AS "vendorName"
         FROM media m JOIN vendors v ON v.id = m.vendor_id
        WHERE m.status = $1 ORDER BY m.created_at LIMIT $2 OFFSET $3`,
      [query.status ?? 'pending', PAGE_SIZE + 1, (p - 1) * PAGE_SIZE],
    );
    return paged(rows, p);
  }

  @AdminRoles('verifier')
  @Post('media/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveMedia(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.moderate(admin, id, 'approved', null);
  }

  @AdminRoles('verifier')
  @Post('media/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectMedia(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.moderate(admin, id, 'rejected', body.reason.trim());
  }

  private async moderate(admin: AdminContext, id: string, status: 'approved' | 'rejected', reason: string | null) {
    return this.db.tx(async (client) => {
      const m = await this.db.one<{ status: string; vendor_user_id: string }>(
        client,
        `SELECT m.status, v.user_id AS vendor_user_id FROM media m JOIN vendors v ON v.id = m.vendor_id WHERE m.id = $1 FOR UPDATE OF m`,
        [id],
      );
      if (!m) throw new AppError('NOT_FOUND', 'Media not found.', HttpStatus.NOT_FOUND);
      if (m.status === 'uploading') throw new AppError('MEDIA_BAD_STATUS', 'Upload is not finished yet.', HttpStatus.CONFLICT);
      await client.query('UPDATE media SET status = $2, reject_reason = $3 WHERE id = $1', [id, status, reason]);
      await audit(client, admin.adminId, `media.${status === 'approved' ? 'approve' : 'reject'}`, 'media', id, { status: m.status }, { status, reason });
      if (status === 'rejected') {
        await notify(client, m.vendor_user_id, 'media_rejected', {
          en: { title: 'A photo was not approved', body: reason! },
          hi: { title: 'एक फ़ोटो मंज़ूर नहीं हुई', body: reason! },
        }, { mediaId: id }, 'partner');
      }
      return { id, status, rejectReason: reason };
    });
  }

  /** Hides abusive or fake reviews; the vendor rating is recalculated. */
  @AdminRoles('support')
  @Post('reviews/:id/hide')
  @HttpCode(HttpStatus.OK)
  async hideReview(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto) {
    return this.db.tx(async (client) => {
      const r = await this.db.one<{ vendor_id: string }>(client, 'UPDATE reviews SET is_hidden = true WHERE id = $1 AND NOT is_hidden RETURNING vendor_id', [id]);
      if (!r) throw new AppError('NOT_FOUND', 'Review not found.', HttpStatus.NOT_FOUND);
      await refreshRating(client, r.vendor_id);
      await audit(client, admin.adminId, 'review.hide', 'review', id, { isHidden: false }, { isHidden: true, reason: body.reason });
      return { id, isHidden: true };
    });
  }
}
