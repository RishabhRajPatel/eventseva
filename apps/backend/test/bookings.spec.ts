import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

/** A date `n` days from today, India time. */
const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('bookings', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let service: BookingsService;
  let cityId: number;

  let vendorToken: string;
  let vendorId: string;
  let djServiceId: string; // ₹15,000 per event
  let plateServiceId: string; // ₹450 per plate
  let packageId: string; // ₹25,000
  let customer: string;

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    service = t.app.get(BookingsService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string, body: object = {}) => t.http().delete(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** An approved vendor with a per-event service, a per-plate service and a package. */
  async function approvedVendor(phone: string) {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const v = (await as(token).post('/v1/partner/vendor', { businessName: 'Raj DJ Sound', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body;
    const s1 = (await as(token).post('/v1/partner/services', { title: 'Wedding DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body;
    const s2 = (await as(token).post('/v1/partner/services', { title: 'Veg thali', pricePaise: 45_000, unit: 'per_plate' }).expect(201)).body;
    const p = (await as(token).post('/v1/partner/packages', { title: 'Gold', items: ['DJ', 'Lights'], pricePaise: 2_500_000 }).expect(201)).body;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [v.id]);
    return { token, vendorId: v.id as string, djServiceId: s1.id, plateServiceId: s2.id, packageId: p.id };
  }

  const newEvent = async (token: string, daysAhead = 30) =>
    (await as(token).post('/v1/events', { title: 'Rahul ki Shaadi', eventType: 'wedding', eventDate: inDays(daysAhead), cityId }).expect(201)).body;

  const requestDj = async (token = customer, daysAhead = 30, slot = 'night') => {
    const event = await newEvent(token, daysAhead);
    return (await as(token).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, slot }).expect(201)).body;
  };

  /** Pays the advance the way the app does: create order → checkout → verify. */
  const payAdvance = async (bookingId: string, token = customer) => {
    const order = (await as(token).post(`/v1/bookings/${bookingId}/pay`).expect(200)).body;
    const paymentId = `pay_${bookingId.slice(0, 8)}`;
    return as(token).post(`/v1/bookings/${bookingId}/pay/verify`, {
      razorpayOrderId: order.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: FakeGateway.sign(order.orderId, paymentId),
    }).expect(200);
  };

  const confirmedDj = async (daysAhead = 30) => {
    const b = await requestDj(customer, daysAhead);
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    return (await payAdvance(b.id)).body;
  };

  const notifications = async (phone: string) =>
    (await t.db.query(`SELECT n.kind, n.title FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = $1 ORDER BY n.id`, [phone])).rows;

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    ({ token: vendorToken, vendorId, djServiceId, plateServiceId, packageId } = await approvedVendor('9811111111'));
    customer = (await t.login('9822222222')).body.accessToken;
  });

  it('happy path: request → accept → pay → confirmed, phones shared only after payment', async () => {
    const b = await requestDj();
    expect(b).toMatchObject({
      status: 'requested',
      day: inDays(30),
      slot: 'night',
      item: { type: 'service', title: 'Wedding DJ', unit: 'per_event' },
      amountPaise: 1_500_000,
      advancePaise: 375_000,
      balancePaise: 1_125_000,
      vendor: { businessName: 'Raj DJ Sound', phone: null },
    });
    expect(b.commissionPaise).toBeUndefined();
    expect(new Date(b.respondBy).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(await notifications('+919811111111')).toEqual([{ kind: 'booking_requested', title: 'New booking request' }]);

    const vendorView = (await as(vendorToken).get('/v1/partner/bookings?status=requested').expect(200)).body.items;
    expect(vendorView).toHaveLength(1);
    expect(vendorView[0]).toMatchObject({ commissionPaise: 150_000, payoutPaise: 225_000, customer: { phone: null } });

    // Nothing to pay before the vendor accepts.
    expect((await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(409)).body.error.code).toBe('BOOKING_BAD_STATUS');

    const accepted = (await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200)).body;
    expect(accepted.status).toBe('accepted');
    const month = inDays(30).slice(0, 7);
    const cal = (await as(vendorToken).get(`/v1/partner/calendar?month=${month}`).expect(200)).body.items;
    expect(cal).toEqual([{ day: inDays(30), slot: 'night', status: 'booked', bookingId: b.id }]);
    expect((await t.http().get(`/v1/vendors/${vendorId}/availability?month=${month}`).expect(200)).body.busy).toEqual([
      { day: inDays(30), slot: 'night' },
    ]);

    const order1 = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    expect(order1).toMatchObject({ amountPaise: 375_000, currency: 'INR', keyId: 'rzp_test_fake' });
    // A second tap reuses the same order.
    expect((await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body.orderId).toBe(order1.orderId);

    const confirmed = (await payAdvance(b.id)).body;
    expect(confirmed).toMatchObject({ status: 'confirmed', vendor: { phone: '+919811111111' } });
    const v = (await as(vendorToken).get(`/v1/partner/bookings/${b.id}`).expect(200)).body;
    expect(v.customer.phone).toBe('+919822222222');

    // Verifying the same payment again changes nothing.
    const paymentId = `pay_${b.id.slice(0, 8)}`;
    await as(customer)
      .post(`/v1/bookings/${b.id}/pay/verify`, {
        razorpayOrderId: order1.orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: FakeGateway.sign(order1.orderId, paymentId),
      })
      .expect(200);
    const { rows } = await t.db.query(`SELECT type, status, amount_paise FROM payments WHERE booking_id = $1`, [b.id]);
    expect(rows).toEqual([{ type: 'advance', status: 'paid', amount_paise: 375_000 }]);
    expect((await notifications('+919822222222')).map((n) => n.kind)).toEqual(['booking_accepted', 'booking_confirmed']);
  });

  it('prices per plate from the quantity, and packages at their price', async () => {
    const event = await newEvent(customer);
    const noQty = await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: plateServiceId, slot: 'day' }).expect(400);
    expect(noQty.body.error.code).toBe('QUANTITY_REQUIRED');
    const plates = (await as(customer)
      .post('/v1/bookings', { eventId: event.id, vendorId, serviceId: plateServiceId, slot: 'day', quantity: 300, note: 'Jain food for 20' })
      .expect(201)).body;
    expect(plates).toMatchObject({ quantity: 300, amountPaise: 13_500_000, advancePaise: 3_375_000, note: 'Jain food for 20' });

    const event2 = await newEvent(customer);
    const pkg = (await as(customer).post('/v1/bookings', { eventId: event2.id, vendorId, packageId, slot: 'full', quantity: 9 }).expect(201)).body;
    expect(pkg).toMatchObject({ quantity: 1, amountPaise: 2_500_000, item: { type: 'package', title: 'Gold' } });
  });

  it('validates requests', async () => {
    const event = await newEvent(customer);
    const both = await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, packageId, slot: 'day' }).expect(400);
    expect(both.body.error.code).toBe('VALIDATION');
    await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, slot: 'morning' }).expect(400);

    const past = await as(customer).post('/v1/events', { title: 'Old', eventType: 'wedding', eventDate: inDays(-1), cityId }).expect(400);
    expect(past.body.error.code).toBe('EVENT_IN_PAST');

    await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, slot: 'day' }).expect(201);
    const dup = await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, packageId, slot: 'night' }).expect(409);
    expect(dup.body.error.code).toBe('BOOKING_EXISTS');

    // Another customer's event, and a vendor that is not live.
    const other = (await t.login('9833333333')).body.accessToken;
    await as(other).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, slot: 'day' }).expect(404);
    await t.db.query(`UPDATE vendors SET status = 'on_hold'`);
    const otherEvent = await newEvent(other);
    expect((await as(other).post('/v1/bookings', { eventId: otherEvent.id, vendorId, serviceId: djServiceId, slot: 'day' }).expect(404)).body.error.code).toBe('VENDOR_NOT_FOUND');
  });

  it('a vendor cannot book themself', async () => {
    // Same phone, now in the customer app (after the 30-second OTP resend wait).
    await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '1 minute'`);
    const self = (await t.login('9811111111')).body.accessToken;
    const event = await newEvent(self);
    const res = await as(self).post('/v1/bookings', { eventId: event.id, vendorId, serviceId: djServiceId, slot: 'day' }).expect(400);
    expect(res.body.error.code).toBe('OWN_VENDOR');
  });

  it('slots: day and night can both be booked, a full day clashes, blocked days are closed', async () => {
    const c2 = (await t.login('9833333333')).body.accessToken;
    const c3 = (await t.login('9844444444')).body.accessToken;
    const day = await requestDj(customer, 20, 'day');
    const night = await requestDj(c2, 20, 'night');
    const full = await requestDj(c3, 20, 'full');

    await as(vendorToken).post(`/v1/partner/bookings/${day.id}/accept`).expect(200);
    await as(vendorToken).post(`/v1/partner/bookings/${night.id}/accept`).expect(200);
    expect((await as(vendorToken).post(`/v1/partner/bookings/${full.id}/accept`).expect(409)).body.error.code).toBe('SLOT_TAKEN');
    // New requests for a taken slot are refused straight away.
    const c4 = (await t.login('9855555555')).body.accessToken;
    const ev = await newEvent(c4, 20);
    await as(c4).post('/v1/bookings', { eventId: ev.id, vendorId, serviceId: djServiceId, slot: 'day' }).expect(409);

    // Blocking a free day; the slot is then closed to requests.
    await as(vendorToken).post('/v1/partner/calendar/block', { day: inDays(40), slot: 'full' }).expect(204);
    await as(vendorToken).post('/v1/partner/calendar/block', { day: inDays(20), slot: 'full' }).expect(409);
    const ev40 = await newEvent(c4, 40);
    expect((await as(c4).post('/v1/bookings', { eventId: ev40.id, vendorId, serviceId: djServiceId, slot: 'night' }).expect(409)).body.error.code).toBe('SLOT_TAKEN');
    await as(vendorToken).delete('/v1/partner/calendar/block', { day: inDays(40), slot: 'full' }).expect(204);
    await as(vendorToken).delete('/v1/partner/calendar/block', { day: inDays(40), slot: 'full' }).expect(404);
    await as(c4).post('/v1/bookings', { eventId: ev40.id, vendorId, serviceId: djServiceId, slot: 'night' }).expect(201);
  });

  it('vendor rejects with a reason', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/reject`, {}).expect(400);
    const r = (await as(vendorToken).post(`/v1/partner/bookings/${b.id}/reject`, { reason: 'Already booked elsewhere' }).expect(200)).body;
    expect(r).toMatchObject({ status: 'rejected', cancelReason: 'Already booked elsewhere' });
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(409);
    // The customer can now send a new request to the same vendor for the same event.
    const again = await as(customer).post('/v1/bookings', { eventId: b.event.id, vendorId, packageId, slot: 'night' }).expect(201);
    expect(again.body.status).toBe('requested');
  });

  it('privacy: other customers and vendors cannot see or touch a booking', async () => {
    const b = await requestDj();
    const other = (await t.login('9833333333')).body.accessToken;
    await as(other).get(`/v1/bookings/${b.id}`).expect(404);
    await as(other).post(`/v1/bookings/${b.id}/cancel`, { reason: 'test' }).expect(404);
    const otherVendor = (await approvedVendor('9866666666')).token;
    await as(otherVendor).post(`/v1/partner/bookings/${b.id}/accept`).expect(404);
    expect((await as(customer).post(`/v1/partner/bookings/${b.id}/accept`).expect(403)).body.error.code).toBe('PARTNER_APP_ONLY');
  });

  it('no reply in 24 hours → expired', async () => {
    const b = await requestDj();
    await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 minute'`);
    expect((await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(409)).body.error.code).toBe('BOOKING_EXPIRED');
    expect(await service.sweep()).toMatchObject({ expired: 1, completed: 0 });
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.status).toBe('expired');
    expect((await notifications('+919822222222')).at(-1)).toEqual({ kind: 'booking_expired', title: 'No reply from vendor' });
  });

  it('no payment in 24 hours → expired and the date is free again', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    await t.db.query(`UPDATE bookings SET pay_by = now() - interval '1 minute'`);
    expect((await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(409)).body.error.code).toBe('PAYMENT_TIME_OVER');
    await service.sweep();
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.status).toBe('expired');
    expect((await as(vendorToken).get(`/v1/partner/calendar?month=${inDays(30).slice(0, 7)}`)).body.items).toEqual([]);
  });

  it('money that arrives after the booking closed is refunded in full', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    await t.db.query(`UPDATE bookings SET pay_by = now() - interval '1 minute'`);
    await service.sweep();

    expect(await service.paymentCaptured(order.orderId, 'pay_late')).toBe('refunded');
    expect(gateway.refunds).toEqual([{ paymentId: 'pay_late', amountPaise: 375_000 }]);
    const view = (await as(customer).get(`/v1/bookings/${b.id}`)).body;
    expect(view).toMatchObject({ status: 'expired', refundPaise: 375_000 });
    expect(await service.paymentCaptured(order.orderId, 'pay_late')).toBe('already_done');
    expect(gateway.refunds).toHaveLength(1);
  });

  it('dev payment confirms in fake mode', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    expect((await as(customer).post(`/v1/bookings/${b.id}/pay/dev`).expect(200)).body.status).toBe('confirmed');
  });

  it('rejects a forged payment signature', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    const res = await as(customer)
      .post(`/v1/bookings/${b.id}/pay/verify`, { razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'ab'.repeat(32) })
      .expect(400);
    expect(res.body.error.code).toBe('PAYMENT_INVALID');
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.status).toBe('accepted');
  });

  it('webhook confirms the booking even if the app never calls verify', async () => {
    const b = await requestDj();
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_hook', order_id: order.orderId } } } });

    const send = (signature: string) =>
      t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(body);
    expect((await send('00'.repeat(32)).expect(401)).body.error.code).toBe('WEBHOOK_INVALID');
    await send(FakeGateway.signWebhook(body)).expect(200, { ok: true });
    await send(FakeGateway.signWebhook(body)).expect(200); // Razorpay retries are harmless
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.status).toBe('confirmed');
  });

  it.each([
    [30, 90, 337_500],
    [10, 50, 187_500],
    [3, 0, 0],
  ])('customer cancels %i days before → %i%% of the advance back', async (daysAhead, _percent, refund) => {
    const b = await confirmedDj(daysAhead);
    const res = (await as(customer).post(`/v1/bookings/${b.id}/cancel`, { reason: 'Date changed' }).expect(200)).body;
    expect(res).toMatchObject({ status: 'cancelled_by_customer', refundPaise: refund });
    expect(gateway.refunds).toEqual(refund ? [{ paymentId: expect.any(String), amountPaise: refund }] : []);
    expect((await as(vendorToken).get(`/v1/partner/calendar?month=${inDays(daysAhead).slice(0, 7)}`)).body.items).toEqual([]);
    await as(customer).post(`/v1/bookings/${b.id}/cancel`, { reason: 'Again' }).expect(409);
  });

  it('cancelling before payment costs nothing', async () => {
    const b = await requestDj();
    const res = (await as(customer).post(`/v1/bookings/${b.id}/cancel`, { reason: 'Found another DJ' }).expect(200)).body;
    expect(res).toMatchObject({ status: 'cancelled_by_customer', refundPaise: 0 });
  });

  it('vendor cancels a confirmed booking → full advance back', async () => {
    const b = await confirmedDj(2);
    const res = (await as(vendorToken).post(`/v1/partner/bookings/${b.id}/cancel`, { reason: 'Equipment damaged' }).expect(200)).body;
    expect(res).toMatchObject({ status: 'cancelled_by_vendor', refundPaise: 375_000 });
    expect((await notifications('+919822222222')).at(-1)).toEqual({ kind: 'booking_cancelled', title: 'Vendor cancelled' });
  });

  it('after the event day: completed, payout scheduled (advance − commission, 3 days for new vendors)', async () => {
    const b = await confirmedDj(5);
    expect(await service.sweep()).toMatchObject({ expired: 0, completed: 0 });

    const yesterday = inDays(-1);
    await t.db.query(`UPDATE bookings SET day = $1`, [yesterday]);
    expect(await service.sweep()).toMatchObject({ expired: 0, completed: 1 });
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.status).toBe('completed');

    const payout = await t.db.one(t.db, `SELECT amount_paise, status, release_after FROM payouts WHERE booking_id = $1`, [b.id]);
    expect(payout).toMatchObject({ amount_paise: 225_000, status: 'scheduled' });
    const expected = new Date(`${yesterday}T10:00:00+05:30`);
    expected.setUTCDate(expected.getUTCDate() + 3);
    expect(new Date(payout.release_after).toISOString()).toBe(expected.toISOString());
    expect((await notifications('+919811111111')).at(-1)).toEqual({ kind: 'payout_scheduled', title: 'Payout scheduled' });
    expect(await service.sweep()).toMatchObject({ expired: 0, completed: 0 });
  });

  it('event page lists its bookings and totals', async () => {
    const b = await confirmedDj(30);
    const events = (await as(customer).get('/v1/events').expect(200)).body.items;
    const ev = events.find((e: { id: string }) => e.id === b.event.id);
    expect(ev).toMatchObject({ title: 'Rahul ki Shaadi', eventType: 'wedding', confirmedCount: 1, pendingCount: 0, committedPaise: 1_500_000 });
    const detail = (await as(customer).get(`/v1/events/${b.event.id}`).expect(200)).body;
    expect(detail.bookings.map((x: { id: string }) => x.id)).toEqual([b.id]);
  });

  it('a vendor on hold cannot accept new requests', async () => {
    const b = await requestDj();
    await t.db.query(`UPDATE vendors SET status = 'on_hold'`);
    expect((await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(409)).body.error.code).toBe('VENDOR_NOT_ACTIVE');
  });
});
