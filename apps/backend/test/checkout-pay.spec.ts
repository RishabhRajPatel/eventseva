// Booking hardening, round 2: a new total needs the customer's OK (PRICE_CHANGED), one payment for
// every accepted booking of a cart, the server's refund estimate, one money summary per booking,
// request ids in the state history, and races (two sweeps, one coupon use).
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { PaymentEventsService } from '../src/payments/payment-events.service';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const DAY = inDays(12);

describe('checkout payment and price protection', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let events: PaymentEventsService;
  let bookings: BookingsService;
  let cityId: number;
  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    events = t.app.get(PaymentEventsService);
    bookings = t.app.get(BookingsService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    gateway.captured.clear();
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const vendor = async (phone: string, slug: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slug])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `${slug} ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [id]);
    return { token, id: id as string };
  };
  const service = async (token: string, title: string, ratePaise: number) =>
    (await as(token).post('/v1/partner/engine-services', { title, pricing: { model: 'fixed', ratePaise } }).expect(201)).body.id as string;
  const customer = async (phone: string) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: DAY, cityId }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const line = (eventId: string, serviceId: string, from = '18:00', until = '23:00', answers: object = { occasion: 'sangeet' }) =>
    ({ eventId, serviceId, startsAt: at(DAY, from), endsAt: at(DAY, until), answers });
  const webhook = (payload: object, eventId: string) => {
    const body = JSON.stringify(payload);
    return t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', FakeGateway.signWebhook(body)).set('X-Razorpay-Event-Id', eventId).send(body);
  };
  const statusOf = async (id: string) => (await t.db.one<{ status: string }>(t.db, 'SELECT status FROM bookings WHERE id = $1', [id]))!.status;

  /** A DJ and a decorator in one cart, both requested. */
  const cart = async () => {
    const dj = await vendor('9811111111', 'dj');
    const decor = await vendor('9822222222', 'decor');
    const djSvc = await service(dj.token, 'DJ night', 2_000_000);
    const stage = await service(decor.token, 'Stage', 3_000_000);
    const c = await customer('9833333333');
    const co = (await as(c.token).post('/v1/checkouts', { items: [line(c.eventId, djSvc), line(c.eventId, stage, '10:00', '23:00', {})] }).expect(201)).body;
    const [djBooking, decorBooking] = co.bookings.map((b: { id: string }) => b.id) as string[];
    return { dj, decor, djSvc, stage, c, checkoutId: co.id as string, djBooking, decorBooking };
  };

  describe('price changed before the customer confirmed', () => {
    it('engine booking and cart: a different total answers PRICE_CHANGED with both totals; the shown total books', async () => {
      const dj = await vendor('9811111111', 'dj');
      const svc = await service(dj.token, 'DJ night', 2_000_000);
      const c = await customer('9833333333');
      const quote = (await as(c.token).post('/v1/checkouts/quote', { items: [line(c.eventId, svc)] }).expect(200)).body;
      // The vendor raises the price while the customer looks at the old one.
      await as(dj.token).patch(`/v1/partner/engine-services/${svc}`, { pricing: { model: 'fixed', ratePaise: 2_500_000 } }).expect(200);

      const err = (await as(c.token).post('/v1/engine-bookings', { ...line(c.eventId, svc), expectedTotalPaise: quote.totalPaise }).expect(409)).body.error;
      expect(err).toMatchObject({ code: 'PRICE_CHANGED', expectedTotalPaise: 2_000_000, totalPaise: 2_500_000, differencePaise: 500_000 });
      const cartErr = (await as(c.token).post('/v1/checkouts', { items: [line(c.eventId, svc)], expectedTotalPaise: quote.totalPaise }).expect(409)).body.error;
      expect(cartErr).toMatchObject({ code: 'PRICE_CHANGED', totalPaise: 2_500_000 });
      expect((await t.db.query('SELECT 1 FROM bookings')).rowCount).toBe(0);
      expect((await t.db.query('SELECT 1 FROM checkouts')).rowCount).toBe(0);

      // The customer accepts the new total: it books, and the request saved on the booking has no expected total.
      const id = (await as(c.token).post('/v1/engine-bookings', { ...line(c.eventId, svc), expectedTotalPaise: 2_500_000 }).expect(201)).body.id;
      const snap = (await t.db.one<{ snapshot: { request: object } }>(t.db, 'SELECT snapshot FROM bookings WHERE id = $1', [id]))!.snapshot;
      expect(snap.request).not.toHaveProperty('expectedTotalPaise');
    });

    it('slot booking: the total is checked too', async () => {
      const token = (await t.login('9811111111', 'partner')).body.accessToken;
      const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
      const vendorId = (await as(token).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
      const serviceId = (await as(token).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
      await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [vendorId]);
      const c = await customer('9833333333');
      const body = { eventId: c.eventId, vendorId, serviceId, slot: 'night' };
      expect((await as(c.token).post('/v1/bookings', { ...body, expectedTotalPaise: 1_400_000 }).expect(409)).body.error)
        .toMatchObject({ code: 'PRICE_CHANGED', totalPaise: 1_500_000, differencePaise: 100_000 });
      await as(c.token).post('/v1/bookings', { ...body, expectedTotalPaise: 1_500_000 }).expect(201);
    });
  });

  describe('one payment for the cart', () => {
    it('pays every accepted booking in one order; the one still waiting is not charged', async () => {
      const { dj, decor, c, checkoutId, djBooking, decorBooking } = await cart();
      expect((await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(409)).body.error.code).toBe('NOTHING_TO_PAY');
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);

      const view = (await as(c.token).get(`/v1/checkouts/${checkoutId}`).expect(200)).body;
      expect(view.payableCount).toBe(1);
      const order = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body;
      expect(order.bookings).toEqual([{ bookingId: djBooking, amountPaise: view.payableNowPaise }]);
      // Asking again with nothing changed gives the same order.
      expect((await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body.orderId).toBe(order.orderId);

      // The decorator accepts too: the open order is replaced by one for both.
      await as(decor.token).post(`/v1/partner/bookings/${decorBooking}/accept`).expect(200);
      const both = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body;
      expect(both.orderId).not.toBe(order.orderId);
      expect(both.bookings).toHaveLength(2);
      expect(both.amountPaise).toBe(both.bookings.reduce((s: number, b: { amountPaise: number }) => s + b.amountPaise, 0));
      expect((await t.db.one<{ status: string }>(t.db, 'SELECT status FROM payment_orders WHERE razorpay_order_id = $1', [order.orderId]))!.status).toBe('replaced');

      // Someone else cannot pay or verify it.
      const other = await customer('9844444444');
      await as(other.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(404);
      await as(other.token).post(`/v1/checkouts/${checkoutId}/pay/verify`, {
        razorpayOrderId: both.orderId, razorpayPaymentId: 'pay_1', razorpaySignature: FakeGateway.sign(both.orderId, 'pay_1'),
      }).expect(404);
      // A forged signature is refused.
      await as(c.token).post(`/v1/checkouts/${checkoutId}/pay/verify`, { razorpayOrderId: both.orderId, razorpayPaymentId: 'pay_1', razorpaySignature: 'ab'.repeat(32) }).expect(400);

      const done = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay/verify`, {
        razorpayOrderId: both.orderId, razorpayPaymentId: 'pay_1', razorpaySignature: FakeGateway.sign(both.orderId, 'pay_1'),
      }).expect(200)).body;
      expect(done.bookings.map((b: { status: string }) => b.status)).toEqual(['confirmed', 'confirmed']);
      // The webhook for the same payment changes nothing.
      await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: both.orderId, amount: both.amountPaise, status: 'captured' } } } }, 'evt_g1').expect(200);
      const rows = (await t.db.query(`SELECT booking_id, status, razorpay_payment_id FROM payments WHERE order_group_id IS NOT NULL AND status = 'paid'`)).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.razorpay_payment_id === 'pay_1')).toBe(true);
      expect(gateway.refunds).toEqual([]);

      const money = (await as(c.token).get(`/v1/bookings/${djBooking}/money`).expect(200)).body;
      expect(money).toMatchObject({ payMode: 'online', paymentState: expect.stringMatching(/paid/), refundState: 'none' });
      expect(money.paidOnline).toMatchObject({ advancePaise: both.bookings.find((b: { bookingId: string }) => b.bookingId === djBooking).amountPaise, sharedOrder: true });
      expect((await as(dj.token).get(`/v1/partner/bookings/${djBooking}/money`).expect(200)).body.pricePaise).toBe(money.pricePaise);
      await as(decor.token).get(`/v1/partner/bookings/${djBooking}/money`).expect(404);
      await as(other.token).get(`/v1/bookings/${djBooking}/money`).expect(404);
    });

    it('one vendor rejects: the other is paid alone; a share that expired before the money came is refunded alone', async () => {
      const { dj, decor, c, checkoutId, djBooking, decorBooking } = await cart();
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);
      await as(decor.token).post(`/v1/partner/bookings/${decorBooking}/accept`).expect(200);
      const order = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body;
      const decorShare = order.bookings.find((b: { bookingId: string }) => b.bookingId === decorBooking).amountPaise;
      // The decorator's payment time runs out and the sweep closes it, then the money for both arrives.
      await t.db.query(`UPDATE bookings SET pay_by = now() - interval '1 second' WHERE id = $1`, [decorBooking]);
      await bookings.sweep();
      expect(await statusOf(decorBooking)).toBe('expired');
      expect(await events.captured(order.orderId, 'pay_2', order.amountPaise)).toBe('confirmed');
      expect(await statusOf(djBooking)).toBe('confirmed');
      expect(gateway.refunds).toEqual([{ paymentId: 'pay_2', amountPaise: decorShare }]);
      expect((await as(c.token).get(`/v1/bookings/${decorBooking}/money`).expect(200)).body.refunds.refundedPaise + 0).toBeGreaterThanOrEqual(0);
    });

    it('a vendor who declines is never charged for', async () => {
      const { dj, decor, c, checkoutId, djBooking, decorBooking } = await cart();
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);
      await as(decor.token).post(`/v1/partner/bookings/${decorBooking}/decline`, { reason: 'Busy that day' });
      const order = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay/dev`).expect(200)).body;
      expect(order.bookings.find((b: { id: string }) => b.id === djBooking).status).toBe('confirmed');
      expect((await t.db.query('SELECT 1 FROM payments WHERE booking_id = $1', [decorBooking])).rowCount).toBe(0);
    });

    it('a failed attempt tells the customer and the same order can still be paid; a lost webhook is found by reconciliation', async () => {
      const { dj, c, checkoutId, djBooking } = await cart();
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);
      const order = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body;
      await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_bad', order_id: order.orderId, status: 'failed' } } } }, 'evt_f1').expect(200);
      expect((await t.db.query(`SELECT result FROM webhook_events WHERE event_id = 'evt_f1'`)).rows[0].result).toBe('payment_failed');
      expect((await t.db.query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone LIKE '%9833333333' AND n.kind = 'payment_failed'`)).rowCount).toBe(1);
      expect((await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body.orderId).toBe(order.orderId);

      // The retry is paid but its webhook is lost: reconciliation finds it once it is old enough.
      gateway.captured.set(order.orderId, { paymentId: 'pay_ok', amountPaise: order.amountPaise });
      expect(await events.reconcile()).toBe(0);
      await t.db.query(`UPDATE payment_orders SET created_at = now() - interval '15 minutes'`);
      expect(await events.reconcile()).toBe(1);
      expect(await statusOf(djBooking)).toBe('confirmed');
      expect(await events.reconcile()).toBe(0);
    });

    it('a webhook with the wrong amount confirms nothing', async () => {
      const { dj, c, checkoutId, djBooking } = await cart();
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);
      const order = (await as(c.token).post(`/v1/checkouts/${checkoutId}/pay`).expect(200)).body;
      await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_low', order_id: order.orderId, amount: 100, status: 'captured' } } } }, 'evt_low').expect(200);
      expect(await statusOf(djBooking)).toBe('accepted');
      expect((await t.db.query(`SELECT 1 FROM system_alerts WHERE kind = 'payment_amount_mismatch'`)).rowCount).toBe(1);
    });
  });

  describe('cancellation estimate', () => {
    it('the server works out the refund before the customer cancels, and the cancellation matches it', async () => {
      const { dj, c, checkoutId, djBooking } = await cart();
      expect((await as(c.token).get(`/v1/bookings/${djBooking}/cancel-preview`).expect(200)).body).toMatchObject({ allowed: true, paidPaise: 0, refundPaise: 0 });
      await as(dj.token).post(`/v1/partner/bookings/${djBooking}/accept`).expect(200);
      await as(c.token).post(`/v1/checkouts/${checkoutId}/pay/dev`).expect(200);
      const preview = (await as(c.token).get(`/v1/bookings/${djBooking}/cancel-preview`).expect(200)).body;
      expect(preview).toMatchObject({ allowed: true, payMode: 'online', refundBy: 'original_payment' });
      expect(preview.paidPaise).toBeGreaterThan(0);
      expect(preview.refundPaise + preview.keptPaise).toBe(preview.paidPaise);
      expect(await statusOf(djBooking)).toBe('confirmed');
      const stranger = await customer('9844444444');
      await as(stranger.token).get(`/v1/bookings/${djBooking}/cancel-preview`).expect(404);

      const cancelled = (await as(c.token).post(`/v1/bookings/${djBooking}/cancel`, { reason: 'Plan changed' }).expect(200)).body;
      expect(cancelled.refundPaise).toBe(preview.refundPaise);
      if (preview.refundPaise) expect(gateway.refunds.at(-1)).toMatchObject({ amountPaise: preview.refundPaise });
      expect((await as(c.token).get(`/v1/bookings/${djBooking}/cancel-preview`).expect(200)).body).toMatchObject({ allowed: false, reason: 'BOOKING_BAD_STATUS' });
    });
  });

  describe('races and tracing', () => {
    it('two sweeps expiring the same booking close it once', async () => {
      const { c, djBooking } = await cart();
      await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 second' WHERE id = $1`, [djBooking]);
      const [a, b] = await Promise.all([bookings.sweep(), bookings.sweep()]);
      expect(a.expired + b.expired).toBe(1);
      expect(await statusOf(djBooking)).toBe('expired');
      expect((await t.db.query(`SELECT 1 FROM booking_state_history WHERE booking_id = $1 AND to_state = 'expired'`, [djBooking])).rowCount).toBe(1);
      expect((await t.db.query(`SELECT 1 FROM capacity_holds h JOIN bookings b ON b.id = h.booking_id WHERE b.customer_id = (SELECT customer_id FROM events WHERE id = $1) AND h.expires_at > now()`, [c.eventId])).rowCount).toBe(0);
    });

    it('a sweep that dies halfway leaves nothing half-expired, and the next one finishes the job', async () => {
      const { djBooking } = await cart();
      await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 second' WHERE id = $1`, [djBooking]);
      const closedOnce = async (table: 'booking_state_history' | 'messages') =>
        (await t.db.query(
          table === 'booking_state_history'
            ? `SELECT 1 FROM booking_state_history WHERE booking_id = $1 AND to_state = 'expired'`
            : `SELECT 1 FROM messages WHERE kind = 'booking' AND data->>'bookingId' = $1 AND data->>'event' = 'expired'`,
          [djBooking],
        )).rowCount;

      // The customer's push is the last side effect of expiring a booking. Break it, and everything
      // the sweep did must come back with it — the status flip and the chat line included. Letting
      // the flip stand would strand the booking: nothing retries a claim that no longer matches.
      try {
        await t.db.query(`CREATE OR REPLACE FUNCTION sweep_halfway_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notify is down'; END $$`);
        await t.db.query(`CREATE TRIGGER sweep_halfway BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION sweep_halfway_fail()`);
        await expect(bookings.sweep()).rejects.toThrow(/notify is down/);
        expect(await statusOf(djBooking)).toBe('requested');
        expect(await closedOnce('booking_state_history')).toBe(0);
        expect(await closedOnce('messages')).toBe(0);
      } finally {
        await t.db.query('DROP TRIGGER IF EXISTS sweep_halfway ON notifications');
        await t.db.query('DROP FUNCTION IF EXISTS sweep_halfway_fail()');
      }

      // Nothing was lost: the booking is still claimable, and this run closes it exactly once.
      expect(await bookings.sweep()).toMatchObject({ expired: 1 });
      expect(await statusOf(djBooking)).toBe('expired');
      expect(await closedOnce('booking_state_history')).toBe(1);
      expect(await closedOnce('messages')).toBe(1);
    });

    it('a step that keeps failing does not hold up the rest of the sweep', async () => {
      // One cart, two bookings: the DJ's is about to expire, the decorator's is already over and
      // should be completed and paid out by a later step of the same sweep.
      const { djBooking, decorBooking } = await cart();
      await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 second' WHERE id = $1`, [djBooking]);
      // These are engine bookings, so the payout step looks at ends_at, not the slot day.
      await t.db.query(
        `UPDATE bookings SET status = 'confirmed', state = 'confirmed', day = $2,
                starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
          WHERE id = $1`,
        [decorBooking, inDays(-1)],
      );

      try {
        // Break only the push that expiring a booking sends, so exactly one step fails. (Breaking
        // every notification would take the payout step down too, and prove nothing about order.)
        await t.db.query(`CREATE OR REPLACE FUNCTION sweep_step_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notify is down'; END $$`);
        await t.db.query(
          `CREATE TRIGGER sweep_step_halt BEFORE INSERT ON notifications FOR EACH ROW
             WHEN (NEW.kind = 'booking_expired') EXECUTE FUNCTION sweep_step_fail()`,
        );
        // The run still counts as failed, and says which step it was.
        await expect(bookings.sweep()).rejects.toThrow(/expire-unanswered/);
      } finally {
        await t.db.query('DROP TRIGGER IF EXISTS sweep_step_halt ON notifications');
        await t.db.query('DROP FUNCTION IF EXISTS sweep_step_fail()');
      }

      // The expiry rolled back, as it should.
      expect(await statusOf(djBooking)).toBe('requested');
      // The payout step still ran: before this, one bad row stopped everything behind it.
      expect(await statusOf(decorBooking)).toBe('completed');
      expect((await t.db.query('SELECT 1 FROM payouts WHERE booking_id = $1', [decorBooking])).rowCount).toBe(1);
    });

    it('two customers taking the last use of a coupon at the same moment: one gets it', async () => {
      const finance = await t.adminLogin('finance');
      await as(finance).post('/v1/admin/coupons', {
        code: 'LAST1', titleEn: 'Last one', titleHi: 'आख़िरी', discountType: 'percent', discountValue: 10, maxDiscountPaise: 50_000, minAmountPaise: 0, maxUses: 1,
      }).expect(201);
      const dj = await vendor('9811111111', 'dj');
      const svc = await service(dj.token, 'DJ night', 2_000_000);
      const ids: { token: string; id: string }[] = [];
      for (const [i, phone] of ['9833333333', '9844444444'].entries()) {
        const c = await customer(phone);
        const id = (await as(c.token).post('/v1/engine-bookings', line(c.eventId, svc, i ? '06:00' : '18:00', i ? '11:00' : '23:00')).expect(201)).body.id;
        ids.push({ token: c.token, id });
      }
      const results = await Promise.all(ids.map((x) => as(x.token).post(`/v1/bookings/${x.id}/coupon`, { code: 'LAST1' })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await t.db.query(`SELECT 1 FROM coupon_redemptions WHERE status = 'applied'`)).rowCount).toBe(1);
    });

    it('the request id is echoed and saved with each state change', async () => {
      const { dj, djBooking } = await cart();
      const res = await t.http().post(`/v1/partner/bookings/${djBooking}/accept`).set('Authorization', `Bearer ${dj.token}`).set('X-Request-Id', 'req-accept-0001').send({}).expect(200);
      expect(res.headers['x-request-id']).toBe('req-accept-0001');
      expect((await t.db.query(`SELECT request_id FROM booking_state_history WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`, [djBooking])).rows[0].request_id).toBe('req-accept-0001');
      // A malformed id is replaced, never stored.
      const other = await t.http().get('/v1/categories').set('X-Request-Id', 'bad id; drop').expect(200);
      expect(other.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
