import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { progressAllowed, straightKm, travelBetween } from '../src/bookings/travel';
import { FakeGateway } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Prayagraj: a DJ in Civil Lines and a venue near the Sangam.
const CIVIL_LINES = { lat: 25.4484, lng: 81.8406 };
const SANGAM = { lat: 25.4246, lng: 81.8845 };
const JHUNSI = { lat: 25.4363, lng: 81.9071 };

describe('distance (rules)', () => {
  it('estimates road km and minutes from two pins', () => {
    expect(straightKm(CIVIL_LINES, SANGAM)).toBeCloseTo(5.1, 1);
    expect(travelBetween(CIVIL_LINES, SANGAM, 20)).toEqual({ roadKm: 6.5, minutes: 20, serviceRadiusKm: 20, outsideServiceArea: false });
    expect(travelBetween(CIVIL_LINES, JHUNSI, 5)!.outsideServiceArea).toBe(true);
    expect(travelBetween(CIVIL_LINES, CIVIL_LINES)).toMatchObject({ roadKm: 0, minutes: 5 });
    expect(travelBetween(null, SANGAM)).toBeNull();
  });

  it('event-day updates only on the day or the evening before', () => {
    expect([2, 1, 0, -1].map(progressAllowed)).toEqual([false, true, true, false]);
  });
});

