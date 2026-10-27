// Races the master prompt calls out: two accepts for the same slot at the same moment, a double tap
// on accept, duplicate payment webhooks, and a payment landing while the sweep expires the booking.
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('concurrency', () => {
  let t: TestApp;
  let service: BookingsService;
  let gateway: FakeGateway;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(BookingsService);
    gateway = t.app.get(PAYMENT_GATEWAY);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    serviceId = (await as(vendorToken).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [vendorId]);
  });

  const request = async (phone: string, slot = 'night') => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(20), cityId }).expect(201)).body;
    const b = (await as(token).post('/v1/bookings', { eventId: e.id, vendorId, serviceId, slot }).expect(201)).body;
    return { token, id: b.id as string };
  };

  it('two requests for the same slot accepted at the same moment: exactly one wins', async () => {
    const a = await request('9822222222', 'night');
    const b = await request('9833333333', 'full'); // full day clashes with night
    const results = await Promise.all([
      as(vendorToken).post(`/v1/partner/bookings/${a.id}/accept`),
      as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_TAKEN');
    const held = await t.db.query('SELECT booking_id FROM availability WHERE vendor_id = $1', [vendorId]);
    expect(held.rowCount).toBe(1);
  });

  it('a double tap on accept accepts once', async () => {
    const a = await request('9822222222');
    const results = await Promise.all([1, 2, 3].map(() => as(vendorToken).post(`/v1/partner/bookings/${a.id}/accept`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await t.db.query(`SELECT 1 FROM notifications WHERE kind = 'booking_accepted'`)).rowCount).toBe(1);
  });

  it('the same payment webhook delivered several times at once credits once', async () => {
    const a = await request('9822222222');
    await as(vendorToken).post(`/v1/partner/bookings/${a.id}/accept`).expect(200);
    const order = (await as(a.token).post(`/v1/bookings/${a.id}/pay`).expect(200)).body;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_dup', order_id: order.orderId, amount: order.amountPaise } } } });
    const send = () =>
      t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', FakeGateway.signWebhook(body)).send(body);
    const results = await Promise.all([send(), send(), send()]);
    results.forEach((r) => expect(r.status).toBe(200));
    expect((await t.db.query(`SELECT 1 FROM payments WHERE booking_id = $1 AND status = 'paid'`, [a.id])).rowCount).toBe(1);
    expect((await t.db.query(`SELECT 1 FROM notifications WHERE kind = 'booking_confirmed'`)).rowCount).toBe(2); // customer + vendor, once each
    expect(gateway.refunds).toEqual([]);
  });

  it('payment and expiry at the same moment: either confirmed, or expired with the money refunded, never both', async () => {
    for (let i = 0; i < 4; i++) {
      await t.reset();
      gateway.refunds.length = 0;
      vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
      const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
      vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body.id;
      serviceId = (await as(vendorToken).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
      await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [vendorId]);
      const a = await request('9822222222');
      await as(vendorToken).post(`/v1/partner/bookings/${a.id}/accept`).expect(200);
      const order = (await as(a.token).post(`/v1/bookings/${a.id}/pay`).expect(200)).body;
      await t.db.query(`UPDATE bookings SET pay_by = now() - interval '1 second' WHERE id = $1`, [a.id]);
      const [outcome] = await Promise.all([service.paymentCaptured(order.orderId, `pay_race_${i}`), service.sweep()]);
      const status = (await t.db.one<{ status: string }>(t.db, 'SELECT status FROM bookings WHERE id = $1', [a.id]))!.status;
      if (outcome === 'confirmed') {
        expect(status).toBe('confirmed');
        expect(gateway.refunds).toEqual([]);
        expect((await t.db.query('SELECT 1 FROM availability WHERE booking_id = $1', [a.id])).rowCount).toBe(1);
      } else {
        expect(outcome).toBe('refunded');
        expect(status).toBe('expired');
        expect(gateway.refunds).toEqual([{ paymentId: `pay_race_${i}`, amountPaise: order.amountPaise }]);
        expect((await t.db.query('SELECT 1 FROM availability WHERE booking_id = $1', [a.id])).rowCount).toBe(0);
      }
    }
  });
});
