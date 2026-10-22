import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { PAYMENT_GATEWAY, PaymentGateway } from '../payments/gateway';

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const shortDate = (d: Date, lang: 'en' | 'hi') =>
  d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

/**
 * Paid "Featured" listings: a vendor buys days at the top of search. Days stack: buying while
 * already featured adds to the end date.
 */
@Injectable()
export class FeaturedService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async startPurchase(vendorUserId: string, planId: number) {
    return this.db.tx(async (client) => {
      const v = await this.db.one<{ id: string; status: string }>(client, 'SELECT id, status FROM vendors WHERE user_id = $1', [vendorUserId]);
      if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Create your business profile first.', HttpStatus.NOT_FOUND);
      if (v.status !== 'approved') throw new AppError('VENDOR_NOT_ACTIVE', 'Your profile must be live to get featured.', HttpStatus.CONFLICT);
      const plan = await this.db.one<{ id: number; days: number; price_paise: number }>(
        client,
        'SELECT id, days, price_paise FROM featured_plans WHERE id = $1 AND is_active',
        [planId],
      );
      if (!plan) throw new AppError('PLAN_NOT_FOUND', 'This plan is not available.', HttpStatus.NOT_FOUND);
      const purchase = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO featured_purchases (vendor_id, plan_id, days, amount_paise) VALUES ($1, $2, $3, $4) RETURNING id`,
        [v.id, plan.id, plan.days, plan.price_paise],
      );
      const { orderId } = await this.gateway.createOrder(plan.price_paise, `featured-${purchase!.id.slice(0, 8)}`, {
        featuredPurchaseId: purchase!.id,
      });
      await client.query('UPDATE featured_purchases SET razorpay_order_id = $2 WHERE id = $1', [purchase!.id, orderId]);
      return { purchaseId: purchase!.id, orderId, amountPaise: plan.price_paise, currency: 'INR', keyId: this.gateway.keyId };
    });
  }

  async verify(vendorUserId: string, orderId: string, paymentId: string, signature: string) {
    if (!this.gateway.verifyPayment(orderId, paymentId, signature)) throw new AppError('PAYMENT_INVALID', 'We could not verify this payment.');
    const mine = await this.db.one(
      this.db,
      'SELECT 1 FROM featured_purchases f JOIN vendors v ON v.id = f.vendor_id WHERE f.razorpay_order_id = $1 AND v.user_id = $2',
      [orderId, vendorUserId],
    );
    if (!mine) throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found.', HttpStatus.NOT_FOUND);
    await this.captured(orderId, paymentId);
  }

  /** Development only (PAYMENT_PROVIDER=fake): completes a purchase without a checkout. */
  async devPay(vendorUserId: string, purchaseId: string) {
    if (this.config.paymentProvider !== 'fake') throw new AppError('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND);
    const p = await this.db.one<{ razorpay_order_id: string }>(
      this.db,
      'SELECT f.razorpay_order_id FROM featured_purchases f JOIN vendors v ON v.id = f.vendor_id WHERE f.id = $1 AND v.user_id = $2',
      [purchaseId, vendorUserId],
    );
    if (!p) throw new AppError('NOT_FOUND', 'Purchase not found.', HttpStatus.NOT_FOUND);
    await this.captured(p.razorpay_order_id, `pay_dev_${Date.now()}`);
  }

  /** Payment arrived (app verify or webhook). Safe to call twice. */
  async captured(orderId: string, paymentId: string): Promise<'activated' | 'already_done' | 'unknown_order'> {
    return this.db.tx(async (client) => {
      const p = await this.db.one<{ id: string; vendor_id: string; days: number; status: string; amount_paise: number }>(
        client,
        'SELECT id, vendor_id, days, status, amount_paise FROM featured_purchases WHERE razorpay_order_id = $1 FOR UPDATE',
        [orderId],
      );
      if (!p) return 'unknown_order';
      if (p.status !== 'created') return 'already_done';
      await client.query(`UPDATE featured_purchases SET status = 'paid', razorpay_payment_id = $2, paid_at = now() WHERE id = $1`, [p.id, paymentId]);
      await this.extend(client, p.vendor_id, p.id, p.days, `Payment ${rupees(p.amount_paise)} received.`);
      return 'activated';
    });
  }

  /** Admin: free featured days (launch offers, apologies). */
  async grant(adminId: string, vendorId: string, days: number, reason: string) {
    return this.db.tx(async (client) => {
      const v = await this.db.one(client, `SELECT 1 FROM vendors WHERE id = $1 AND status = 'approved'`, [vendorId]);
      if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Only live vendors can be featured.', HttpStatus.NOT_FOUND);
      const p = await this.db.one<{ id: string }>(
        client,
        `INSERT INTO featured_purchases (vendor_id, days, status, granted_by, reason) VALUES ($1, $2, 'granted', $3, $4) RETURNING id`,
        [vendorId, days, adminId, reason],
      );
      const until = await this.extend(client, vendorId, p!.id, days, reason);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'vendor.feature', 'vendor', $2, NULL, $3)`,
        [adminId, vendorId, { days, reason, until }],
      );
      return { featuredUntil: until };
    });
  }

  async stop(adminId: string, vendorId: string, reason: string) {
    await this.db.tx(async (client) => {
      const v = await this.db.one<{ featured_until: Date | null }>(client, 'SELECT featured_until FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
      if (!v) throw new AppError('VENDOR_NOT_FOUND', 'Vendor not found.', HttpStatus.NOT_FOUND);
      await client.query('UPDATE vendors SET featured_until = NULL WHERE id = $1', [vendorId]);
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'vendor.unfeature', 'vendor', $2, $3, $4)`,
        [adminId, vendorId, { featuredUntil: v.featured_until }, { featuredUntil: null, reason }],
      );
    });
  }

  private async extend(q: Queryable, vendorId: string, purchaseId: string, days: number, why: string): Promise<Date> {
    const r = await this.db.one<{ starts: Date; ends: Date; user_id: string }>(
      q,
      `UPDATE vendors SET featured_until = GREATEST(COALESCE(featured_until, now()), now()) + make_interval(days => $2)
        WHERE id = $1
        RETURNING featured_until - make_interval(days => $2) AS starts, featured_until AS ends, user_id`,
      [vendorId, days],
    );
    await q.query('UPDATE featured_purchases SET starts_at = $2, ends_at = $3 WHERE id = $1', [purchaseId, r!.starts, r!.ends]);
    await notify(q, r!.user_id, 'featured_active', {
      en: { title: 'You are featured!', body: `Your business shows at the top of search until ${shortDate(r!.ends, 'en')}. ${why}` },
      hi: { title: 'आप फ़ीचर्ड हैं!', body: `आपका बिज़नेस ${shortDate(r!.ends, 'hi')} तक सर्च में सबसे ऊपर दिखेगा।` },
    }, {}, 'partner');
    return r!.ends;
  }
}
