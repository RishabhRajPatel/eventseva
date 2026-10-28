import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import { SignedPhotoDto } from '../media/signed-photo.dto';
import type { AuthContext } from '../auth/token.service';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { StepUp } from '../admin/admin-2fa';
import { AppError } from '../common/errors';
import { PartnerAppGuard } from '../partner/partner.controller';
import { FulfilmentService } from './fulfilment.service';
import { TripService } from '../engine/trip.service';
import { ITEM_CONDITIONS, ITEM_QUALITIES, InventoryService, RENT_PER } from './inventory.service';

const PAISE = 10_000_000;

class ItemDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000) description?: string | null;
  @IsUUID() categoryId: string;
  /** piece, set, pair, dozen, or the vendor's own word (up to 20 letters). */
  @IsOptional() @IsString() @Length(1, 20) unit?: string;
  @IsInt() @Min(100) @Max(PAISE) rentPaise: number;
  @IsOptional() @IsIn(RENT_PER) rentPer?: (typeof RENT_PER)[number];
  @IsInt() @Min(0) @Max(100_000) totalQty: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) repairQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) depositPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) damagePaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) missingPaise?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) minQty?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) maxQty?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) minDays?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(60) maxDays?: number | null;
  @IsOptional() @IsIn(ITEM_QUALITIES) quality?: (typeof ITEM_QUALITIES)[number];
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 30) qualityLabel?: string | null;
  @IsOptional() @IsIn(ITEM_CONDITIONS) condition?: (typeof ITEM_CONDITIONS)[number];
  @IsOptional() @IsObject() attributes?: Record<string, string | number | boolean>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateItemDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @Length(1, 20) unit?: string;
  @IsOptional() @IsInt() @Min(100) @Max(PAISE) rentPaise?: number;
  @IsOptional() @IsIn(RENT_PER) rentPer?: (typeof RENT_PER)[number];
  @IsOptional() @IsInt() @Min(0) @Max(100_000) totalQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) repairQty?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) depositPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) damagePaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) missingPaise?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100_000) minQty?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) maxQty?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) minDays?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(60) maxDays?: number | null;
  @IsOptional() @IsIn(ITEM_QUALITIES) quality?: (typeof ITEM_QUALITIES)[number];
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 30) qualityLabel?: string | null;
  @IsOptional() @IsIn(ITEM_CONDITIONS) condition?: (typeof ITEM_CONDITIONS)[number];
  @IsOptional() @IsObject() attributes?: Record<string, string | number | boolean>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ItemListQuery {
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

class CategoryDto {
  @IsString() @Length(2, 40) nameEn: string;
  @IsOptional() @IsString() @Length(1, 40) nameHi?: string;
}

class BlockDto {
  @IsDateString() from: string;
  @IsDateString() until: string;
  @IsInt() @Min(1) @Max(100_000) qty: number;
  @IsString() @Length(2, 200) note: string;
}

class RentalSettingsDto {
  @IsInt() @Min(0) @Max(PAISE) deliveryFeePaise: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) travelFreeKm?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) travelPerKmPaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(PAISE) minOrderPaise?: number;
  @IsOptional() @IsIn([0, 5, 12, 18, 28]) taxPercent?: 0 | 5 | 12 | 18 | 28;
  @IsOptional() @IsInt() @Min(0) @Max(240) leadTimeHours?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2880) setupMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2880) dismantleMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2880) bufferAfterMin?: number;
  @IsOptional() @IsIn(['vendor', 'auto']) approval?: 'vendor' | 'auto';
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
}

class LineQtyDto {
  @IsUUID() lineId: string;
  @IsInt() @Min(0) @Max(100_000) qty: number;
}

class StepDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineQtyDto) lines: LineQtyDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SignedPhotoDto) photos?: SignedPhotoDto[];
  @IsOptional() @Matches(/^\d{6}$/, { message: 'customerCode must be the 6 digits in the customer app' }) customerCode?: string;
}

class ReturnLineDto {
  @IsUUID() lineId: string;
  @IsInt() @Min(0) @Max(100_000) returned: number;
  @IsInt() @Min(0) @Max(100_000) damaged: number;
  @IsInt() @Min(0) @Max(100_000) missing: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) chargePaise?: number;
}

class ReturnDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines: ReturnLineDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SignedPhotoDto) photos?: SignedPhotoDto[];
  @IsOptional() @Matches(/^\d{6}$/, { message: 'customerCode must be the 6 digits in the customer app' }) customerCode?: string;
}

class LoadDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LineQtyDto) lines: LineQtyDto[];
}

class CatalogueQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() until?: string;
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

class ChargeAnswerDto {
  @IsIn(['accept', 'dispute']) decision: 'accept' | 'dispute';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ResolveChargeDto {
  @IsInt() @Min(0) @Max(100_000_000) amountPaise: number;
  @IsString() @Length(3, 300) note: string;
}

const time = (v: string, field: string) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !/[zZ]|[+-]\d\d:?\d\d$/.test(v)) throw new AppError('VALIDATION', `${field} needs a date, time and time zone.`, HttpStatus.BAD_REQUEST, { field });
  return d;
};

