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
  /** `notes.refund_ref` is our refunds row id, so a retry can find a refund that already went through. */
  refund(paymentId: string, amountPaise: number, notes: Record<string, string>): Promise<{ refundId: string }>;
  /** The refund made earlier for this payment with `notes.refund_ref = ref`, if any. */
  findRefund(paymentId: string, ref: string): Promise<{ refundId: string } | null>;
  /** The captured payment for an order, if the customer paid (reconciliation asks when no webhook came). */
  capturedPayment(orderId: string): Promise<{ paymentId: string; amountPaise: number } | null>;
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

  private async call<T>(path: string, body?: object): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      // A hung connection must not hold a refund or order forever.
      signal: AbortSignal.timeout(15_000),
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

  async findRefund(paymentId: string, ref: string) {
    const list = await this.call<{ items: { id: string; notes?: Record<string, string> }[] }>(
      `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`,
    );
    const hit = list.items.find((r) => r.notes?.refund_ref === ref);
    return hit ? { refundId: hit.id } : null;
  }

  async capturedPayment(orderId: string) {
    const list = await this.call<{ items: { id: string; status: string; amount: number }[] }>(`/orders/${encodeURIComponent(orderId)}/payments`);
    const hit = list.items.find((p) => p.status === 'captured');
    return hit ? { paymentId: hit.id, amountPaise: hit.amount } : null;
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
  private readonly refs = new Map<string, string>();
  /** Tests: how many of the next refund calls fail. */
  failRefunds = 0;
  /** Tests: the refund goes through at the provider but the reply is lost. */
  loseNextRefundReply = false;
  /** Tests: orders the customer paid at the provider (whether or not a webhook arrived). */
  readonly captured = new Map<string, { paymentId: string; amountPaise: number }>();

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

  async refund(paymentId: string, amountPaise: number, notes: Record<string, string> = {}) {
    if (this.failRefunds > 0) {
      this.failRefunds--;
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Payment service is not responding. Please try again.', HttpStatus.BAD_GATEWAY);
    }
    this.refunds.push({ paymentId, amountPaise });
    const refundId = `rfnd_fake_${randomBytes(8).toString('hex')}`;
    if (notes.refund_ref) this.refs.set(`${paymentId}|${notes.refund_ref}`, refundId);
    if (this.loseNextRefundReply) {
      this.loseNextRefundReply = false;
      throw new Error('socket hang up');
    }
    return { refundId };
  }

  async findRefund(paymentId: string, ref: string) {
    const refundId = this.refs.get(`${paymentId}|${ref}`);
    return refundId ? { refundId } : null;
  }

  async capturedPayment(orderId: string) {
    return this.captured.get(orderId) ?? null;
  }
}

export function createGateway(config: AppConfig): PaymentGateway {
  return config.paymentProvider === 'razorpay'
    ? new RazorpayGateway(config.razorpayKeyId!, config.razorpayKeySecret!, config.razorpayWebhookSecret!)
    : new FakeGateway();
}
