import { Body, Controller, Get, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AppConfig, CONFIG } from '../config';
import { encrypt } from '../common/crypto';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { todayIst } from '../bookings/booking.rules';
import { PartnerAppGuard } from './partner.controller';

class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month?: string;
}

class BankAccountDto {
  @IsString() @Length(2, 80) holderName: string;
  /** Indian bank account numbers are 9–18 digits. */
  @Matches(/^\d{9,18}$/, { message: 'Account number must be 9 to 18 digits' }) accountNumber: string;
  @Matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, { message: 'IFSC looks like SBIN0001234' }) ifsc: string;
  @IsOptional() @Matches(/^[\w.-]{2,64}@[A-Za-z]{2,64}$/, { message: 'UPI ID looks like name@bank' }) upiId?: string;
}

export const BANK_COLUMNS = `holder_name AS "holderName", account_last4 AS "accountLast4", ifsc, upi_id AS "upiId", status,
  reject_reason AS "rejectReason", updated_at AS "updatedAt"`;

class ReplyDto {
  @IsString() @Length(2, 1000) reply: string;
}

/** Partner app home ("Aaj"), earnings ("Kamai") and replies to reviews. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerHomeController {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async vendorId(userId: string) {
    const v = await this.db.one<{ id: string }>(this.db, 'SELECT id FROM vendors WHERE user_id = $1', [userId]);
    if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
    return v.id;
  }

  @Get('dashboard')
  async dashboard(@Auth() auth: AuthContext) {
    const vendorId = await this.vendorId(auth.userId);
    const month = todayIst().slice(0, 7);
    const stats = await this.db.one(
      this.db,
      `SELECT v.status, v.rating_avg::float AS "ratingAvg", v.rating_count AS "ratingCount",
              (SELECT count(*)::int FROM bookings WHERE vendor_id = v.id AND status = 'requested' AND respond_by > now()) AS "newRequests",
              (SELECT count(*)::int FROM bookings WHERE vendor_id = v.id AND status = 'accepted') AS "awaitingPayment",
              -- Rentals and vehicles this vendor should already have back; until one is closed its
              -- stock cannot be re-let and the customer's deposit stays held.
              (SELECT count(*)::int FROM bookings
                WHERE vendor_id = v.id AND booking_type IN ('rental', 'transport') AND status = 'confirmed'
                  AND fulfilment <> 'closed' AND return_due_at < now()) AS "overdueReturns",
              (SELECT count(*)::int FROM bookings WHERE vendor_id = v.id AND status IN ('confirmed', 'completed')
                  AND to_char(day, 'YYYY-MM') = $2) AS "monthBookings",
              (SELECT COALESCE(sum(advance_paise - commission_paise), 0)::int FROM bookings WHERE vendor_id = v.id
                  AND status IN ('confirmed', 'completed') AND to_char(day, 'YYYY-MM') = $2) AS "monthEarningsPaise",
              (SELECT COALESCE(sum(amount_paise), 0)::int FROM payouts WHERE vendor_id = v.id AND status IN ('scheduled', 'processing')) AS "pendingPayoutPaise",
              (SELECT count(*)::int FROM conversations c WHERE c.vendor_id = v.id AND EXISTS (
                  SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> v.user_id AND m.read_at IS NULL)) AS "unreadChats"
         FROM vendors v WHERE v.id = $1`,
      [vendorId, month],
    );
    const upcoming = await this.db.query(
      `SELECT b.id, b.day, b.slot, b.status, e.title AS "eventTitle", COALESCE(s.title, p.title) AS "itemTitle"
         FROM bookings b JOIN events e ON e.id = b.event_id
         LEFT JOIN services s ON s.id = b.service_id LEFT JOIN packages p ON p.id = b.package_id
        WHERE b.vendor_id = $1 AND b.status = 'confirmed' AND b.day >= $2 ORDER BY b.day LIMIT 5`,
      [vendorId, todayIst()],
    );
    return { month, ...stats, upcoming: upcoming.rows };
  }

  /** One month of earnings: what was earned (advance − commission) and each payout's state. */
  @Get('earnings')
  async earnings(@Auth() auth: AuthContext, @Query() query: MonthQuery) {
    const vendorId = await this.vendorId(auth.userId);
    const month = query.month ?? todayIst().slice(0, 7);
    const totals = await this.db.one(
      this.db,
      `SELECT count(*)::int AS bookings, COALESCE(sum(amount_paise), 0)::int AS "grossPaise",
              COALESCE(sum(commission_paise), 0)::int AS "commissionPaise",
              COALESCE(sum(advance_paise - commission_paise), 0)::int AS "payoutPaise",
              COALESCE(sum(amount_paise - advance_paise), 0)::int AS "collectAtEventPaise"
         FROM bookings WHERE vendor_id = $1 AND status IN ('confirmed', 'completed') AND to_char(day, 'YYYY-MM') = $2`,
      [vendorId, month],
    );
    const payouts = await this.db.query(
      `SELECT po.id, po.amount_paise AS "amountPaise", po.status, po.release_after AS "releaseAfter",
              b.id AS "bookingId", b.day, e.title AS "eventTitle", e.event_type AS "eventType"
         FROM payouts po JOIN bookings b ON b.id = po.booking_id JOIN events e ON e.id = b.event_id
        WHERE po.vendor_id = $1 AND to_char(b.day, 'YYYY-MM') = $2 ORDER BY b.day DESC`,
      [vendorId, month],
    );
    return { month, ...totals, payouts: payouts.rows };
  }

  /** Where payouts go. Only the last 4 digits ever come back. */
  @Get('bank-account')
  async bankAccount(@Auth() auth: AuthContext) {
    const vendorId = await this.vendorId(auth.userId);
    const row = await this.db.one(this.db, `SELECT ${BANK_COLUMNS} FROM vendor_bank_accounts WHERE vendor_id = $1`, [vendorId]);
    return { account: row ?? null };
  }

  /** Saving (or changing) details sends them back for a check by the finance team. */
  @Put('bank-account')
  async saveBankAccount(@Auth() auth: AuthContext, @Body() body: BankAccountDto) {
    const vendorId = await this.vendorId(auth.userId);
    const row = await this.db.one(
      this.db,
      `INSERT INTO vendor_bank_accounts (vendor_id, holder_name, account_enc, account_last4, ifsc, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (vendor_id) DO UPDATE SET holder_name = $2, account_enc = $3, account_last4 = $4, ifsc = $5, upi_id = $6,
              status = 'pending', reject_reason = NULL, verified_by = NULL, updated_at = now()
       RETURNING ${BANK_COLUMNS}`,
      [vendorId, body.holderName.trim(), encrypt(body.accountNumber, this.config.bankDetailsKey), body.accountNumber.slice(-4),
        body.ifsc.toUpperCase(), body.upiId?.toLowerCase() ?? null],
    );
    return { account: row };
  }

  @Get('reviews')
  async reviews(@Auth() auth: AuthContext) {
    const vendorId = await this.vendorId(auth.userId);
    const { rows } = await this.db.query(
      `SELECT r.id, r.rating, r.comment, r.vendor_reply AS "vendorReply", r.created_at AS "createdAt",
              COALESCE(split_part(u.name, ' ', 1), 'Customer') AS "customerName", b.day
         FROM reviews r JOIN users u ON u.id = r.customer_id JOIN bookings b ON b.id = r.booking_id
        WHERE r.vendor_id = $1 AND NOT r.is_hidden ORDER BY r.created_at DESC LIMIT 100`,
      [vendorId],
    );
    return { items: rows };
  }

  /** One public reply per review; it can be edited. */
  @Post('reviews/:id/reply')
  async reply(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReplyDto) {
    const vendorId = await this.vendorId(auth.userId);
    const r = await this.db.one(
      this.db,
      `UPDATE reviews SET vendor_reply = $3 WHERE id = $1 AND vendor_id = $2 AND NOT is_hidden
       RETURNING id, rating, comment, vendor_reply AS "vendorReply", created_at AS "createdAt"`,
      [id, vendorId, body.reply.trim()],
    );
    if (!r) throw new AppError('NOT_FOUND', 'Review not found.', HttpStatus.NOT_FOUND);
    return r;
  }
}