describe('distance, event-day updates and booking chat (API)', () => {
  let t: TestApp;
  let service: BookingsService;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let djServiceId: string;
  let customer: string;

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(BookingsService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeEach(async () => {
    await t.reset();
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', {
      businessName: 'Raj DJ', categoryId: dj, cityId, area: 'Civil Lines', ...CIVIL_LINES, serviceRadiusKm: 20,
    }).expect(201)).body.id;
    djServiceId = (await as(vendorToken).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [vendorId]);
    customer = (await t.login('9822222222')).body.accessToken;
  });

  const event = async (extra: object = {}, daysAhead = 10) =>
    (await as(customer).post('/v1/events', {
      title: 'Shaadi', eventType: 'wedding', eventDate: inDays(daysAhead), cityId,
      venueAddress: 'Hotel Kanha Shyam, Civil Lines', venueLat: SANGAM.lat, venueLng: SANGAM.lng, venueLandmark: 'Near the Sangam gate', ...extra,
    }).expect(201)).body;
  const request = async (eventId: string, extra: object = {}) =>
    (await as(customer).post('/v1/bookings', { eventId, vendorId, serviceId: djServiceId, slot: 'night', ...extra }).expect(201)).body;
  const confirm = async (bookingId: string) => {
    await as(vendorToken).post(`/v1/partner/bookings/${bookingId}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${bookingId}/pay`).expect(200)).body;
    await as(customer).post(`/v1/bookings/${bookingId}/pay/verify`, {
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_t1', razorpaySignature: FakeGateway.sign(order.orderId, 'pay_t1'),
    }).expect(200);
  };
  const kinds = async (phone: string) =>
    (await t.db.query(`SELECT n.kind FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = $1 ORDER BY n.id`, [phone])).rows.map((r) => r.kind);

  it('both sides see how far the venue is; the vendor gets the pin and directions only after payment', async () => {
    const e = await event();
    expect(e).toMatchObject({ venueLocation: SANGAM, venueLandmark: 'Near the Sangam gate' });
    const b = await request(e.id, { arriveBy: '17:30' });
    expect(b).toMatchObject({ arriveBy: '17:30', travel: { roadKm: 6.5, minutes: 20, outsideServiceArea: false }, event: { venueLocation: SANGAM } });

    const before = (await as(vendorToken).get(`/v1/partner/bookings/${b.id}`).expect(200)).body;
    expect(before).toMatchObject({ travel: { roadKm: 6.5 }, arriveBy: '17:30', directionsUrl: null });
    expect(before.event).toMatchObject({ venueAddress: null, venueLocation: null, venueLandmark: null });

    await confirm(b.id);
    const after = (await as(vendorToken).get(`/v1/partner/bookings/${b.id}`).expect(200)).body;
    expect(after.event).toMatchObject({ venueLocation: SANGAM, venueLandmark: 'Near the Sangam gate' });
    expect(after.directionsUrl).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${SANGAM.lat},${SANGAM.lng}`)}`);
  });

  it('a venue beyond the vendor’s range is flagged, not refused', async () => {
    await as(vendorToken).patch('/v1/partner/vendor', { serviceRadiusKm: 3 }).expect(200);
    const b = await request((await event()).id);
    expect(b.travel).toMatchObject({ serviceRadiusKm: 3, outsideServiceArea: true });
    // null clears the range
    expect((await as(vendorToken).patch('/v1/partner/vendor', { serviceRadiusKm: null }).expect(200)).body.serviceRadiusKm).toBeNull();
  });

  it('the public never gets the vendor’s pin; search can sort by distance from the venue', async () => {
    const pub = (await t.http().get(`/v1/vendors/${vendorId}`).expect(200)).body;
    expect(pub).toMatchObject({ location: null, serviceRadiusKm: 20 });

    // A second DJ far away in Jhunsi.
    const far = (await t.login('9833333333', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const farId = (await as(far).post('/v1/partner/vendor', { businessName: 'Jhunsi Beats', categoryId: dj, cityId, area: 'Jhunsi', ...JHUNSI }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), rating_avg = 5 WHERE id = $1`, [farId]);

    const near = (await t.http().get(`/v1/vendors?lat=${CIVIL_LINES.lat}&lng=${CIVIL_LINES.lng}&sort=nearest`).expect(200)).body.items;
    expect(near.map((v: { businessName: string }) => v.businessName)).toEqual(['Raj DJ', 'Jhunsi Beats']);
    expect(near[0].distanceKm).toBe(0);
    expect(near[1].distanceKm).toBeGreaterThan(6);
    // Without a venue, no distance; sorting by distance needs one.
    expect((await t.http().get('/v1/vendors').expect(200)).body.items[0].distanceKm).toBeNull();
    await t.http().get('/v1/vendors?sort=nearest').expect(400);

    // Before booking, the customer can check one vendor's trip to their venue.
    expect((await t.http().get(`/v1/vendors/${vendorId}/travel?lat=${SANGAM.lat}&lng=${SANGAM.lng}`).expect(200)).body.travel).toEqual({
      roadKm: 6.5, minutes: 20, serviceRadiusKm: 20, outsideServiceArea: false,
    });
    await t.http().get(`/v1/vendors/${vendorId}/travel?lat=abc&lng=1`).expect(400);
  });

  it('the whole booking story is in the chat', async () => {
    const b = await request((await event()).id);
    await confirm(b.id);
    const conv = (await as(customer).get(`/v1/bookings/${b.id}`)).body.conversationId;
    const msgs = (await as(customer).get(`/v1/conversations/${conv}/messages`).expect(200)).body.items;
    expect(msgs.map((m: { kind: string; data: { event: string } }) => `${m.kind}:${m.data?.event}`).reverse()).toEqual([
      'booking:requested', 'booking:accepted', 'booking:confirmed',
    ]);
    const list = (await as(vendorToken).get('/v1/conversations').expect(200)).body.items[0];
    expect(list).toMatchObject({ lastKind: 'booking', lastData: { event: 'confirmed', bookingId: b.id } });
  });

  it('on the event day the vendor says "on the way" (with an ETA) and "reached"', async () => {
    const b = await request((await event()).id);
    await confirm(b.id);
    const tooEarly = await as(vendorToken).post(`/v1/partner/bookings/${b.id}/progress`, { status: 'on_the_way' }).expect(409);
    expect(tooEarly.body.error.code).toBe('PROGRESS_NOT_ALLOWED');

    await t.db.query('UPDATE bookings SET day = $1 WHERE id = $2', [inDays(0), b.id]);
    const otw = (await as(vendorToken).post(`/v1/partner/bookings/${b.id}/progress`, { status: 'on_the_way' }).expect(200)).body;
    // No ETA given: the estimate from the two pins (20 min).
    expect(otw.progress.status).toBe('on_the_way');
    expect(new Date(otw.progress.etaAt).getTime()).toBeGreaterThan(Date.now() + 19 * 60_000);
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/progress`, { status: 'on_the_way', etaMinutes: 45 }).expect(200);
    const seen = (await as(customer).get(`/v1/bookings/${b.id}`)).body.progress;
    expect(new Date(seen.etaAt).getTime()).toBeGreaterThan(Date.now() + 44 * 60_000);

    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/progress`, { status: 'reached' }).expect(200);
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/progress`, { status: 'on_the_way' }).expect(409);
    expect((await kinds('+919822222222')).slice(-3)).toEqual(['vendor_on_the_way', 'vendor_on_the_way', 'vendor_reached']);
  });

  it('the evening before, both sides get one reminder with the trip', async () => {
    const b = await request((await event()).id, { arriveBy: '17:30' });
    await confirm(b.id);
    await t.db.query('UPDATE bookings SET day = $1 WHERE id = $2', [inDays(1), b.id]);
    expect(await service.sendReminders(new Date(`${todayIst()}T12:00:00+05:30`))).toBe(0); // too early in the day
    const evening = new Date(`${todayIst()}T18:00:00+05:30`);
    expect(await service.sendReminders(evening)).toBe(1);
    expect(await service.sendReminders(evening)).toBe(0); // only once
    const vendorNote = await t.db.one<{ body: string }>(
      t.db, `SELECT n.body FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = '+919811111111' AND n.kind = 'booking_reminder'`);
    expect(vendorNote!.body).toBe('At Hotel Kanha Shyam, Civil Lines. About 6.5 km, 20 min. Reach by 5:30 pm.');
    expect(await kinds('+919822222222')).toContain('booking_reminder');
  });

  it('changing the venue tells the confirmed vendor; the date cannot change', async () => {
    const e = await event();
    const b = await request(e.id);
    await confirm(b.id);
    const updated = (await as(customer).patch(`/v1/events/${e.id}`, { venueAddress: 'Lawn 2, Hotel Kanha Shyam', venueLat: JHUNSI.lat, venueLng: JHUNSI.lng }).expect(200)).body;
    expect(updated).toMatchObject({ venueAddress: 'Lawn 2, Hotel Kanha Shyam', venueLocation: JHUNSI, venueLandmark: 'Near the Sangam gate' });
    expect(await kinds('+919811111111')).toContain('venue_updated');
    expect((await as(vendorToken).get(`/v1/partner/bookings/${b.id}`)).body.travel.roadKm).toBeGreaterThan(8);

    await as(customer).patch(`/v1/events/${e.id}`, { eventDate: inDays(20) }).expect(400);
    await as(customer).patch(`/v1/events/${e.id}`, { venueLat: 25.1 }).expect(400); // lat without lng
    await as(customer).patch(`/v1/events/${e.id}`, { venueLandmark: null }).expect(200);
  });
});
