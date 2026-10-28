import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Auth, AuthGuard } from '../auth/auth.guard';
import type { AuthContext } from '../auth/token.service';
import { Admin, AdminContext, AdminGuard, AdminRoles } from '../admin/admin-auth';
import { PartnerAppGuard } from '../partner/partner.controller';
import { PublicCache } from '../common/cache';
import { EVENT_TYPES } from '../bookings/booking.rules';
import { EngineCatalogService, VENDOR_RESOURCE_KINDS, type VendorResourceKind } from './catalog.service';
import type { FieldDef, Pricing, RatePlan, RuleSet } from './types';

class EngineServiceDto {
  @IsString() @Length(2, 80) title: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  /** Checked against the category template on the server (model, rates, included hours / km …). */
  @IsObject() pricing: Pricing;
  @IsOptional() @IsObject() rules?: RuleSet;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() resourceId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) minGuests?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) maxGuests?: number | null;
  /** Customers may choose to pay the whole booking to you in cash. */
  @IsOptional() @IsBoolean() cashAllowed?: boolean;
  /** Your own questions for the customer (same format as the category's; checked on the server). */
  @IsOptional() @IsArray() @ArrayMaxSize(15) questions?: FieldDef[];
  /** Event types you offer this for; empty: every event. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) eventTypes?: string[];
  /** Ways to book (e.g. per hour, full night), each with its own price; empty: the price above. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) plans?: RatePlan[];
}

class UpdateEngineServiceDto {
  @IsOptional() @IsString() @Length(2, 80) title?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsObject() pricing?: Pricing;
  @IsOptional() @IsObject() rules?: RuleSet;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() resourceId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) minGuests?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(100_000) maxGuests?: number | null;
  /** Customers may choose to pay the whole booking to you in cash. */
  @IsOptional() @IsBoolean() cashAllowed?: boolean;
  /** Your own questions for the customer (same format as the category's; checked on the server). */
  @IsOptional() @IsArray() @ArrayMaxSize(15) questions?: FieldDef[];
  /** Event types you offer this for; empty: every event. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) eventTypes?: string[];
  /** Ways to book (e.g. per hour, full night), each with its own price; empty: the price above. */
  @IsOptional() @IsArray() @ArrayMaxSize(6) plans?: RatePlan[];
}

class ResourceDto {
  @IsIn(VENDOR_RESOURCE_KINDS) kind: VendorResourceKind;
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}

class UpdateResourceDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsIn(['active', 'maintenance', 'inactive']) status?: 'active' | 'maintenance' | 'inactive';
}

class ResourceQuery {
  @IsOptional() @IsIn(VENDOR_RESOURCE_KINDS) kind?: VendorResourceKind;
}

class ResourceDocumentDto {
  @IsString() @MaxLength(255) publicId: string;
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/^[0-9a-f]{40}$/i) signature: string;
  @IsIn(['vehicle_rc', 'vehicle_insurance', 'vehicle_permit', 'vehicle_puc', 'driver_licence', 'police_verification']) docType: string;
  @Matches(/^(jpg|jpeg|png|pdf)$/) format: string;
}

class AddonDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() serviceId?: string | null;
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsIn(['extra', 'decoration', 'package', 'equipment', 'trial']) kind?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) exclusions?: string[];
  @IsInt() @Min(0) @Max(10_000_000) pricePaise: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) setupMinutes?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
}

class UpdateAddonDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() serviceId?: string | null;
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsIn(['extra', 'decoration', 'package', 'equipment', 'trial']) kind?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) exclusions?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) pricePaise?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) setupMinutes?: number;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
}

class VerifyDto {
  @IsIn(['approve', 'reject', 'suspend']) decision: 'approve' | 'reject' | 'suspend';
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}

/** Partner app: services booked by time / quantity, the vehicles, drivers, staff and halls they use, and extras. */
@UseGuards(AuthGuard, PartnerAppGuard)
@Controller('v1/partner')
export class PartnerEngineCatalogController {
  constructor(private readonly catalog: EngineCatalogService) {}

  @Get('service-setup')
  setup(@Auth() auth: AuthContext) {
    return this.catalog.setup(auth.userId);
  }

  @Get('engine-services')
  async services(@Auth() auth: AuthContext) {
    return { items: await this.catalog.services(auth.userId) };
  }

  @Post('engine-services')
  createService(@Auth() auth: AuthContext, @Body() body: EngineServiceDto) {
    return this.catalog.createService(auth.userId, body);
  }

  @Patch('engine-services/:id')
  updateService(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEngineServiceDto) {
    return this.catalog.updateService(auth.userId, id, body);
  }