/** Partner app: the vendor's own rental items, categories, date blocks and rental settings. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private vendor(auth: AuthContext) {
    return this.inventory.vendorOf(auth.userId);
  }

  @Get('item-categories')
  async categories(@Auth() auth: AuthContext) {
    return { items: await this.inventory.categories(await this.vendor(auth)) };
  }

  @Post('item-categories')
  async addCategory(@Auth() auth: AuthContext, @Body() body: CategoryDto) {
    return this.inventory.addCategory(await this.vendor(auth), body.nameEn, body.nameHi);
  }

  @Delete('item-categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.inventory.removeCategory(await this.vendor(auth), id);
  }

  @Get('inventory')
  async list(@Auth() auth: AuthContext, @Query() query: ItemListQuery) {
    return { items: await this.inventory.list(await this.vendor(auth), query) };
  }

  @Post('inventory')
  async create(@Auth() auth: AuthContext, @Body() body: ItemDto) {
    return this.inventory.create(await this.vendor(auth), body);
  }

  @Get('inventory/:id')
  async get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.get(await this.vendor(auth), id);
  }

  @Patch('inventory/:id')
  async update(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateItemDto) {
    return this.inventory.update(await this.vendor(auth), id, body, auth.userId);
  }

  /** Deletes, or archives an item that bookings or stock records point to (the app asks first). */
  @Delete('inventory/:id')
  @HttpCode(HttpStatus.OK)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.remove(await this.vendor(auth), id);
  }

  @Get('inventory/:id/movements')
  async movements(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.inventory.movements(await this.vendor(auth), id) };
  }

  @Get('inventory/:id/blocks')
  async blocks(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.inventory.blocks(await this.vendor(auth), id) };
  }

  @Post('inventory/:id/blocks')
  async addBlock(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: BlockDto) {
    return this.inventory.addBlock(await this.vendor(auth), id, { from: time(body.from, 'from'), until: time(body.until, 'until'), qty: body.qty, note: body.note });
  }

  @Delete('inventory/:id/blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBlock(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('blockId', ParseUUIDPipe) blockId: string) {
    await this.inventory.removeBlock(await this.vendor(auth), id, blockId);
  }

  @Get('rental-settings')
  async settings(@Auth() auth: AuthContext) {
    return this.inventory.settings(await this.vendor(auth));
  }

  @Put('rental-settings')
  async saveSettings(@Auth() auth: AuthContext, @Body() body: RentalSettingsDto) {
    return this.inventory.saveSettings(await this.vendor(auth), body);
  }
}

/** Partner app: preparing, dispatching, delivering and taking back a rental order. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner/bookings/:id/rental')
export class PartnerRentalController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.fulfilment.view(id, { vendorUserId: auth.userId });
  }

  @Post('prepare')
  @HttpCode(HttpStatus.OK)
  async prepare(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.fulfilment.prepare(auth.userId, id);
    return this.get(auth, id);
  }

  @Post('load')
  @HttpCode(HttpStatus.OK)
  async load(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: LoadDto) {
    await this.fulfilment.load(auth.userId, id, body.lines);
    return this.get(auth, id);
  }

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  async dispatch(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: StepDto) {
    await this.fulfilment.dispatch(auth.userId, id, body.lines, body);
    return this.get(auth, id);
  }

  @Post('deliver')
  @HttpCode(HttpStatus.OK)
  async deliver(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: StepDto) {
    await this.fulfilment.deliver(auth.userId, id, body.lines, body);
    return this.get(auth, id);
  }

  @Post('return')
  @HttpCode(HttpStatus.OK)
  async recordReturn(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReturnDto) {
    await this.fulfilment.recordReturn(auth.userId, id, body.lines, body);
    return this.get(auth, id);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.fulfilment.verifyReturn(auth.userId, id);
    return this.get(auth, id);
  }
}

/** Customers: what a vendor rents out (public), and their own rental booking's items and charges. */
@Controller('v1')
export class RentalsController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly fulfilment: FulfilmentService,
    private readonly trips: TripService,
  ) {}

  @Get('vendors/:id/rentals')
  catalogue(@Param('id', ParseUUIDPipe) id: string, @Query() q: CatalogueQuery) {
    if ((q.from === undefined) !== (q.until === undefined)) throw new AppError('VALIDATION', 'Send from and until together.');
    return this.inventory.catalogue(id, {
      from: q.from ? time(q.from, 'from') : undefined,
      until: q.until ? time(q.until, 'until') : undefined,
      q: q.q?.trim() || undefined,
      categoryId: q.categoryId,
    });
  }

  @UseGuards(AuthGuard)
  @Get('bookings/:id/rental')
  rental(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.fulfilment.view(id, { customerId: auth.userId });
  }

  @UseGuards(AuthGuard)
  @Post('bookings/:id/charges/:chargeId')
  @HttpCode(HttpStatus.OK)
  async answer(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('chargeId', ParseUUIDPipe) chargeId: string, @Body() body: ChargeAnswerDto) {
    const type = await this.fulfilment.answerCharge(auth.userId, id, chargeId, body.decision, body.note);
    return type === 'rental' ? this.fulfilment.view(id, { customerId: auth.userId }) : this.trips.view(id, { customerId: auth.userId });
  }
}

/** Admin: a decision on a disputed damage / missing-item charge. */
@UseGuards(AdminGuard)
@Controller('v1/admin/bookings/:id')
export class AdminRentalController {
  constructor(
    private readonly fulfilment: FulfilmentService,
    private readonly trips: TripService,
  ) {}

  @Get('rental')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fulfilment.view(id, {});
  }

  @Get('trip')
  trip(@Param('id', ParseUUIDPipe) id: string) {
    return this.trips.view(id, {});
  }

  @AdminRoles('support', 'finance')
  @StepUp()
  @Post('charges/:chargeId/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Param('chargeId', ParseUUIDPipe) chargeId: string, @Body() body: ResolveChargeDto) {
    await this.fulfilment.resolveCharge(admin.adminId, id, chargeId, body.amountPaise, body.note.trim());
    return { id: chargeId, resolved: true };
  }
}
