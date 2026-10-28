import { Controller, Headers, HttpCode, HttpStatus, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppError } from '../common/errors';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';
import { PaymentEventsService, RazorpayEvent } from './payment-events.service';

/**
 * Razorpay calls this when a payment succeeds or a refund settles. It backs up the app's own
 * "verify" call, so a booking is still confirmed if the customer's phone dies right after paying.
 * Each delivery is logged once by Razorpay's event id (webhook_events); repeats do nothing.
 */
@SkipThrottle()
@Controller('v1/payments')
export class PaymentWebhookController {
  constructor(
    private readonly events: PaymentEventsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
    @Headers('x-razorpay-event-id') eventId?: string,
  ) {
    if (!req.rawBody || !signature || !this.gateway.verifyWebhook(req.rawBody, signature)) {
      throw new AppError('WEBHOOK_INVALID', 'Invalid signature.', HttpStatus.UNAUTHORIZED);
    }
    // Events we do not use still get 200, or Razorpay keeps retrying them. A failure while
    // handling one answers 500, so Razorpay retries it later.
    const { duplicate } = await this.events.webhook(eventId?.slice(0, 100), req.rawBody, req.body as RazorpayEvent);
    return duplicate ? { ok: true, duplicate: true } : { ok: true };
  }
}
