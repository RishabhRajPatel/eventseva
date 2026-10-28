// Dulha-dulhan car booking end to end, with the cases the car prompt lists: midnight crossing,
// simultaneous requests, driver conflicts, duplicate webhooks, vendor cancelling after payment, hold
// expiry, late return, cancellation refunds, deposit settlement, IDOR and other vendors' changes.
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { signParams } from '../src/media/cloudinary.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
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

describe('wedding car booking', () => {
  let t: TestApp;
  let bookings: BookingsService;
  let gateway: FakeGateway;
  let cityId: number;
  let vendor: { token: string; id: string };
  let car: string;
  let selfCar: string;
  let drivers: string[];
  let service: string;
  let selfService: string;
  let admin: string;

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const doc = (vendorId: string, name: string) => {
    const publicId = `eventseva/vendors/${vendorId}/docs/${name}`;
    return { publicId, version: 1, signature: signParams({ public_id: publicId, version: 1 }, SECRET), format: 'pdf' };
  };

  beforeAll(async () => {
    t = await createTestApp();
    bookings = t.app.get(BookingsService);
    gateway = t.app.get(PAYMENT_GATEWAY);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const makeVendor = async (phone: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'car'`)).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `Royal Cars ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.44, lng = 81.84 WHERE id = $1`, [id]);
    return { token, id };
  };
  const approve = async (resourceId: string, docType: string, extra?: string) => {
    await as(vendor.token).post(`/v1/partner/resources/${resourceId}/documents`, { ...doc(vendor.id, `${resourceId}-${docType}`), docType }).expect(201);
    if (extra) await as(vendor.token).post(`/v1/partner/resources/${resourceId}/documents`, { ...doc(vendor.id, `${resourceId}-${extra}`), docType: extra }).expect(201);
    await as(admin).post(`/v1/admin/resources/${resourceId}/verify`, { decision: 'approve' }).expect(200);
  };

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    admin = await t.adminLogin('super');
    vendor = await makeVendor('9811111111');
    const mk = async (body: object) => (await as(vendor.token).post('/v1/partner/resources', body).expect(201)).body.id as string;
    car = await mk({ kind: 'vehicle', name: 'White Audi A6', attributes: { registration: 'UP70AB1234', make: 'Audi', model: 'A6', seats: 4, with_driver: true, decorated: true } });
    selfCar = await mk({ kind: 'vehicle', name: 'Thar', attributes: { registration: 'UP70CD5678', make: 'Mahindra', model: 'Thar', seats: 4, self_drive: true, fuel_policy: 'full_to_full' } });
    drivers = [await mk({ kind: 'driver', name: 'Ramesh', attributes: { licence_last4: '1111', licence_expires: '2032-01-01' } }),
      await mk({ kind: 'driver', name: 'Suresh', attributes: { licence_last4: '2222', licence_expires: '2032-01-01' } })];
    await approve(car, 'vehicle_rc', 'vehicle_insurance');
    await approve(selfCar, 'vehicle_rc', 'vehicle_insurance');
    for (const d of drivers) await approve(d, 'driver_licence');
    service = (await as(vendor.token).post('/v1/partner/engine-services', { title: 'Dulha car', pricing: PRICING, resourceId: car }).expect(201)).body.id;
    selfService = (await as(vendor.token).post('/v1/partner/engine-services', { title: 'Self-drive Thar', pricing: { model: 'daily', ratePaise: 400_000, includedKm: 200, extraKmPaise: 1_000, overtimeHourPaise: 30_000 }, resourceId: selfCar }).expect(201)).body.id;
  });

  const customer = async (phone: string, day = inDays(12)) => {
    const login = (await t.login(phone)).body;
    const token = login.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: day, cityId }).expect(201)).body;
    return { token, eventId: e.id as string, userId: login.user.id as string };
  };
  const ask = (eventId: string, from = at(inDays(12), '16:00'), until = at(inDays(13), '00:30'), svc = service, mode = 'with_driver') =>
    ({ eventId, serviceId: svc, startsAt: from, endsAt: until, route, mode });
  const confirmed = async (c: { token: string; eventId: string }, body = ask(c.eventId)) => {
    const id = (await as(c.token).post('/v1/engine-bookings', body).expect(201)).body.id as string;
    await as(vendor.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    return id;
  };

  it('prices a trip across midnight: base, overtime, driver; GST-free here', async () => {
    const c = await customer('9833333333');
    const q = (await as(c.token).post('/v1/quotes', ask(c.eventId)).expect(200)).body;
    // 16:00 → 00:30 is 8.5 h: one extra hour beyond the 8 included.
    const amount = (code: string) => q.lines.find((l: { code: string }) => l.code === code)?.amountPaise;
    expect(amount('base')).toBe(1_100_000);
    expect(amount('overtime')).toBe(50_000);
    expect(amount('driver')).toBe(50_000);
    expect(q.returnDueAt).toBe(new Date(at(inDays(13), '00:30')).toISOString());
  });

  it('three customers asking for the same car at once: one gets it', async () => {
    const people = await Promise.all(['9833333333', '9844444444', '9855555555'].map((p) => customer(p)));
    const res = await Promise.all(people.map((p) => as(p.token).post('/v1/engine-bookings', ask(p.eventId))));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    // A trip later still fits once the 2 h buffer after and the 1 h preparation before are clear.
    await as(people[1].token).post('/v1/quotes', ask(people[1].eventId, at(inDays(13), '03:00'), at(inDays(13), '10:00'))).expect(409);
    await as(people[1].token).post('/v1/quotes', ask(people[1].eventId, at(inDays(13), '03:30'), at(inDays(13), '10:00'))).expect(200);
  });

  it('a driver can never be on two overlapping trips', async () => {
    const svc2 = (await as(vendor.token).post('/v1/partner/engine-services', { title: 'Second car', pricing: PRICING, resourceId: await (async () => {
      const id = (await as(vendor.token).post('/v1/partner/resources', { kind: 'vehicle', name: 'Black Merc', attributes: { registration: 'UP70EF1111', make: 'Mercedes', model: 'E', seats: 4, with_driver: true } }).expect(201)).body.id;
      await approve(id, 'vehicle_rc', 'vehicle_insurance');
      return id;
    })() }).expect(201)).body.id;
    const a = await confirmed(await customer('9833333333'));
    const c2 = await customer('9844444444');
    const b = await confirmed(c2, ask(c2.eventId, undefined, undefined, svc2));
    await as(vendor.token).post(`/v1/partner/bookings/${a}/trip/driver`, { driverId: drivers[0] }).expect(200);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${b}/trip/driver`, { driverId: drivers[0] }).expect(409)).body.error.code).toBe('DRIVER_BUSY');
    await as(vendor.token).post(`/v1/partner/bookings/${b}/trip/driver`, { driverId: drivers[1] }).expect(200);
    // Reassigning the first trip to its own driver again is fine; to the other's driver is not.
    expect((await as(vendor.token).post(`/v1/partner/bookings/${a}/trip/driver`, { driverId: drivers[1] }).expect(409)).body.error.code).toBe('DRIVER_BUSY');
    // Only two drivers: a third simultaneous with-driver trip is refused at request time.
    const svc3car = (await as(vendor.token).post('/v1/partner/resources', { kind: 'vehicle', name: 'Red Swift', attributes: { registration: 'UP70GH2222', make: 'Maruti', model: 'Swift', seats: 4, with_driver: true } }).expect(201)).body.id;
    await approve(svc3car, 'vehicle_rc', 'vehicle_insurance');
    const svc3 = (await as(vendor.token).post('/v1/partner/engine-services', { title: 'Third', pricing: PRICING, resourceId: svc3car }).expect(201)).body.id;
    const c3 = await customer('9855555555');
    expect((await as(c3.token).post('/v1/engine-bookings', ask(c3.eventId, undefined, undefined, svc3)).expect(409)).body.error).toMatchObject({ code: 'NOT_AVAILABLE', what: 'driver' });
  });

  it('a payment webhook delivered twice confirms once; a failed payment confirms nothing', async () => {
    const c = await customer('9833333333');
    const id = (await as(c.token).post('/v1/engine-bookings', ask(c.eventId)).expect(201)).body.id;
    await as(vendor.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    const order = (await as(c.token).post(`/v1/bookings/${id}/pay`).expect(200)).body;
    await as(c.token).post(`/v1/bookings/${id}/pay/verify`, { razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'bad' }).expect(400);
    expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('accepted');
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_dup', order_id: order.orderId, amount: order.amountPaise } } } });
    const send = () => t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', FakeGateway.signWebhook(body)).send(body);
    await Promise.all([send(), send()]);
    expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('confirmed');
    expect((await t.db.query(`SELECT 1 FROM payments WHERE booking_id = $1 AND status = 'paid'`, [id])).rowCount).toBe(1);
    expect((await t.db.query(`SELECT status FROM reservations WHERE booking_id = $1`, [id])).rows.map((r) => r.status)).toEqual(['active']);
  });

  it('the vendor cancelling after payment refunds in full and frees the car', async () => {
    const c = await customer('9833333333');
    const id = await confirmed(c);
    const paid = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.advancePaise;
    await as(vendor.token).post(`/v1/partner/bookings/${id}/cancel`, { reason: 'Car in accident' }).expect(200);
    expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([paid]);
    const c2 = await customer('9844444444');
    await as(c2.token).post('/v1/engine-bookings', ask(c2.eventId)).expect(201);
  });

  it('an unanswered request stops holding the car when its time runs out', async () => {
    const c = await customer('9833333333');
    const id = (await as(c.token).post('/v1/engine-bookings', ask(c.eventId)).expect(201)).body.id;
    const c2 = await customer('9844444444');
    await as(c2.token).post('/v1/engine-bookings', ask(c2.eventId)).expect(409);
    await t.db.query(`UPDATE reservations SET expires_at = now() - interval '1 second' WHERE booking_id = $1`, [id]);
    await t.db.query(`UPDATE capacity_holds SET expires_at = now() - interval '1 second' WHERE booking_id = $1`, [id]);
    await as(c2.token).post('/v1/engine-bookings', ask(c2.eventId)).expect(201);
    // The vendor can no longer accept the first one: its hold is gone and the car is taken.
    await t.db.query(`UPDATE bookings SET respond_by = now() + interval '1 hour' WHERE id = $1`, [id]);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/accept`).expect(409)).body.error.code).toBe('NOT_AVAILABLE');
  });

  it('cancelling 10 days before refunds by the policy saved with the booking', async () => {
    const c = await customer('9833333333', inDays(10));
    const id = await confirmed(c, ask(c.eventId, at(inDays(10), '16:00'), at(inDays(10), '23:00')));
    const b = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
    // EventSeva later changes the default; this booking keeps its own tiers (50% at 7–14 days).
    await t.db.query(`UPDATE categories SET template = jsonb_set(template, '{rules,cancellation}', '{"customer":[{"minDays":0,"percent":0}],"vendorPercent":100}') WHERE slug = 'car'`);
    try {
      const res = (await as(c.token).post(`/v1/bookings/${id}/cancel`, { reason: 'Plans changed' }).expect(200)).body;
      expect(res.refundPaise).toBe(Math.round(b.advancePaise / 2));
    } finally {
      await t.db.query(`UPDATE categories SET template = template #- '{rules,cancellation}' WHERE slug = 'car'`);
    }
  });

  it('with driver: assign, hand over, return late with more km; charges go to the balance, payout follows', async () => {
    const c = await customer('9833333333');
    const id = await confirmed(c);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8 }).expect(409)).body.error.code).toBe('DRIVER_REQUIRED');
    await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: drivers[0] }).expect(200);
    expect((await as(c.token).get(`/v1/bookings/${id}/trip`).expect(200)).body.driver).toEqual({ id: drivers[0], name: 'Ramesh' });
    // Handover only from 24 h before: move the trip to start soon.
    await t.db.query(`UPDATE bookings SET starts_at = now() + interval '1 hour', ends_at = now() + interval '9 hours 30 minutes' WHERE id = $1`, [id]);
    await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 1000, fuelEighths: 8, photos: [{ publicId: `eventseva/vendors/${vendor.id}/media/front`, version: 1, signature: signParams({ public_id: `eventseva/vendors/${vendor.id}/media/front`, version: 1 }, SECRET) }] }).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/inspections/handover/ack`, { decision: 'agreed' }).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/inspections/handover/ack`, { decision: 'agreed' }).expect(409);
    // Returned 2 h after the booked end with 150 km on the clock.
    await t.db.query(`UPDATE bookings SET starts_at = now() - interval '10 hours', ends_at = now() - interval '90 minutes' WHERE id = $1`, [id]);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 900, fuelEighths: 6 }).expect(400)).body.error.code).toBe('ODOMETER_BELOW_START');
    const trip = (await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 1150, fuelEighths: 6, tollsPaise: 15_000 }).expect(200)).body;
    const byKind = Object.fromEntries(trip.charges.map((x: { kind: string; amountPaise: number }) => [x.kind, x.amountPaise]));
    expect(byKind).toEqual({ extra_km: 70 * 2_500, late_return: 2 * 50_000, toll: 15_000 });
    expect(trip.fulfilment).toBe('closed');
    // The car is free again right away.
    const c2 = await customer('9844444444');
    await as(c2.token).post('/v1/quotes', ask(c2.eventId)).expect(200);

    // Customer accepts; no deposit, so the balance now includes the charges.
    for (const ch of trip.charges) await as(c.token).post(`/v1/bookings/${id}/charges/${ch.id}`, { decision: 'accept' }).expect(200);
    const b = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
    const order = (await as(c.token).post(`/v1/bookings/${id}/pay?part=balance`).expect(200)).body;
    expect(order.amountPaise).toBe(b.amountPaise - b.advancePaise + 175_000 + 100_000 + 15_000);
    await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=balance`).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/pay?part=balance`).expect(409);
    await bookings.sweep();
    expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('completed');
    const payout = (await t.db.one(t.db, 'SELECT amount_paise FROM payouts WHERE booking_id = $1', [id])).amount_paise;
    const commission = (await as(vendor.token).get(`/v1/partner/bookings/${id}`).expect(200)).body.commissionPaise;
    expect(payout).toBe(b.advancePaise + order.amountPaise - commission);
  });

  it('self-drive: verified licence and deposit before handover; damage comes off the deposit', async () => {
    const c = await customer('9833333333');
    const body = ask(c.eventId, at(inDays(12), '10:00'), at(inDays(13), '10:00'), selfService, 'self_drive');
    expect((await as(c.token).post('/v1/quotes', body).expect(400)).body.error.code).toBe('LICENCE_REQUIRED');
    // The licence photo: a private upload into the customer's own folder, with Cloudinary's signed reply.
    const sign = (await as(c.token).post('/v1/me/licence/upload').expect(200)).body;
    expect(sign.params).toMatchObject({ type: 'private', folder: `eventseva/customers/${c.userId}/licence` });
    const lic = { number: 'UP70 20190012345', dateOfBirth: '1995-05-05', expiresOn: '2035-01-01' };
    const photo = (publicId: string, secret = SECRET) => ({ publicId, version: 3, signature: signParams({ public_id: publicId, version: 3 }, secret), format: 'jpg' });
    expect((await as(c.token).put('/v1/me/licence', { ...lic, photo: photo('eventseva/customers/someone-else/licence/x') }).expect(403)).body.error.code).toBe('UPLOAD_INVALID');
    expect((await as(c.token).put('/v1/me/licence', { ...lic, photo: photo(`eventseva/customers/${c.userId}/licence/x`, 'wrong') }).expect(403)).body.error.code).toBe('UPLOAD_INVALID');
    const saved = (await as(c.token).put('/v1/me/licence', { ...lic, photo: photo(`eventseva/customers/${c.userId}/licence/front`) }).expect(200)).body;
    expect(saved).toMatchObject({ last4: '2345', status: 'pending', hasPhoto: true });
    const q = (await as(c.token).post('/v1/quotes', body).expect(200)).body;
    expect(q.depositPaise).toBe(500_000); // from the car category's rules
    const id = await confirmed(c, body);
    await t.db.query(`UPDATE bookings SET starts_at = now() + interval '1 hour', ends_at = now() + interval '25 hours' WHERE id = $1`, [id]);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 500, fuelEighths: 8 }).expect(409)).body.error.code).toBe('LICENCE_NOT_VERIFIED');
    const verifier = await t.adminLogin('verifier', 'v2@eventseva.test');
    const pending = (await as(verifier).get('/v1/admin/licences/pending').expect(200)).body.items;
    expect(pending[0].number).toBe('UP7020190012345');
    expect(pending[0].photoUrl).toMatch(/\/image\/download\?.*public_id=eventseva%2Fcustomers%2F.*type=private/);
    expect((await as(verifier).get('/v1/admin/dashboard').expect(200)).body.pendingChecks).toBeGreaterThan(0);
    const userId = pending[0].userId;
    await as(verifier).post(`/v1/admin/licences/${userId}/verify`, { decision: 'verify' }).expect(200);
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 500, fuelEighths: 8 }).expect(409)).body.error.code).toBe('DEPOSIT_REQUIRED');
    await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=deposit`).expect(200);
    await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: drivers[0] }).expect(409);
    await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 500, fuelEighths: 8 }).expect(200);
    const trip = (await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/return`, {
      odometerKm: 650, fuelEighths: 5, fuelPaise: 120_000, damage: [{ description: 'Scratch on the left door', amountPaise: 200_000 }],
    }).expect(200)).body;
    expect(trip.charges.map((x: { kind: string }) => x.kind).sort()).toEqual(['damage', 'fuel']);
    await as(c.token).post(`/v1/bookings/${id}/inspections/return/ack`, { decision: 'disputed' }).expect(400);
    await as(c.token).post(`/v1/bookings/${id}/inspections/return/ack`, { decision: 'disputed', note: 'The scratch was there before' }).expect(200);
    expect((await as(verifier).get('/v1/admin/dashboard').expect(200)).body.openDisputes).toBeGreaterThan(0);
    const dmg = trip.charges.find((x: { kind: string }) => x.kind === 'damage');
    const fuel = trip.charges.find((x: { kind: string }) => x.kind === 'fuel');
    await as(c.token).post(`/v1/bookings/${id}/charges/${fuel.id}`, { decision: 'accept' }).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/charges/${dmg.id}`, { decision: 'dispute', note: 'Was there at handover' }).expect(200);
    const finance = await t.adminLogin('finance', 'f2@eventseva.test');
    await as(finance).post(`/v1/admin/bookings/${id}/charges/${dmg.id}/resolve`, { amountPaise: 0, note: 'Visible in handover photos' }).expect(200);
    // Deposit ₹5,000: ₹1,200 fuel kept, ₹3,800 back.
    expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([380_000]);
    const view = (await as(c.token).get(`/v1/bookings/${id}/trip`).expect(200)).body;
    expect(view.deposit).toMatchObject({ paidPaise: 500_000, keptPaise: 120_000 });
    expect(view.vehicle.registration).toBe('UP70CD5678');
  });

  it('nobody else can see or move the trip', async () => {
    const c = await customer('9833333333');
    const id = await confirmed(c);
    const stranger = await customer('9844444444');
    await as(stranger.token).get(`/v1/bookings/${id}/trip`).expect(404);
    await as(stranger.token).post(`/v1/bookings/${id}/inspections/handover/ack`, { decision: 'agreed' }).expect(404);
    const other = await makeVendor('9822222222');
    await as(other.token).get(`/v1/partner/bookings/${id}/trip`).expect(404);
    await as(other.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: drivers[0] }).expect(404);
    await as(other.token).patch(`/v1/partner/resources/${car}`, { status: 'maintenance' }).expect(404);
    await as(c.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: drivers[0] }).expect(403);
    // A vendor cannot assign someone else's driver either.
    const theirDriver = (await as(other.token).post('/v1/partner/resources', { kind: 'driver', name: 'Mohan', attributes: { licence_last4: '3333', licence_expires: '2032-01-01' } }).expect(201)).body.id;
    expect((await as(vendor.token).post(`/v1/partner/bookings/${id}/trip/driver`, { driverId: theirDriver }).expect(400)).body.error.code).toBe('DRIVER_NOT_FOUND');
  });
});
