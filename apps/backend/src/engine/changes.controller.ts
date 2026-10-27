import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { PartnerAppGuard } from '../partner/partner.controller';
import { ChangesService } from './changes.service';

class ChangeDto {
  @IsIn(['reschedule', 'extension']) kind: 'reschedule' | 'extension';
  @IsOptional() @IsString() @MaxLength(40) startsAt?: string;
  @IsString() @MaxLength(40) endsAt: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class ReasonDto {
  @IsString() @Length(3, 300) reason: string;
}

/** Customer app: ask to move or extend a booking. */
@UseGuards(AuthGuard)
@Controller('v1/bookings/:id/changes')
export class ChangesController {
  constructor(private readonly changes: ChangesService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.changes.list(id, { customerId: auth.userId }) };
  }

  @Post()
  request(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeDto) {
    return this.changes.request(auth.userId, id, body);
  }

  @Post(':changeId/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('changeId', ParseUUIDPipe) changeId: string) {
    await this.changes.cancel(auth.userId, id, changeId);
  }
}

/** Partner app: approve or decline a requested change. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/bookings/:id/changes')
export class PartnerChangesController {
  constructor(private readonly changes: ChangesService) {}

  @Get()
  async list(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.changes.list(id, { vendorUserId: auth.userId }) };
  }

  @Post(':changeId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('changeId', ParseUUIDPipe) changeId: string) {
    await this.changes.approve(auth.userId, id, changeId);
    return { items: await this.changes.list(id, { vendorUserId: auth.userId }) };
  }

  @Post(':changeId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('changeId', ParseUUIDPipe) changeId: string, @Body() body: ReasonDto) {
    await this.changes.reject(auth.userId, id, changeId, body.reason.trim());
    return { items: await this.changes.list(id, { vendorUserId: auth.userId }) };
  }
}
