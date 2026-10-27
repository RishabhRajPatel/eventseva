import { Controller, Get, Header, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { AdminGuard, AdminRoles } from '../admin/admin-auth';
import { PartnerAppGuard } from '../partner/partner.controller';
import { InvoicesService } from './invoices.service';

/** Customer app: the invoice for a confirmed booking, as data or a printable page. */
@UseGuards(AuthGuard)
@Controller('v1/bookings/:id')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoice')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id, 'customer', { customerId: auth.userId });
  }

  @Get('invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async html(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.send(this.invoices.html(await this.invoices.get(id, 'customer', { customerId: auth.userId })));
  }
}

/** Partner app: the invoice issued in the vendor's name, and EventSeva's commission invoice. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/bookings/:id')
export class PartnerInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoice')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id, 'customer', { vendorUserId: auth.userId });
  }

  @Get('commission-invoice')
  commission(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id, 'commission', { vendorUserId: auth.userId });
  }

  @Get('commission-invoice.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async commissionHtml(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res.send(this.invoices.html(await this.invoices.get(id, 'commission', { vendorUserId: auth.userId })));
  }
}

@UseGuards(AdminGuard)
@Controller('v1/admin/bookings/:id')
export class AdminInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @AdminRoles('finance', 'support')
  @Get('invoices')
  async both(@Param('id', ParseUUIDPipe) id: string) {
    return { customer: await this.invoices.get(id, 'customer', {}), commission: await this.invoices.get(id, 'commission', {}) };
  }
}
