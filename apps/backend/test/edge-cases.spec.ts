import { eventStart, payByFor, respondByFor, todayIst } from '../src/bookings/booking.rules';
import { maskPhones } from '../src/chat/chat.controller';
import { TrimBodyPipe } from '../src/common/trim.pipe';
import { FakeGateway } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const HOUR = 3600_000;

describe('edge cases (rules)', () => {
  it('reply and pay deadlines never run into the event day', () => {
    const day = '2026-12-10';
    const start = eventStart(day).getTime();
    // Far away: the normal 24 hours.
    const early = new Date(start - 10 * 24 * HOUR);
    expect(respondByFor(day, early)!.getTime()).toBe(early.getTime() + 24 * HOUR);
    expect(payByFor(day, early).getTime()).toBe(early.getTime() + 24 * HOUR);
    // The evening before: the vendor has until an hour before midnight, payment until midnight.
    const evening = new Date(start - 6 * HOUR);
    expect(respondByFor(day, evening)!.getTime()).toBe(start - HOUR);
    expect(payByFor(day, evening).getTime()).toBe(start);
    // Less than two hours before the day starts (or on the day itself): too late to book in the app.
    expect(respondByFor(day, new Date(start - 90 * 60_000))).toBeNull();
    expect(respondByFor(day, new Date(start + 5 * HOUR))).toBeNull();
  });

  it('hides phone numbers however they are written, plus e-mails and WhatsApp links', () => {
    expect(maskPhones('call ९८७६५४३२१०')).toBe('call ••••••••••');
    expect(maskPhones('98.76.54.32.10 or (987) 654-3210')).toBe('•••••••••• or (••••••••••');
    expect(maskPhones('0091 9876543210')).toBe('••••••••••');
    expect(maskPhones('mail raj.dj@gmail.com or wa.me/919876543210')).toBe('mail ••••• or •••••');
    expect(maskPhones('Budget 15,00,000 for 300 guests on 12.11.2026')).toBe('Budget 15,00,000 for 300 guests on 12.11.2026');
  });

  it('trims body strings but never passwords', () => {
    const pipe = new TrimBodyPipe();
    expect(pipe.transform({ reason: '   ', items: [' a '], nested: { title: ' x ' }, password: ' p ' }, { type: 'body' })).toEqual({
      reason: '',
      items: ['a'],
      nested: { title: 'x' },
      password: ' p ',
    });
    expect(pipe.transform(' q ', { type: 'query' })).toBe(' q ');
  });
});

