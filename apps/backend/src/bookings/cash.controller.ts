import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { StepUp } from '../admin/admin-2fa';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { PartnerAppGuard } from '../partner/partner.controller';
import { CASH_KINDS, CashService, type CashKind } from './cash.service';

class CashDto {
  @IsIn(CASH_KINDS) kind: CashKind;
  @IsInt() @Min(100) @Max(100_000_000) amountPaise: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class DuesQuery {
  @IsOptional() @IsIn(['open', 'settled', 'waived']) status?: string;
}

class SettleDto {
  @IsString() @Length(3, 200) reference: string;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** The cash summary of a booking for one of its two sides (404 for anyone else). */
async function cashFor(db: Db, cash: CashService, bookingId: string, where: string, userId: string) {
  const b = await db.one<{ pay_mode: string; amount_paise: number; deposit_paise: number }>(
    db,
    `SELECT b.pay_mode, b.amount_paise, b.deposit_paise FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND ${where} = $2`,
    [bookingId, userId],
  );
  if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
  return { payMode: b.pay_mode, amountPaise: b.amount_paise, depositPaise: b.deposit_paise, ...(await cash.summary(db, bookingId)) };
}

/** Partner app: cash taken or given back on a cash booking, and the commission owed on cash bookings. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerCashController {
  constructor(
    private readonly db: Db,
    private readonly cash: CashService,
  ) {}

  @Get('bookings/:id/cash')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return cashFor(this.db, this.cash, id, 'v.user_id', auth.userId);
  }

  @Post('bookings/:id/cash')
  @HttpCode(HttpStatus.OK)
  async record(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: CashDto) {
    await this.cash.record(auth.userId, id, body.kind, body.amountPaise, body.note);
    return this.get(auth, id);
  }

  @Get('commission-dues')
  dues(@Auth() auth: AuthContext) {
    return this.cash.vendorDues(auth.userId);
  }
}

/** Customer app: the cash the vendor recorded on the customer's booking. */
@UseGuards(AuthGuard)
@Controller('v1/bookings')
export class CustomerCashController {
  constructor(
    private readonly db: Db,
    private readonly cash: CashService,
  ) {}

  @Get(':id/cash')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return cashFor(this.db, this.cash, id, 'b.customer_id', auth.userId);
  }
}

/** Admin: commission owed by vendors on cash bookings. */
@UseGuards(AdminGuard)
@Controller('v1/admin/commission-dues')
export class AdminCashController {
  constructor(private readonly db: Db) {}

  @AdminRoles('finance')
  @Get()
  async list(@Query() q: DuesQuery) {
    const { rows } = await this.db.query(
      `SELECT d.id, d.booking_id AS "bookingId", d.vendor_id AS "vendorId", v.business_name AS "businessName", d.amount_paise AS "amountPaise",
              d.remaining_paise AS "remainingPaise", d.status, d.reference, d.created_at AS "createdAt", d.settled_at AS "settledAt"
         FROM commission_dues d JOIN vendors v ON v.id = d.vendor_id
        WHERE ($1::text IS NULL OR d.status = $1)
        ORDER BY (d.status = 'open') DESC, d.created_at LIMIT 200`,
      [q.status ?? null],
    );
    return { items: rows };
  }

  /** The vendor paid EventSeva directly (UPI or bank): finance records the reference. */
  @AdminRoles('finance')
  @StepUp()
  @Post(':id/settle')
  @HttpCode(HttpStatus.OK)
  settle(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: SettleDto) {
    return this.close(admin.adminId, id, 'settled', body.reference.trim());
  }

  @AdminRoles('finance')
  @StepUp()
  @Post(':id/waive')
  @HttpCode(HttpStatus.OK)
  waive(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: SettleDto) {
    return this.close(admin.adminId, id, 'waived', body.reference.trim());
  }

  private close(adminId: string, id: string, status: 'settled' | 'waived', reference: string) {
    return this.db.tx(async (client: Queryable) => {
      const d = await this.db.one<{ status: string; remaining_paise: number; vendor_user_id: string }>(
        client,
        `SELECT d.status, d.remaining_paise, v.user_id AS vendor_user_id FROM commission_dues d JOIN vendors v ON v.id = d.vendor_id WHERE d.id = $1 FOR UPDATE OF d`,
        [id],
      );
      if (!d) throw new AppError('NOT_FOUND', 'Due not found.', HttpStatus.NOT_FOUND);
      if (d.status !== 'open') throw new AppError('DUE_CLOSED', 'This due is already closed.', HttpStatus.CONFLICT, { status: d.status });
      await client.query(
        `UPDATE commission_dues SET status = $2, remaining_paise = 0, reference = $3, settled_by = $4, settled_at = now() WHERE id = $1`,
        [id, status, reference, adminId],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, $2, 'commission_due', $3, $4, $5)`,
        [adminId, `commission_due.${status === 'settled' ? 'settle' : 'waive'}`, id, { status: 'open', remainingPaise: d.remaining_paise }, { status, reference }],
      );
      await notify(client, d.vendor_user_id, 'commission_due_closed', {
        en: { title: status === 'settled' ? 'Commission received' : 'Commission waived', body: `${rupees(d.remaining_paise)} commission on a cash booking is ${status === 'settled' ? 'marked as paid' : 'waived'}.` },
        hi: { title: status === 'settled' ? 'कमीशन मिल गया' : 'कमीशन माफ़', body: `नकद बुकिंग का ${rupees(d.remaining_paise)} कमीशन ${status === 'settled' ? 'जमा मान लिया गया' : 'माफ़ कर दिया गया'}।` },
      }, {}, 'partner');
      return { id, status };
    });
  }
}
