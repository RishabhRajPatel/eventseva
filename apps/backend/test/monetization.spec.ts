import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { describeCoupon, discountFor } from '../src/coupons/coupon.rules';
import { toCsv } from '../src/admin/csv';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('coupon rules', () => {
  const pct = { discount_type: 'percent' as const, discount_value: 10, max_discount_paise: 50_000 };
  it('percent on the booking price, capped; flat in paise; never more than the advance minus ₹1', () => {
    expect(discountFor(pct, 1_500_000, 375_000)).toBe(50_000);
    expect(discountFor({ ...pct, max_discount_paise: null }, 1_500_000, 375_000)).toBe(150_000);
    expect(discountFor({ discount_type: 'flat', discount_value: 30_000, max_discount_paise: null }, 1_500_000, 375_000)).toBe(30_000);
    expect(discountFor({ discount_type: 'flat', discount_value: 999_999, max_discount_paise: null }, 100_000, 25_000)).toBe(24_900);
  });
  it('reads well in both languages', () => {
    expect(describeCoupon(pct)).toBe('10% off, up to ₹500');
    expect(describeCoupon({ discount_type: 'flat', discount_value: 30_000, max_discount_paise: null }, 'hi')).toBe('₹300 की छूट');
  });
  it('CSV: Excel-safe, Hindi-safe, formula-safe', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'राज, "DJ"', b: '=HYPERLINK("x")' }]);
    expect(csv.startsWith('﻿a,b\r\n')).toBe(true);
    expect(csv).toContain('"राज, ""DJ"""');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('coupons, featured listings, refunds, cities, audit, exports', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let bookings: BookingsService;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let serviceId: string;
  let customer: string;
  let finance: string;
  let superAdmin: string;

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    bookings = t.app.get(BookingsService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(async () => {
    await t.db.query(`DELETE FROM cities WHERE name <> 'Prayagraj'`);
    await t.app.close();
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  beforeEach(async () => {
    await t.reset();
    await t.db.query('TRUNCATE coupons, featured_purchases CASCADE');
    await t.db.query(`DELETE FROM cities WHERE name <> 'Prayagraj'`);
    gateway.refunds.length = 0;
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId }).expect(201)).body.id;
    serviceId = (await as(vendorToken).post('/v1/partner/services', { title: 'Wedding DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved'`);
    customer = (await t.login('9822222222')).body.accessToken;
    finance = await t.adminLogin('finance');
    superAdmin = await t.adminLogin('super');
  });

  async function request(token = customer, daysAhead = 30, slot = 'night') {
    const event = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(daysAhead), cityId }).expect(201)).body;
    return (await as(token).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot }).expect(201)).body.id as string;
  }

  const newCoupon = (body: object = {}) =>
    as(finance).post('/v1/admin/coupons', {
      code: 'SHAADI10', titleEn: '10% off your first booking', titleHi: 'पहली बुकिंग पर 10% छूट',
      discountType: 'percent', discountValue: 10, maxDiscountPaise: 50_000, minAmountPaise: 500_000, ...body,
    });

  describe('coupons', () => {
    it('apply → pay less online → confirmed; vendor payout unchanged; refunds use what was paid', async () => {
      const created = (await newCoupon().expect(201)).body;
      expect(created).toMatchObject({ code: 'SHAADI10', usedCount: 0, isActive: true });

      const offers = (await t.http().get('/v1/offers').set('Accept-Language', 'hi').expect(200)).body.items;
      expect(offers).toEqual([expect.objectContaining({ code: 'SHAADI10', title: 'पहली बुकिंग पर 10% छूट', summary: '10% की छूट, ज़्यादा से ज़्यादा ₹500' })]);

      const id = await request();
      const withCoupon = (await as(customer).post(`/v1/bookings/${id}/coupon`, { code: ' shaadi10 ' }).expect(200)).body;
      expect(withCoupon).toMatchObject({ advancePaise: 375_000, discountPaise: 50_000, payNowPaise: 325_000, couponCode: 'SHAADI10', amountPaise: 1_500_000 });
      const vendorView = (await as(vendorToken).get(`/v1/partner/bookings/${id}`)).body;
      expect(vendorView).toMatchObject({ payoutPaise: 225_000, couponCode: null });

      await as(vendorToken).post(`/v1/partner/bookings/${id}/accept`).expect(200);
      const order = (await as(customer).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      expect(order.amountPaise).toBe(325_000);
      await as(customer)
        .post(`/v1/bookings/${id}/pay/verify`, { razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_c1', razorpaySignature: FakeGateway.sign(order.orderId, 'pay_c1') })
        .expect(200);
      expect((await as(finance).get('/v1/admin/coupons')).body.items[0]).toMatchObject({ usedCount: 1, discountGivenPaise: 50_000 });
      expect((await as(customer).delete(`/v1/bookings/${id}/coupon`).expect(409)).body.error.code).toBe('COUPON_NOT_ALLOWED');

      // 30 days before: 90% of the ₹3,250 actually paid.
      const cancelled = (await as(customer).post(`/v1/bookings/${id}/cancel`, { reason: 'Date changed' }).expect(200)).body;
      expect(cancelled.refundPaise).toBe(292_500);
      expect(gateway.refunds.at(-1)).toMatchObject({ amountPaise: 292_500 });
    });

    it('limits: one per customer, total uses, minimum, category, first booking, dates, unknown code', async () => {
      await newCoupon({ maxUses: 2 }).expect(201);
      const a = await request(customer, 30, 'day');
      await as(customer).post(`/v1/bookings/${a}/coupon`, { code: 'SHAADI10' }).expect(200);
      const b = await request(customer, 31, 'day');
      expect((await as(customer).post(`/v1/bookings/${b}/coupon`, { code: 'SHAADI10' }).expect(409)).body.error.code).toBe('COUPON_ALREADY_USED');

      const c2 = (await t.login('9833333333')).body.accessToken;
      await as(c2).post(`/v1/bookings/${await request(c2, 32, 'day')}/coupon`, { code: 'SHAADI10' }).expect(200);
      const c3 = (await t.login('9844444444')).body.accessToken;
      const c3b = await request(c3, 33, 'day');
      expect((await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'SHAADI10' }).expect(409)).body.error.code).toBe('COUPON_USED_UP');
      expect((await t.http().get('/v1/offers')).body.items).toEqual([]);

      // Removing the coupon gives the use back.
      await as(customer).delete(`/v1/bookings/${a}/coupon`).expect(200);
      await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'SHAADI10' }).expect(200);

      expect((await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'NOPE99' }).expect(400)).body.error.code).toBe('COUPON_INVALID');
      await newCoupon({ code: 'BIG', minAmountPaise: 5_000_000 }).expect(201);
      expect((await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'BIG' }).expect(400)).body.error).toMatchObject({ code: 'COUPON_NOT_APPLICABLE', reason: 'min_amount' });
      const tent = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'tent'`)).id;
      await newCoupon({ code: 'TENT20', categoryId: tent }).expect(201);
      expect((await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'TENT20' }).expect(400)).body.error.reason).toBe('category');
      await newCoupon({ code: 'OLD', validFrom: new Date(Date.now() - 2 * 86400_000).toISOString(), validUntil: new Date(Date.now() - 86400_000).toISOString() }).expect(201);
      expect((await as(c3).post(`/v1/bookings/${c3b}/coupon`, { code: 'OLD' }).expect(400)).body.error.code).toBe('COUPON_INVALID');
    });

    it('first-booking-only coupons skip customers who already booked', async () => {
      await newCoupon({ code: 'FIRST', firstBookingOnly: true }).expect(201);
      const done = await request(customer, 20);
      await as(vendorToken).post(`/v1/partner/bookings/${done}/accept`).expect(200);
      await as(customer).post(`/v1/bookings/${done}/pay/dev`).expect(200);
      const next = await request(customer, 40);
      expect((await as(customer).post(`/v1/bookings/${next}/coupon`, { code: 'FIRST' }).expect(400)).body.error.reason).toBe('first_booking');
    });

    it('expired or rejected bookings give their coupon back', async () => {
      await newCoupon({ maxUses: 1 }).expect(201);
      const id = await request();
      await as(customer).post(`/v1/bookings/${id}/coupon`, { code: 'SHAADI10' }).expect(200);
      await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 minute'`);
      await bookings.sweep();
      const c2 = (await t.login('9833333333')).body.accessToken;
      await as(c2).post(`/v1/bookings/${await request(c2, 35)}/coupon`, { code: 'SHAADI10' }).expect(200);
    });

    it('changing the coupon after checkout opened makes a new order; the old order, if paid, is refunded', async () => {
      await newCoupon().expect(201);
      const id = await request();
      await as(vendorToken).post(`/v1/partner/bookings/${id}/accept`).expect(200);
      const first = (await as(customer).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      expect(first.amountPaise).toBe(375_000);
      await as(customer).post(`/v1/bookings/${id}/coupon`, { code: 'SHAADI10' }).expect(200);
      const second = (await as(customer).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      expect(second).toMatchObject({ amountPaise: 325_000 });
      expect(second.orderId).not.toBe(first.orderId);

      expect(await bookings.paymentCaptured(first.orderId, 'pay_old')).toBe('refunded');
      expect(gateway.refunds).toEqual([{ paymentId: 'pay_old', amountPaise: 375_000 }]);
      expect(await bookings.paymentCaptured(second.orderId, 'pay_new')).toBe('confirmed');
      expect((await as(customer).get(`/v1/bookings/${id}`)).body).toMatchObject({ status: 'confirmed', refundPaise: 0 });
    });

    it('only finance and super manage coupons; codes are unique', async () => {
      const support = await t.adminLogin('support');
      await as(support).get('/v1/admin/coupons').expect(403);
      await newCoupon().expect(201);
      expect((await newCoupon({ code: 'shaadi10' }).expect(409)).body.error.code).toBe('COUPON_EXISTS');
      await newCoupon({ code: 'P200', discountValue: 200 }).expect(400);
      const c = (await as(finance).get('/v1/admin/coupons')).body.items[0];
      await as(finance).patch(`/v1/admin/coupons/${c.id}`, { isActive: false }).expect(200);
      expect((await t.http().get('/v1/offers')).body.items).toEqual([]);
    });
  });

  describe('featured listings', () => {
    it('vendor buys a plan; days stack; webhook works too; customers see them first; dashboard counts it', async () => {
      const ov = (await as(vendorToken).get('/v1/partner/featured').expect(200)).body;
      expect(ov).toMatchObject({ featuredUntil: null, canBuy: true });
      expect(ov.plans.map((p: { days: number; pricePaise: number }) => [p.days, p.pricePaise])).toEqual([[7, 49_900], [30, 149_900]]);

      const week = ov.plans[0];
      const order = (await as(vendorToken).post(`/v1/partner/featured/plans/${week.id}/order`).expect(200)).body;
      expect(order).toMatchObject({ amountPaise: 49_900, currency: 'INR' });
      const after = (await as(vendorToken)
        .post('/v1/partner/featured/verify', { razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_f1', razorpaySignature: FakeGateway.sign(order.orderId, 'pay_f1') })
        .expect(200)).body;
      const until1 = new Date(after.featuredUntil).getTime();
      expect(until1 - Date.now()).toBeGreaterThan(6.9 * 86400_000);

      // Second purchase through the webhook adds 30 days on top.
      const month = (await as(vendorToken).post(`/v1/partner/featured/plans/${ov.plans[1].id}/order`).expect(200)).body;
      const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_f2', order_id: month.orderId } } } });
      await t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', FakeGateway.signWebhook(body)).send(body).expect(200);
      const until2 = new Date((await as(vendorToken).get('/v1/partner/featured')).body.featuredUntil).getTime();
      expect(Math.round((until2 - until1) / 86400_000)).toBe(30);

      expect((await t.http().get('/v1/vendors')).body.items[0]).toMatchObject({ id: vendorId, isFeatured: true });
      expect((await as(vendorToken).get('/v1/notifications')).body.items[0]).toMatchObject({ kind: 'featured_active' });
      const dash = (await as(superAdmin).get('/v1/admin/dashboard')).body;
      expect(dash).toMatchObject({ monthFeaturedPaise: 199_800, featuredVendors: 1 });
      expect((await as(finance).get('/v1/admin/featured-purchases')).body.items).toHaveLength(2);
    });

    it('only live vendors can buy; admin can grant free days, stop featuring, and change plans', async () => {
      await t.db.query(`UPDATE vendors SET status = 'on_hold'`);
      const plans = (await as(vendorToken).get('/v1/partner/featured')).body.plans;
      expect((await as(vendorToken).post(`/v1/partner/featured/plans/${plans[0].id}/order`).expect(409)).body.error.code).toBe('VENDOR_NOT_ACTIVE');
      await t.db.query(`UPDATE vendors SET status = 'approved'`);

      await as(finance).post(`/v1/admin/vendors/${vendorId}/feature`, { days: 3, reason: 'Launch offer' }).expect(403);
      const g = (await as(superAdmin).post(`/v1/admin/vendors/${vendorId}/feature`, { days: 3, reason: 'Launch offer' }).expect(200)).body;
      expect(new Date(g.featuredUntil).getTime() - Date.now()).toBeGreaterThan(2.9 * 86400_000);
      await as(superAdmin).post(`/v1/admin/vendors/${vendorId}/unfeature`, { reason: 'Complaint' }).expect(200);
      expect((await t.http().get('/v1/vendors')).body.items[0].isFeatured).toBe(false);

      const plan = (await as(superAdmin).post('/v1/admin/featured-plans', { nameEn: '3 days', nameHi: '3 दिन', days: 3, pricePaise: 19_900 }).expect(201)).body;
      await as(superAdmin).patch(`/v1/admin/featured-plans/${plan.id}`, { pricePaise: 24_900 }).expect(200);
      await as(superAdmin).patch(`/v1/admin/featured-plans/${plans[0].id}`, { isActive: false }).expect(200);
      const now = (await as(vendorToken).get('/v1/partner/featured')).body.plans;
      expect(now.map((p: { days: number; pricePaise: number }) => [p.days, p.pricePaise])).toEqual([[30, 149_900], [3, 24_900]]);
    });
  });

  describe('admin partial refund', () => {
    async function paid() {
      const id = await request(customer, 2);
      await as(vendorToken).post(`/v1/partner/bookings/${id}/accept`).expect(200);
      await as(customer).post(`/v1/bookings/${id}/pay/dev`).expect(200);
      return id;
    }

    it('any amount up to what is left; EventSeva pays by default', async () => {
      const id = await paid();
      await as(superAdmin).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 100_000, reason: 'Vendor came late' }).expect(200);
      expect((await as(customer).get(`/v1/bookings/${id}`)).body.refundPaise).toBe(100_000);
      const tooMuch = await as(finance).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 300_000, reason: 'Again please' }).expect(400);
      expect(tooMuch.body.error).toMatchObject({ code: 'REFUND_TOO_HIGH', maxPaise: 275_000 });
      expect((await as(customer).get('/v1/notifications')).body.items[0]).toMatchObject({ kind: 'payment_refunded', title: 'Refund on its way' });
      const support = await t.adminLogin('support');
      await as(support).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 100, reason: 'test test' }).expect(403);
    });

    it('from the vendor payout: before and after the payout is scheduled, never once paid', async () => {
      const id = await paid();
      await as(finance).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 50_000, reason: 'Late by 2 hours', fromVendorPayout: true }).expect(200);
      expect((await as(vendorToken).get(`/v1/partner/bookings/${id}`)).body).toMatchObject({ payoutPaise: 175_000, payoutDeductionPaise: 50_000 });

      await t.db.query(`UPDATE bookings SET day = $1`, [inDays(-1)]);
      await bookings.sweep();
      const payout = await t.db.one(t.db, 'SELECT id, amount_paise FROM payouts');
      expect(payout.amount_paise).toBe(175_000);

      await as(finance).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 25_000, reason: 'Missing lights', fromVendorPayout: true }).expect(200);
      expect((await t.db.one(t.db, 'SELECT amount_paise FROM payouts')).amount_paise).toBe(150_000);
      expect((await as(vendorToken).get('/v1/notifications')).body.items[0]).toMatchObject({ kind: 'payout_adjusted' });

      await as(finance).post(`/v1/admin/payouts/${payout.id}/mark-paid`, { reference: 'UTR998877' }).expect(200);
      const late = await as(finance).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 10_000, reason: 'Too late now', fromVendorPayout: true }).expect(409);
      expect(late.body.error.code).toBe('PAYOUT_ALREADY_PAID');
      expect((await t.db.query(`SELECT action FROM admin_audit_log WHERE action = 'booking.refund'`)).rows).toHaveLength(2);
    });

    it('nothing to refund before payment', async () => {
      const id = await request();
      expect((await as(finance).post(`/v1/admin/bookings/${id}/refund`, { amountPaise: 1000, reason: 'Goodwill' }).expect(409)).body.error.code).toBe('NOTHING_TO_REFUND');
    });
  });

  describe('cities', () => {
    it('new cities start hidden; Hindi names; at least one city stays open', async () => {
      await as(finance).get('/v1/admin/cities').expect(403);
      const c = (await as(superAdmin).post('/v1/admin/cities', { name: 'Varanasi', nameHi: 'वाराणसी', state: 'Uttar Pradesh' }).expect(201)).body;
      expect(c.isActive).toBe(false);
      expect((await as(superAdmin).post('/v1/admin/cities', { name: 'varanasi', nameHi: 'x y', state: 'UP' }).expect(409)).body.error.code).toBe('CITY_EXISTS');
      expect((await t.http().get('/v1/cities')).body.items.map((x: { name: string }) => x.name)).toEqual(['Prayagraj']);
      await as(superAdmin).patch(`/v1/admin/cities/${c.id}`, { isActive: true }).expect(200);
      expect((await t.http().get('/v1/cities').set('Accept-Language', 'hi')).body.items.map((x: { name: string }) => x.name)).toEqual(['प्रयागराज', 'वाराणसी']);
      await as(superAdmin).patch(`/v1/admin/cities/${c.id}`, { isActive: false }).expect(200);
      expect((await as(superAdmin).patch(`/v1/admin/cities/${cityId}`, { isActive: false }).expect(409)).body.error.code).toBe('LAST_CITY');
    });
  });

  describe('audit log and CSV', () => {
    it('audit log lists who did what, filterable; super only', async () => {
      await newCoupon().expect(201);
      await as(superAdmin).post('/v1/admin/cities', { name: 'Kanpur', nameHi: 'कानपुर', state: 'Uttar Pradesh' }).expect(201);
      const all = (await as(superAdmin).get('/v1/admin/audit').expect(200)).body;
      expect(all.items.map((i: { action: string }) => i.action)).toEqual(['city.create', 'coupon.create']);
      expect(all.items[1]).toMatchObject({ adminEmail: 'finance@eventseva.test', adminRole: 'finance', targetType: 'coupon' });
      const only = (await as(superAdmin).get('/v1/admin/audit?action=coupon').expect(200)).body.items;
      expect(only).toHaveLength(1);
      await as(finance).get('/v1/admin/audit').expect(403);
    });

    it('downloads bookings as CSV with the right columns, dates and roles', async () => {
      await t.db.query(`UPDATE users SET name = '=cmd|calc' WHERE phone = '+919822222222'`);
      await request(customer, 10);
      const res = await as(finance).get(`/v1/admin/export/bookings?from=${inDays(9)}&to=${inDays(11)}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toContain(`eventseva-bookings-from-${inDays(9)}-to-${inDays(11)}.csv`);
      const lines = res.text.replace('﻿', '').trim().split('\r\n');
      expect(lines[0].startsWith('booking_id,created_at,event_day')).toBe(true);
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(`'=cmd|calc`);
      expect(lines[1]).toContain('15000');
      expect((await as(finance).get(`/v1/admin/export/bookings?from=${inDays(20)}`).expect(200)).text.trim().split('\r\n')).toHaveLength(1);

      const support = await t.adminLogin('support');
      await as(support).get('/v1/admin/export/payouts').expect(403);
      await as(support).get('/v1/admin/export/users').expect(200);
      await as(superAdmin).get('/v1/admin/export/nothing').expect(404);
    });
  });
});
