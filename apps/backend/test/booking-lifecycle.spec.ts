// Production hardening of the booking flow: the database state machine and its history, the
// payment webhook log (duplicates, amounts, status), reconciliation of lost webhooks, the
// customer's handover code, and evidence before an admin keeps money for damage.
import { todayIst } from '../src/bookings/booking.rules';
import { signParams } from '../src/media/cloudinary.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { PaymentEventsService } from '../src/payments/payment-events.service';
import { HandoverCodes } from '../src/engine/handover-code';
import { createTestApp, TestApp } from './helpers';

const SECRET = 'test-secret';
const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const route = { pickup: { address: 'Civil Lines', lat: 25.45, lng: 81.85 }, destination: { address: 'Jhunsi', lat: 25.43, lng: 81.91 } };
const PRICING = { model: 'fixed', ratePaise: 1_100_000, includedHours: 8, includedKm: 80, extraKmPaise: 2_500, overtimeHourPaise: 50_000, driverDayPaise: 50_000 };

describe('booking lifecycle (production hardening)', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let events: PaymentEventsService;
  let codes: HandoverCodes;
  let cityId: number;
  let vendor: { token: string; id: string };
  let driver: string;
  let service: string;
  let admin: string;

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const doc = (name: string) => {
    const publicId = `eventseva/vendors/${vendor.id}/docs/${name}`;
    return { publicId, version: 1, signature: signParams({ public_id: publicId, version: 1 }, SECRET), format: 'pdf' };
  };
  const webhook = (payload: object, eventId?: string) => {
    const body = JSON.stringify(payload);
    const req = t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', FakeGateway.signWebhook(body));
    return (eventId ? req.set('X-Razorpay-Event-Id', eventId) : req).send(body);
  };
  const history = async (id: string) =>
    (await t.db.query(`SELECT from_state, to_state, actor_kind, reason FROM booking_state_history WHERE booking_id = $1 ORDER BY id`, [id])).rows;

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    events = t.app.get(PaymentEventsService);
    codes = t.app.get(HandoverCodes);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    gateway.captured.clear();
    admin = await t.adminLogin('super');
    const token = (await t.login('9811111111', 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'car'`)).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: 'Royal Cars', categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.44, lng = 81.84 WHERE id = $1`, [id]);
    vendor = { token, id };
    const mk = async (body: object) => (await as(token).post('/v1/partner/resources', body).expect(201)).body.id as string;
    const car = await mk({ kind: 'vehicle', name: 'White Audi A6', attributes: { registration: 'UP70AB1234', make: 'Audi', model: 'A6', seats: 4, with_driver: true } });
    driver = await mk({ kind: 'driver', name: 'Ramesh', attributes: { licence_last4: '1111', licence_expires: '2032-01-01' } });
    for (const [r, docs] of [[car, ['vehicle_rc', 'vehicle_insurance']], [driver, ['driver_licence']]] as const) {
      for (const d of docs) await as(token).post(`/v1/partner/resources/${r}/documents`, { ...doc(`${r}-${d}`), docType: d }).expect(201);
      await as(admin).post(`/v1/admin/resources/${r}/verify`, { decision: 'approve' }).expect(200);
    }
    service = (await as(token).post('/v1/partner/engine-services', { title: 'Dulha car', pricing: PRICING, resourceId: car }).expect(201)).body.id;
  });

  const customer = async (phone = '9833333333') => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(12), cityId }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const request = async (c: { token: string; eventId: string }, day = inDays(12)) =>
    (await as(c.token).post('/v1/engine-bookings', { eventId: c.eventId, serviceId: service, startsAt: at(day, '16:00'), endsAt: at(day, '23:00'), route, mode: 'with_driver' }).expect(201)).body.id as string;
  const accepted = async () => {
    const c = await customer();
    const id = await request(c);
    await as(vendor.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    return { c, id };
  };
  /** A confirmed trip starting within the hour, with the driver assigned. */
  const readyTrip = async () => {
    const { c, id } = await accepted();
    await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: driver }).expect(200);
    await t.db.query(`UPDATE bookings SET starts_at = now() + interval '1 hour', ends_at = now() + interval '8 hours' WHERE id = $1`, [id]);
    return { c, id };
  };

  describe('state machine', () => {
    it('moves request → payment → confirmed → trip → completed, recording who moved it', async () => {
      const { c, id } = await accepted();
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.state).toBe('awaiting_payment');
      await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: driver }).expect(200);
      await t.db.query(`UPDATE bookings SET starts_at = now() + interval '1 hour', ends_at = now() + interval '8 hours' WHERE id = $1`, [id]);
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8 }).expect(200);
      expect((await as(vendor.token).get(`/v1/partner/bookings/${id}`).expect(200)).body.state).toBe('in_progress');
      await t.db.query(`UPDATE bookings SET starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1050, fuelEighths: 8 }).expect(200);

      const moves = await history(id);
      expect(moves.map((m) => [m.from_state, m.to_state, m.actor_kind])).toEqual([
        [null, 'pending_vendor', 'customer'],
        ['pending_vendor', 'awaiting_payment', 'vendor'],
        ['awaiting_payment', 'confirmed', 'customer'],
        ['confirmed', 'in_progress', 'vendor'],
        ['in_progress', 'return_pending', 'vendor'],
      ]);
      const detail = (await as(admin).get(`/v1/admin/bookings/${id}`).expect(200)).body;
      expect(detail.state).toBe('return_pending');
      expect(detail.history).toHaveLength(5);
      expect(detail.history[1]).toMatchObject({ from: 'pending_vendor', to: 'awaiting_payment', actorKind: 'vendor', actorId: expect.any(String) });
    });

    it('the database refuses a move the state machine does not allow, from any code path', async () => {
      const { c, id } = await accepted();
      await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
      await expect(t.db.query(`UPDATE bookings SET status = 'requested' WHERE id = $1`, [id])).rejects.toMatchObject({ constraint: 'booking_state_move' });
      await expect(t.db.query(`UPDATE bookings SET status = 'expired' WHERE id = $1`, [id])).rejects.toMatchObject({ constraint: 'booking_state_move' });
      await t.db.query(`UPDATE bookings SET status = 'completed' WHERE id = $1`, [id]);
      await expect(t.db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [id])).rejects.toMatchObject({ constraint: 'booking_state_move' });
      // Expired is final too.
      const other = await customer('9844444444');
      const id2 = await request(other, inDays(13));
      await t.db.query(`UPDATE bookings SET status = 'expired', cancel_reason = 'No reply' WHERE id = $1`, [id2]);
      await expect(t.db.query(`UPDATE bookings SET status = 'accepted' WHERE id = $1`, [id2])).rejects.toMatchObject({ constraint: 'booking_state_move' });
      expect((await history(id2)).at(-1)).toMatchObject({ to_state: 'expired', actor_kind: 'system', reason: 'No reply' });
    });

    it('a disputed charge puts the booking in "disputed" until an admin decides it', async () => {
      const { c, id } = await readyTrip();
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8 }).expect(200);
      await t.db.query(`UPDATE bookings SET starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      const trip = (await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1000, fuelEighths: 8, tollsPaise: 20_000 }).expect(200)).body;
      const toll = trip.charges.find((x: { kind: string }) => x.kind === 'toll');
      await as(c.token).post(`/v1/bookings/${id}/charges/${toll.id}`, { decision: 'dispute', note: 'No toll on this road' }).expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.state).toBe('disputed');
      await as(admin).post(`/v1/admin/bookings/${id}/charges/${toll.id}/resolve`, { amountPaise: 0, note: 'No toll receipt' }).expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.state).not.toBe('disputed');
      expect((await history(id)).map((m) => m.to_state)).toContain('disputed');
    });
  });

  describe('payment webhooks', () => {
    it('logs each event once: a repeat is answered without running again', async () => {
      const { c, id } = await accepted();
      const order = (await as(c.token).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      const ev = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: order.orderId, amount: order.amountPaise, status: 'captured' } } } };
      expect((await webhook(ev, 'evt_1').expect(200)).body).toEqual({ ok: true });
      expect((await webhook(ev, 'evt_1').expect(200)).body).toEqual({ ok: true, duplicate: true });
      const rows = (await t.db.query(`SELECT status, result, attempts FROM webhook_events WHERE event_id = 'evt_1'`)).rows;
      expect(rows).toEqual([{ status: 'processed', result: 'confirmed', attempts: 1 }]);
      // Only ids, amounts and statuses are kept; Razorpay's customer details are dropped.
      await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_none', amount: 1, status: 'captured', email: 'a@b.in', contact: '+919800000000', card: { last4: '1111' } } } } }, 'evt_pii').expect(200);
      const kept = (await t.db.query(`SELECT payload FROM webhook_events WHERE event_id = 'evt_pii'`)).rows[0].payload;
      expect(JSON.stringify(kept)).not.toMatch(/a@b\.in|9800000000|1111/);
      expect(kept.payload.payment.entity).toEqual({ id: 'pay_x', order_id: 'order_none', amount: 1, status: 'captured' });
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.state).toBe('confirmed');
      expect((await history(id)).at(-1)).toMatchObject({ to_state: 'confirmed', actor_kind: 'gateway' });
      // Events we do not use are logged as ignored.
      await webhook({ event: 'order.paid', payload: {} }, 'evt_2').expect(200);
      expect((await t.db.query(`SELECT status FROM webhook_events WHERE event_id = 'evt_2'`)).rows[0].status).toBe('ignored');
    });

    it('never confirms a wrong amount or a payment that is not captured', async () => {
      const { c, id } = await accepted();
      const order = (await as(c.token).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      const entity = { id: 'pay_2', order_id: order.orderId, amount: order.amountPaise };
      await webhook({ event: 'payment.captured', payload: { payment: { entity: { ...entity, amount: 100 } } } }, 'evt_low').expect(200);
      await webhook({ event: 'payment.captured', payload: { payment: { entity: { ...entity, status: 'failed' } } } }, 'evt_failed').expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('accepted');
      expect((await t.db.query(`SELECT result FROM webhook_events ORDER BY id`)).rows.map((r) => r.result)).toEqual(['amount_mismatch', 'not_captured']);
      expect((await t.db.query(`SELECT 1 FROM system_alerts WHERE kind = 'payment_amount_mismatch'`)).rowCount).toBe(1);
      // A forged webhook is refused before anything is logged.
      await t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', '00'.repeat(32)).send({ event: 'payment.captured' }).expect(401);
      expect((await t.db.query(`SELECT 1 FROM webhook_events`)).rowCount).toBe(2);
      // Finance sees both problems, with the order and booking; support cannot open the list.
      const problems = (await as(admin).get('/v1/admin/payment-events?status=problems').expect(200)).body.items;
      expect(problems.map((e: { result: string }) => e.result).sort()).toEqual(['amount_mismatch', 'not_captured']);
      expect(problems[0]).toMatchObject({ orderId: order.orderId, bookingId: id });
      expect((await as(admin).get('/v1/admin/dashboard').expect(200)).body.paymentProblems).toBe(2);
      const support = await t.adminLogin('support', 's2@eventseva.test');
      await as(support).get('/v1/admin/payment-events').expect(403);
      // "Check now" runs the reconciliation at once (nothing is paid at the provider here).
      expect((await as(admin).post('/v1/admin/payment-events/reconcile').expect(200)).body).toEqual({ confirmed: 0 });
    });
  });

  describe('reconciliation', () => {
    it('confirms a payment whose webhook never came, once, and leaves unpaid orders alone', async () => {
      const { c, id } = await accepted();
      const order = (await as(c.token).post(`/v1/bookings/${id}/pay`).expect(200)).body;
      const other = await customer('9844444444');
      const id2 = (await as(other.token).post('/v1/engine-bookings', { eventId: other.eventId, serviceId: service, startsAt: at(inDays(13), '16:00'), endsAt: at(inDays(13), '23:00'), route, mode: 'with_driver' }).expect(201)).body.id;
      await as(vendor.token).post(`/v1/partner/bookings/${id2}/accept`).expect(200);
      await as(other.token).post(`/v1/bookings/${id2}/pay`).expect(200);
      // Too new: the webhook may still be on its way.
      gateway.captured.set(order.orderId, { paymentId: 'pay_lost', amountPaise: order.amountPaise });
      expect(await events.reconcile()).toBe(0);
      await t.db.query(`UPDATE payments SET created_at = now() - interval '15 minutes' WHERE status = 'created'`);
      expect(await events.reconcile()).toBe(1);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('confirmed');
      expect((await as(other.token).get(`/v1/bookings/${id2}`).expect(200)).body.status).toBe('accepted');
      expect((await history(id)).at(-1)).toMatchObject({ to_state: 'confirmed', actor_kind: 'gateway' });
      // The unpaid order is not asked about again for 10 minutes.
      expect(await events.reconcile()).toBe(0);
      expect((await t.db.query(`SELECT checked_at IS NOT NULL AS checked FROM payments WHERE booking_id = $1`, [id2])).rows[0].checked).toBe(true);
    });
  });

  describe('handover code', () => {
    it('the customer’s code confirms the handover on the spot; wrong codes are refused and limited', async () => {
      const { c, id } = await readyTrip();
      const { code } = (await as(c.token).get(`/v1/bookings/${id}/handover-code`).expect(200)).body;
      expect(code).toMatch(/^\d{6}$/);
      expect(code).toBe(codes.codeFor(id));
      // Only the booking's own customer sees it.
      const stranger = await customer('9844444444');
      await as(stranger.token).get(`/v1/bookings/${id}/handover-code`).expect(404);
      const wrong = code === '000000' ? '111111' : '000000';
      expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8, customerCode: wrong }).expect(400)).body.error.code).toBe('CODE_INVALID');
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8, customerCode: code }).expect(200);
      const trip = (await as(c.token).get(`/v1/bookings/${id}/trip`).expect(200)).body;
      expect(trip.inspections[0]).toMatchObject({ phase: 'handover', customerAck: 'agreed', confirmedBy: 'code' });

      await t.db.query(`UPDATE bookings SET starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      for (let i = 0; i < 4; i++) {
        await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1050, fuelEighths: 8, customerCode: wrong }).expect(400);
      }
      expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1050, fuelEighths: 8, customerCode: code }).expect(429)).body.error.code).toBe('TOO_MANY_ATTEMPTS');
      // Without a code the return is still recorded; the customer answers it in the app.
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1050, fuelEighths: 8 }).expect(200);
    });
  });

  describe('dispute decisions', () => {
    it('an admin can keep money for damage only when photos back it', async () => {
      const { c, id } = await readyTrip();
      await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8 }).expect(200);
      await t.db.query(`UPDATE bookings SET starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour' WHERE id = $1`, [id]);
      const trip = (await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, {
        odometerKm: 1000, fuelEighths: 8, damage: [{ description: 'Dent on the bumper', amountPaise: 300_000 }],
      }).expect(200)).body;
      const dmg = trip.charges.find((x: { kind: string }) => x.kind === 'damage');
      await as(c.token).post(`/v1/bookings/${id}/charges/${dmg.id}`, { decision: 'dispute', note: 'No dent' }).expect(200);
      expect((await as(admin).post(`/v1/admin/bookings/${id}/charges/${dmg.id}/resolve`, { amountPaise: 100_000, note: 'Half' }).expect(409)).body.error.code).toBe('EVIDENCE_REQUIRED');
      await as(admin).post(`/v1/admin/bookings/${id}/charges/${dmg.id}/resolve`, { amountPaise: 0, note: 'No photos of the dent' }).expect(200);
    });
  });
});
