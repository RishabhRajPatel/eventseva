import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { todayIst } from '../bookings/booking.rules';
import { PartnerAppGuard } from './partner.controller';

class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must look like 2026-11' }) month?: string;
}

class ReplyDto {
  @IsString() @Length(2, 1000) reply: string;
}

/** Partner app home ("Aaj"), earnings ("Kamai") and replies to reviews. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerHomeController {
  constructor(private readonly db: Db) {}

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
