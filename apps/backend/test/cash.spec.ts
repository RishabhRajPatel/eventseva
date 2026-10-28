// Cash bookings: the vendor allows cash per service or package, the customer chooses it, the vendor's
// yes confirms the booking, the vendor records the cash, and EventSeva's commission becomes a due
// that comes off the vendor's next online payout or is settled by finance.
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;

describe('cash bookings', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let bookings: BookingsService;
  let cityId: number;
  let vendor: { token: string; id: string; djId: string; packageId: string };
  let customer: string;

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    bookings = t.app.get(BookingsService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    const token = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const v = (await as(token).post('/v1/partner/vendor', { businessName: 'Raj DJ Sound', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body;
    const s = (await as(token).post('/v1/partner/services', { title: 'Wedding DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body;
    const p = (await as(token).post('/v1/partner/packages', { title: 'Gold', items: ['DJ', 'Lights'], pricePaise: 2_500_000, cashAllowed: true }).expect(201)).body;
    expect(s.cashAllowed).toBe(false);
    expect(p.cashAllowed).toBe(true);
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [v.id]);
    vendor = { token, id: v.id, djId: s.id, packageId: p.id };
    customer = (await t.login('9822222222')).body.accessToken;
  });

  const event = async (daysAhead = 30) =>
    (await as(customer).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(daysAhead), cityId }).expect(201)).body.id as string;
  const cashDj = async (daysAhead = 30) => {
    const eventId = await event(daysAhead);
    return (await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night', payMode: 'cash' }).expect(201)).body;
  };
  const allowCash = () => as(vendor.token).patch(`/v1/partner/services/${vendor.djId}`, { cashAllowed: true }).expect(200);
  const finishDay = async (id: string) => {
    await t.db.query(`UPDATE bookings SET day = $2 WHERE id = $1`, [id, inDays(-1)]);
    await bookings.sweep();
  };

  it('only where the vendor allows cash; the vendor’s yes confirms it with nothing to pay online', async () => {
    const eventId = await event();
    const refused = await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night', payMode: 'cash' }).expect(400);
    expect(refused.body.error.code).toBe('CASH_NOT_ACCEPTED');
    // The customer sees which items take cash.
    const page = (await t.http().get(`/v1/vendors/${vendor.id}`).expect(200)).body;
    expect(page.packages[0].cashAllowed).toBe(true);
    await allowCash();
    const b = await cashDj();
    expect(b).toMatchObject({ status: 'requested', payMode: 'cash' });
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const after = (await as(customer).get(`/v1/bookings/${b.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'confirmed', state: 'confirmed', payMode: 'cash' });
    expect(after.vendor.phone).toBeTruthy();
    expect((await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(409)).body.error.code).toBe('CASH_BOOKING');
    const moves = (await t.db.query(`SELECT from_state, to_state FROM booking_state_history WHERE booking_id = $1 ORDER BY id`, [b.id])).rows;
    expect(moves.map((m) => m.to_state)).toEqual(['pending_vendor', 'confirmed']);
    // A package the vendor marked for cash works the same way.
    const eventId2 = await event(40);
    await as(customer).post('/v1/bookings', { eventId: eventId2, vendorId: vendor.id, packageId: vendor.packageId, slot: 'day', payMode: 'cash' }).expect(201);
  });

  it('the vendor records cash taken and given back; the customer is told and sees it', async () => {
    await allowCash();
    const b = await cashDj();
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'advance', amountPaise: 500_000, note: 'Token at the shop' }).expect(200);
    const tooMuch = await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'balance', amountPaise: 1_100_000 }).expect(400);
    expect(tooMuch.body.error).toMatchObject({ code: 'CASH_TOO_MUCH', maxPaise: 1_000_000 });
    expect((await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'deposit', amountPaise: 1_000 }).expect(400)).body.error.code).toBe('CASH_TOO_MUCH');
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'balance', amountPaise: 1_000_000 }).expect(200);
    const seen = (await as(customer).get(`/v1/bookings/${b.id}/cash`).expect(200)).body;
    expect(seen).toMatchObject({ payMode: 'cash', amountPaise: 1_500_000, receivedPaise: 1_500_000 });
    expect(seen.receipts.map((r: { kind: string }) => r.kind)).toEqual(['advance', 'balance']);
    const kinds = (await t.db.query(`SELECT n.kind FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone LIKE '%9822222222' AND n.kind = 'cash_recorded'`)).rowCount;
    expect(kinds).toBe(2);
    // Online bookings and other vendors cannot record cash on it.
    const other = (await t.login('9833333333', 'partner')).body.accessToken;
    await as(other).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'advance', amountPaise: 100 }).expect(404);
  });

  it('completion: no payout for the cash booking; its commission comes off the next online payout', async () => {
    await allowCash();
    const cash = await cashDj(30);
    await as(vendor.token).post(`/v1/partner/bookings/${cash.id}/accept`).expect(200);
    await finishDay(cash.id);
    expect((await t.db.query(`SELECT 1 FROM payouts WHERE booking_id = $1`, [cash.id])).rowCount).toBe(0);
    const due = (await t.db.one(t.db, `SELECT amount_paise, remaining_paise, status FROM commission_dues WHERE booking_id = $1`, [cash.id]));
    expect(due).toEqual({ amount_paise: 150_000, remaining_paise: 150_000, status: 'open' });
    expect((await as(vendor.token).get('/v1/partner/commission-dues').expect(200)).body).toMatchObject({ openPaise: 150_000 });

    // An online booking of the same vendor completes: its payout is cut by the due.
    const eventId = await event(31);
    const online = (await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night' }).expect(201)).body;
    await as(vendor.token).post(`/v1/partner/bookings/${online.id}/accept`).expect(200);
    await as(customer).post(`/v1/bookings/${online.id}/pay/dev`).expect(200);
    await finishDay(online.id);
    const payout = await t.db.one(t.db, `SELECT amount_paise, dues_deducted_paise, status FROM payouts WHERE booking_id = $1`, [online.id]);
    // Advance ₹3,750 − commission ₹1,500 = ₹2,250, minus the ₹1,500 cash commission.
    expect(payout).toEqual({ amount_paise: 75_000, dues_deducted_paise: 150_000, status: 'scheduled' });
    expect(await t.db.one(t.db, `SELECT status, remaining_paise FROM commission_dues WHERE booking_id = $1`, [cash.id])).toEqual({ status: 'settled', remaining_paise: 0 });
  });

  it('too much unpaid commission stops cash bookings until finance settles it', async () => {
    await allowCash();
    const old = await cashDj(30);
    await as(vendor.token).post(`/v1/partner/bookings/${old.id}/accept`).expect(200);
    await finishDay(old.id);
    await t.db.query(`UPDATE commission_dues SET amount_paise = 600_000, remaining_paise = 600_000`);
    const eventId = await event(35);
    const refused = await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night', payMode: 'cash' }).expect(409);
    expect(refused.body.error.code).toBe('CASH_NOT_AVAILABLE');
    // Online still works.
    await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night' }).expect(201);

    const finance = await t.adminLogin('finance');
    const dues = (await as(finance).get('/v1/admin/commission-dues?status=open').expect(200)).body.items;
    expect(dues).toHaveLength(1);
    expect((await as(finance).get('/v1/admin/dashboard').expect(200)).body.openCommissionDuesPaise).toBe(600_000);
    await as(finance).post(`/v1/admin/commission-dues/${dues[0].id}/settle`, { reference: 'UPI 4321' }).expect(200);
    await as(finance).post(`/v1/admin/commission-dues/${dues[0].id}/settle`, { reference: 'again' }).expect(409);
    const support = await t.adminLogin('support', 's9@eventseva.test');
    await as(support).get('/v1/admin/commission-dues').expect(403);
    // Settled: cash is possible again.
    await t.db.query(`UPDATE bookings SET status = 'cancelled_by_customer' WHERE event_id = $1`, [eventId]);
    await as(customer).post('/v1/bookings', { eventId, vendorId: vendor.id, serviceId: vendor.djId, slot: 'night', payMode: 'cash' }).expect(201);
  });

  it('cancelling a cash booking refunds nothing online; the vendor is told what to give back', async () => {
    await allowCash();
    const b = await cashDj(30);
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'advance', amountPaise: 400_000 }).expect(200);
    await as(customer).post(`/v1/bookings/${b.id}/cancel`, { reason: 'Plans changed' }).expect(200);
    expect(gateway.refunds).toEqual([]);
    const ev = await t.db.one(t.db, `SELECT data FROM booking_events WHERE booking_id = $1 AND event = 'cash_refund_due'`, [b.id]);
    expect(ev.data).toEqual({ amountPaise: 360_000 }); // 90% 30 days ahead
    // The vendor records giving it back; never more than was taken.
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'refund', amountPaise: 500_000 }).expect(400);
    await as(vendor.token).post(`/v1/partner/bookings/${b.id}/cash`, { kind: 'refund', amountPaise: 360_000 }).expect(200);
    expect((await as(customer).get(`/v1/bookings/${b.id}/cash`).expect(200)).body.receivedPaise).toBe(40_000);
  });

  it('cars: cash deposit recorded before handover; nothing due in the app; no cash in a cart', async () => {
    const token = (await t.login('9844444444', 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'car'`)).id;
    const v = (await as(token).post('/v1/partner/vendor', { businessName: 'Royal Cars', categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.44, lng = 81.84 WHERE id = $1`, [v.id]);
    const car = (await as(token).post('/v1/partner/resources', { kind: 'vehicle', name: 'Thar', attributes: { registration: 'UP70CD5678', make: 'Mahindra', model: 'Thar', seats: 4, self_drive: true } }).expect(201)).body.id;
    await t.db.query(`UPDATE resources SET verification = 'approved' WHERE id = $1`, [car]);
    const svc = (await as(token).post('/v1/partner/engine-services', { title: 'Self-drive Thar', pricing: { model: 'daily', ratePaise: 400_000 }, resourceId: car, cashAllowed: true }).expect(201)).body;
    expect(svc.cashAllowed).toBe(true);
    const listed = (await t.http().get(`/v1/vendors/${v.id}/engine-services`).expect(200)).body.items;
    expect(listed[0].cashAllowed).toBe(true);
    await as(customer).put('/v1/me/licence', { number: 'UP70 20190012345', dateOfBirth: '1995-05-05', expiresOn: '2035-01-01' }).expect(200);
    await t.db.query(`UPDATE customer_licences SET status = 'verified'`);
    const eventId = await event(12);
    const route = { pickup: { address: 'Civil Lines', lat: 25.45, lng: 81.85 }, destination: { address: 'Jhunsi', lat: 25.43, lng: 81.91 } };
    const req = { eventId, serviceId: svc.id, startsAt: at(inDays(12), '10:00'), endsAt: at(inDays(13), '10:00'), route, mode: 'self_drive', payMode: 'cash' };
    const cart = await as(customer).post('/v1/checkouts', { items: [req] }).set('Idempotency-Key', 'cash-cart-1').expect(400);
    expect(cart.body.error.code).toBe('CASH_NOT_IN_CART');
    const id = (await as(customer).post('/v1/engine-bookings', req).expect(201)).body.id;
    await as(token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    const trip = (await as(customer).get(`/v1/bookings/${id}/trip`).expect(200)).body;
    expect(trip).toMatchObject({ payMode: 'cash', balanceDuePaise: 0 });
    await t.db.query(`UPDATE bookings SET starts_at = now() + interval '1 hour', ends_at = now() + interval '25 hours' WHERE id = $1`, [id]);
    expect((await as(token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 500, fuelEighths: 8 }).expect(409)).body.error.code).toBe('DEPOSIT_REQUIRED');
    await as(token).post(`/v1/partner/bookings/${id}/cash`, { kind: 'deposit', amountPaise: 500_000 }).expect(200);
    await as(token).post(`/v1/partner/bookings/${id}/trip/handover`, { odometerKm: 500, fuelEighths: 8 }).expect(200);
    const back = (await as(token).post(`/v1/partner/bookings/${id}/trip/return`, { odometerKm: 600, fuelEighths: 8, tollsPaise: 20_000 }).expect(200)).body;
    const toll = back.charges.find((c: { kind: string }) => c.kind === 'toll');
    await as(customer).post(`/v1/bookings/${id}/charges/${toll.id}`, { decision: 'accept' }).expect(200);
    // The deposit is settled without any online refund: the vendor is told to give ₹4,800 back.
    expect(gateway.refunds).toEqual([]);
    const settled = await t.db.one(t.db, `SELECT data FROM booking_events WHERE booking_id = $1 AND event = 'deposit_settled'`, [id]);
    expect(settled.data).toEqual({ keptPaise: 20_000, cashToReturnPaise: 480_000 });
    await as(token).post(`/v1/partner/bookings/${id}/cash`, { kind: 'deposit_return', amountPaise: 480_000 }).expect(200);
    await bookings.sweep();
    expect((await as(customer).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('completed');
    expect((await t.db.query(`SELECT 1 FROM payouts WHERE booking_id = $1`, [id])).rowCount).toBe(0);
    expect((await t.db.query(`SELECT 1 FROM commission_dues WHERE booking_id = $1`, [id])).rowCount).toBe(1);
  });
});