  /** Every change to the service's price, rules, questions, plans or event types, newest first. */
  @Get('engine-services/:id/history')
  history(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.configHistory(id, auth.userId);
  }

  @Delete('engine-services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeService(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeService(auth.userId, id);
  }

  @Get('resources')
  async resources(@Auth() auth: AuthContext, @Query() q: ResourceQuery) {
    return { items: await this.catalog.resources(auth.userId, q.kind) };
  }

  @Post('resources')
  createResource(@Auth() auth: AuthContext, @Body() body: ResourceDto) {
    return this.catalog.createResource(auth.userId, body);
  }

  @Patch('resources/:id')
  updateResource(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateResourceDto) {
    return this.catalog.updateResource(auth.userId, id, body);
  }

  @Delete('resources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeResource(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeResource(auth.userId, id);
  }

  @Post('resources/:id/documents')
  addDocument(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResourceDocumentDto) {
    return this.catalog.addResourceDocument(auth.userId, id, body);
  }

  @Get('addons')
  async addons(@Auth() auth: AuthContext) {
    return { items: await this.catalog.addons(auth.userId) };
  }

  @Post('addons')
  createAddon(@Auth() auth: AuthContext, @Body() body: AddonDto) {
    return this.catalog.createAddon(auth.userId, body);
  }

  @Patch('addons/:id')
  updateAddon(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAddonDto) {
    return this.catalog.updateAddon(auth.userId, id, body);
  }

  @Delete('addons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAddon(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeAddon(auth.userId, id);
  }
}

class AdminServicesQuery {
  @IsUUID() vendorId: string;
}

class ServiceStatusDto {
  @IsBoolean() active: boolean;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

class DayQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: YYYY-MM-DD' }) date: string;
  @IsOptional() @IsString() @MaxLength(30) planId?: string;
}

class PublicServicesQuery {
  @IsOptional() @IsIn(EVENT_TYPES) eventType?: string;
}

/** Customers: a vendor's bookable services with what the booking form needs. */
@Controller('v1/vendors')
export class PublicEngineServicesController {
  constructor(private readonly catalog: EngineCatalogService) {}

  /** One day of a service: offered or not (and why), notice, and when the car / hall / team is taken. */
  @Get(':id/engine-services/:serviceId/day')
  day(@Param('id', ParseUUIDPipe) id: string, @Param('serviceId', ParseUUIDPipe) serviceId: string, @Query() q: DayQuery) {
    return this.catalog.dayAvailability(id, serviceId, q.date, q.planId);
  }

  /** `?eventType=wedding` leaves out services the vendor does not offer for that event. */
  @PublicCache(30)
  @Get(':id/engine-services')
  services(@Param('id', ParseUUIDPipe) id: string, @Query() q: PublicServicesQuery) {
    return this.catalog.publicServices(id, q.eventType);
  }
}

/** Admin: what a vendor changed on a service (price, rules, questions, plans, event types). */
@UseGuards(AdminGuard)
@Controller('v1/admin/services')
export class AdminServiceConfigController {
  constructor(private readonly catalog: EngineCatalogService) {}

  /** `?vendorId=`: the vendor's configurable services with all their settings. */
  @AdminRoles('verifier', 'support')
  @Get()
  list(@Query() q: AdminServicesQuery) {
    return this.catalog.adminServices(q.vendorId);
  }

  @AdminRoles('verifier', 'support')
  @Get(':id/history')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.configHistory(id, null);
  }

  /** Take a service off the app (with a reason the vendor sees) or put it back. */
  @AdminRoles('verifier', 'support')
  @Patch(':id/status')
  status(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: ServiceStatusDto) {
    return this.catalog.setServiceStatus(admin.adminId, id, body.active, body.reason);
  }
}

/** Admin: checking vehicles and drivers before they can be booked. */
@UseGuards(AdminGuard)
@Controller('v1/admin/resources')
export class AdminResourcesController {
  constructor(private readonly catalog: EngineCatalogService) {}

  @AdminRoles('verifier')
  @Get('pending')
  async pending() {
    return { items: await this.catalog.pendingResources() };
  }

  @AdminRoles('verifier')
  @Get(':id/documents')
  async documents(@Param('id', ParseUUIDPipe) id: string) {
    return { items: await this.catalog.resourceDocuments(id) };
  }

  @AdminRoles('verifier')
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Admin() admin: AdminContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: VerifyDto) {
    return this.catalog.verifyResource(admin.adminId, id, body.decision, body.reason);
  }
}
