import { Controller, Get, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import { AppConfig, CONFIG, loadConfig } from './config';
import { ErrorFilter } from './common/errors';
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
import { PublicReviewsController, SocialController } from './social/social.controller';
import { ChatController } from './chat/chat.controller';
import { PartnerHomeController } from './partner/partner-home.controller';
import { AdminOpsController } from './admin/admin-ops.controller';
import { MediaController } from './media/media.controller';
import { CloudinaryService } from './media/cloudinary.service';
import { ConsolePushSender, FcmPushSender, PUSH_SENDER } from './push/push-sender';
import { PushService } from './push/push.service';
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
    MediaController,
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
    CloudinaryService,
    PushService,
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
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
