import { Controller, Get, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import compression from 'compression';
import helmet from 'helmet';
import { AppConfig, CONFIG, loadConfig } from './config';
import { ErrorFilter } from './common/errors';
import { TrimBodyPipe } from './common/trim.pipe';
import { Db } from './db/db.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { ConsoleOtpSender, OTP_SENDER } from './auth/otp-sender';
import { OtpService } from './auth/otp.service';
import { TokenService } from './auth/token.service';
import { MeController } from './me/me.controller';
import { CatalogController } from './catalog/catalog.controller';
import { PartnerAppGuard, PartnerController } from './partner/partner.controller';
import { VendorsController } from './vendors/vendors.controller';
import { AdminController } from './admin/admin.controller';
import { AdminGuard } from './admin/admin-auth';
import { BookingsController } from './bookings/bookings.controller';
import { PartnerBookingsController } from './bookings/partner-bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { PaymentWebhookController } from './payments/webhook.controller';
import { RefundsService } from './payments/refunds.service';
import { PublicReviewsController, SocialController } from './social/social.controller';
import { ChatController } from './chat/chat.controller';
import { PartnerHomeController } from './partner/partner-home.controller';
import { AdminOpsController } from './admin/admin-ops.controller';
import { AdminCategoriesController } from './admin/categories.controller';
import { MediaController } from './media/media.controller';
import { CloudinaryService } from './media/cloudinary.service';
import { ConsolePushSender, FcmPushSender, PUSH_SENDER } from './push/push-sender';
import { PushService } from './push/push.service';
import { CouponsService } from './coupons/coupons.service';
import { AdminCouponsController, CouponsController } from './coupons/coupons.controller';
import { FeaturedService } from './featured/featured.service';
import { AdminFeaturedController, PartnerFeaturedController } from './featured/featured.controller';
import { AdminExtrasController } from './admin/admin-extras.controller';
import { EngineController } from './engine/engine.controller';
import { EngineCatalogService } from './engine/catalog.service';
import { AdminResourcesController, PartnerEngineCatalogController, PublicEngineServicesController } from './engine/catalog.controller';
import { EngineService } from './engine/engine.service';
import { InventoryService } from './inventory/inventory.service';
import { FulfilmentService } from './inventory/fulfilment.service';
import { AdminRentalController, PartnerInventoryController, PartnerRentalController, RentalsController } from './inventory/inventory.controller';
import { createGateway, PAYMENT_GATEWAY } from './payments/gateway';

@Controller()
class HealthController {
  constructor(private readonly db: Db) {}

  @Get('health')
  async health() {
    await this.db.query('SELECT 1');
    return { ok: true };
  }
}

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.rateLimitPerMin }],
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    CatalogController,
    PartnerController,
    VendorsController,
    AdminController,
    BookingsController,
    PartnerBookingsController,
    PaymentWebhookController,
    PublicReviewsController,
    SocialController,
    ChatController,
    PartnerHomeController,
    AdminOpsController,
    AdminCategoriesController,
    CouponsController,
    AdminCouponsController,
    PartnerFeaturedController,
    AdminFeaturedController,
    AdminExtrasController,
    MediaController,
    EngineController,
    PartnerEngineCatalogController,
    PublicEngineServicesController,
    AdminResourcesController,
    PartnerInventoryController,
    PartnerRentalController,
    RentalsController,
    AdminRentalController,
  ],
  providers: [
    { provide: OTP_SENDER, useClass: ConsoleOtpSender },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    Db,
    OtpService,
    TokenService,
    AuthGuard,
    PartnerAppGuard,
    AdminGuard,
    BookingsService,
    EngineService,
    EngineCatalogService,
    InventoryService,
    FulfilmentService,
    RefundsService,
    CloudinaryService,
    PushService,
    CouponsService,
    FeaturedService,
    {
      provide: PUSH_SENDER,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => (config.firebase ? new FcmPushSender(config.firebase) : new ConsolePushSender()),
    },
    { provide: PAYMENT_GATEWAY, inject: [CONFIG], useFactory: createGateway },
  ],
})
export class AppModule {}

/** Shared by main.ts and the tests so both run the same middleware and validation. */
export function configureApp(app: INestApplication) {
  const config = app.get<AppConfig>(CONFIG);
  // Behind a load balancer, req.ip must be the user's IP (from X-Forwarded-For), not the proxy's.
  if (config.trustProxy > 0) app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);
  app.use(helmet());
  // Personal answers (bookings, chats, phone numbers) must never sit in a shared cache or a proxy.
  // Public catalogue routes replace this with their own Cache-Control (see PublicCache).
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // gzip for JSON over ~1 KB: vendor lists and chats are 5–10× smaller on mobile data.
  app.use(compression({ threshold: 1024 }));
  app.useGlobalPipes(new TrimBodyPipe(), new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
