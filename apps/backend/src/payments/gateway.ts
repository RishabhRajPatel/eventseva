import { HttpStatus, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config';
import { AppError } from '../common/errors';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Everything the booking flow needs from a payment provider. Razorpay today; swappable later. */
export interface PaymentGateway {
  /** Public key the app passes to the checkout screen. */
  readonly keyId: string;
  createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<{ orderId: string }>;
  /** Checks the signature the checkout returns after a successful payment. */
  verifyPayment(orderId: string, paymentId: string, signature: string): boolean;
  /** Checks a webhook call really came from the provider. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
  refund(paymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ refundId: string }>;
}

const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(given ?? ''), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Razorpay Orders + Refunds over its REST API (no SDK needed). */
export class RazorpayGateway implements PaymentGateway {
  private readonly logger = new Logger('Razorpay');
  private readonly auth: string;

  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {
    this.auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  }

  private async call<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) {
      this.logger.error(`${path} failed (${res.status}): ${json.error?.description ?? 'no details'}`);
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Payment service is not responding. Please try again.', HttpStatus.BAD_GATEWAY);
    }
    return json;
  }

  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>) {
    const order = await this.call<{ id: string }>('/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
    return { orderId: order.id };
  }

  verifyPayment(orderId: string, paymentId: string, signature: string) {
    return sameHex(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return sameHex(hmacHex(this.webhookSecret, rawBody), signature);
  }

  async refund(paymentId: string, amountPaise: number, notes: Record<string, string>) {
    const refund = await this.call<{ id: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      amount: amountPaise,
      notes,
    });
    return { refundId: refund.id };
  }
}

/**
 * Development and tests: no money moves. Signatures use a fixed secret, so a test (or the
 * app's dev build) can "pay" by signing with FakeGateway.sign().
 */
export class FakeGateway implements PaymentGateway {
  static readonly SECRET = 'fake-payment-secret';
  readonly keyId = 'rzp_test_fake';
  readonly refunds: { paymentId: string; amountPaise: number }[] = [];

  static sign(orderId: string, paymentId: string) {
    return hmacHex(FakeGateway.SECRET, `${orderId}|${paymentId}`);
  }

  static signWebhook(rawBody: string) {
    return hmacHex(FakeGateway.SECRET, rawBody);
  }

  async createOrder() {
    return { orderId: `order_fake_${randomBytes(8).toString('hex')}` };
  }

  verifyPayment(orderId: string, paymentId: string, signature: string) {
    return sameHex(FakeGateway.sign(orderId, paymentId), signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return sameHex(hmacHex(FakeGateway.SECRET, rawBody), signature);
  }

  async refund(paymentId: string, amountPaise: number) {
    this.refunds.push({ paymentId, amountPaise });
    return { refundId: `rfnd_fake_${randomBytes(8).toString('hex')}` };
  }
}

export function createGateway(config: AppConfig): PaymentGateway {
  return config.paymentProvider === 'razorpay'
    ? new RazorpayGateway(config.razorpayKeyId!, config.razorpayKeySecret!, config.razorpayWebhookSecret!)
    : new FakeGateway();
}
