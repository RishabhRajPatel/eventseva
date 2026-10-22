import { Controller, Headers, HttpCode, HttpStatus, Inject, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { BookingsService } from '../bookings/bookings.service';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';

interface RazorpayEvent {
  event: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
}

/**
 * Razorpay calls this when a payment succeeds. It backs up the app's own "verify" call, so a
 * booking is still confirmed if the customer's phone dies right after paying.
 */
@SkipThrottle()
@Controller('v1/payments')
export class PaymentWebhookController {
  private readonly logger = new Logger('PaymentWebhook');

  constructor(
    private readonly bookings: BookingsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    if (!req.rawBody || !signature || !this.gateway.verifyWebhook(req.rawBody, signature)) {
      throw new AppError('WEBHOOK_INVALID', 'Invalid signature.', HttpStatus.UNAUTHORIZED);
    }
    const body = req.body as RazorpayEvent;
    const payment = body.payload?.payment?.entity;
    if (body.event === 'payment.captured' && payment?.id && payment.order_id) {
      const result = await this.bookings.paymentCaptured(payment.order_id, payment.id);
      this.logger.log(`${payment.order_id}: ${result}`);
    }
    // Always 200 for events we do not use, or Razorpay keeps retrying them.
    return { ok: true };
  }
}