describe('edge cases (API)', () => {
  let t: TestApp;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let djServiceId: string;
  let plateServiceId: string;
  let customer: string;

  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  const newEvent = async (daysAhead = 30, token = customer) =>
    (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(daysAhead), cityId }).expect(201)).body;
  const requestDj = async (daysAhead = 30) => {
    const e = await newEvent(daysAhead);
    return (await as(customer).post('/v1/bookings', { eventId: e.id, vendorId, serviceId: djServiceId, slot: 'night' }).expect(201)).body;
  };

  beforeEach(async () => {
    await t.reset();
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    djServiceId = (await as(vendorToken).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
    plateServiceId = (await as(vendorToken).post('/v1/partner/services', {
      title: 'Thali', pricePaise: 45_000, unit: 'per_plate', minGuests: 100, maxGuests: 500,
    }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [vendorId]);
    customer = (await t.login('9822222222')).body.accessToken;
  });

  it('refuses blank reasons and titles made of spaces', async () => {
    const b = await requestDj();
    const res = await as(vendorToken).post(`/v1/partner/bookings/${b.id}/reject`, { reason: '     ' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    await as(customer).post('/v1/events', { title: '   ', eventType: 'wedding', eventDate: inDays(5), cityId }).expect(400);
  });

  it('refuses event and calendar dates more than two years ahead', async () => {
    const res = await as(customer).post('/v1/events', { title: 'Far', eventType: 'wedding', eventDate: inDays(800), cityId }).expect(400);
    expect(res.body.error.code).toBe('DATE_TOO_FAR');
    await t.http().post('/v1/partner/calendar/block').set('Authorization', `Bearer ${vendorToken}`)
      .send({ day: inDays(800), slot: 'full' }).expect(400);
  });

  it('a booking for tomorrow has to be answered and paid before tomorrow starts', async () => {
    const b = await requestDj(1);
    const start = eventStart(inDays(1)).getTime();
    expect(new Date(b.respondBy).getTime()).toBeLessThanOrEqual(start - HOUR);
    const accepted = (await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200)).body;
    expect(new Date(accepted.payBy).getTime()).toBeLessThanOrEqual(start);
  });

  it('checks the guest count against the vendor’s minimum and maximum', async () => {
    const e = await newEvent();
    const res = await as(customer).post('/v1/bookings', { eventId: e.id, vendorId, serviceId: plateServiceId, slot: 'day', quantity: 50 }).expect(400);
    expect(res.body.error).toMatchObject({ code: 'QUANTITY_OUT_OF_RANGE', min: 100, max: 500 });
    await as(customer).post('/v1/bookings', { eventId: e.id, vendorId, serviceId: plateServiceId, slot: 'day', quantity: 200 }).expect(201);
  });

  it('limits how many unanswered requests one customer can have', async () => {
    for (let i = 0; i < 15; i++) await requestDj(20 + i);
    const e = await newEvent(60);
    const res = await as(customer).post('/v1/bookings', { eventId: e.id, vendorId, serviceId: djServiceId, slot: 'night' }).expect(429);
    expect(res.body.error).toMatchObject({ code: 'TOO_MANY_OPEN_REQUESTS', max: 15 });
  });

  it('limits chat messages per minute', async () => {
    const conv = (await as(customer).post('/v1/conversations', { vendorId }).expect(201)).body;
    for (let i = 0; i < 20; i++) await as(customer).post(`/v1/conversations/${conv.id}/messages`, { body: `hello ${i}` }).expect(201);
    const res = await as(customer).post(`/v1/conversations/${conv.id}/messages`, { body: 'one more' }).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_MESSAGES');
  });

  it('pausing a vendor tells waiting customers at once; confirmed bookings stay', async () => {
    const waiting = await requestDj(30);
    const toPay = await requestDj(31);
    await as(vendorToken).post(`/v1/partner/bookings/${toPay.id}/accept`).expect(200);
    const admin = await t.adminLogin('verifier');
    const res = (await as(admin).post(`/v1/admin/vendors/${vendorId}/hold`, { reason: 'Documents expired' }).expect(200)).body;
    expect(res).toMatchObject({ status: 'on_hold', closedBookings: 2, confirmedBookings: 0 });
    expect((await as(customer).get(`/v1/bookings/${waiting.id}`)).body.status).toBe('rejected');
    expect((await as(customer).get(`/v1/bookings/${toPay.id}`)).body.status).toBe('cancelled_by_vendor');
    // The vendor's date is free again and the customer cannot pay any more.
    expect((await t.db.query('SELECT 1 FROM availability WHERE booking_id = $1', [toPay.id])).rowCount).toBe(0);
    await as(customer).post(`/v1/bookings/${toPay.id}/pay`).expect(409);
  });

  it('blocking a vendor’s owner takes the profile out of search', async () => {
    await requestDj();
    const owner = (await t.db.one(t.db, 'SELECT user_id FROM vendors WHERE id = $1', [vendorId])).user_id;
    const admin = await t.adminLogin('support');
    const res = (await as(admin).post(`/v1/admin/users/${owner}/block`, { reason: 'Fraud reports' }).expect(200)).body;
    expect(res).toMatchObject({ isBlocked: true, vendorOnHold: true, closedBookings: 1 });
    await t.http().get(`/v1/vendors/${vendorId}`).expect(404);
  });

  it('a refund cannot come out of the payout of a booking that never pays the vendor', async () => {
    const b = await requestDj(30);
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    await as(customer).post(`/v1/bookings/${b.id}/pay/verify`, {
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_x1', razorpaySignature: FakeGateway.sign(order.orderId, 'pay_x1'),
    }).expect(200);
    await as(customer).post(`/v1/bookings/${b.id}/cancel`, { reason: 'Plans changed' }).expect(200);
    const finance = await t.adminLogin('finance');
    const res = await as(finance).post(`/v1/admin/bookings/${b.id}/refund`, { amountPaise: 10_000, reason: 'Goodwill', fromVendorPayout: true }).expect(409);
    expect(res.body.error.code).toBe('NO_VENDOR_PAYOUT');
    await as(finance).post(`/v1/admin/bookings/${b.id}/refund`, { amountPaise: 10_000, reason: 'Goodwill' }).expect(200);
  });
});
