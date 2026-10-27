// Tampering with URLs: another user's ids, other apps' routes, broken ids and extra parameters must
// never reveal or change anything (IDOR / broken access control).
import { todayIst } from '../src/bookings/booking.rules';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('URL tampering', () => {
  let t: TestApp;
  let cityId: number;
  let alice: string; // customer who owns everything below
  let bob: string; // another customer
  let raj: string; // vendor of the booking
  let other: string; // another vendor
  let eventId: string;
  let bookingId: string;
  let convId: string;

  const as = (token: string | null) => {
    const auth = (r: import('supertest').Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
    return {
      get: (url: string) => auth(t.http().get(url)),
      post: (url: string, body: object = {}) => auth(t.http().post(url)).send(body),
      patch: (url: string, body: object = {}) => auth(t.http().patch(url)).send(body),
      delete: (url: string, body: object = {}) => auth(t.http().delete(url)).send(body),
    };
  };

  async function vendor(phone: string, name: string) {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const v = (await as(token).post('/v1/partner/vendor', { businessName: name, categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body;
    const s = (await as(token).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [v.id]);
    return { token, vendorId: v.id as string, serviceId: s.id as string };
  }

  beforeAll(async () => {
    t = await createTestApp();
    await t.reset();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
    const r = await vendor('9811111111', 'Raj DJ');
    raj = r.token;
    other = (await vendor('9833333333', 'Other DJ')).token;
    alice = (await t.login('9822222222')).body.accessToken;
    bob = (await t.login('9844444444')).body.accessToken;
    eventId = (await as(alice).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(20), cityId }).expect(201)).body.id;
    const b = (await as(alice).post('/v1/bookings', { eventId, vendorId: r.vendorId, serviceId: r.serviceId, slot: 'night' }).expect(201)).body;
    bookingId = b.id;
    convId = b.conversationId;
  });
  afterAll(() => t.app.close());

  it("another customer cannot see or change Alice's event, booking or chat by putting its id in the URL", async () => {
    const tries = [
      as(bob).get(`/v1/events/${eventId}`),
      as(bob).patch(`/v1/events/${eventId}`, { venueAddress: 'Somewhere else 123' }),
      as(bob).get(`/v1/bookings/${bookingId}`),
      as(bob).post(`/v1/bookings/${bookingId}/pay`),
      as(bob).post(`/v1/bookings/${bookingId}/cancel`, { reason: 'Not mine' }),
      as(bob).post(`/v1/bookings/${bookingId}/coupon`, { code: 'WELCOME' }),
      as(bob).post(`/v1/bookings/${bookingId}/review`, { rating: 1 }),
      as(bob).get(`/v1/conversations/${convId}/messages`),
      as(bob).post(`/v1/conversations/${convId}/messages`, { body: 'hi' }),
    ];
    const statuses = (await Promise.all(tries)).map((r) => r.status);
    statuses.forEach((status) => expect([400, 403, 404]).toContain(status));
    // Lists only ever hold your own things, whatever the URL says.
    expect((await as(bob).get(`/v1/events?eventId=${eventId}`).expect(200)).body.items).toEqual([]);
    expect((await as(bob).get(`/v1/bookings?eventId=${eventId}`).expect(200)).body.items).toEqual([]);
    // A booking for an event that is not yours is refused too.
    expect((await as(bob).post('/v1/bookings', { eventId, vendorId: '00000000-0000-4000-8000-000000000000', serviceId: '00000000-0000-4000-8000-000000000000', slot: 'night' })).status).toBe(404);
    // And nothing changed.
    expect((await as(alice).get(`/v1/bookings/${bookingId}`).expect(200)).body.status).toBe('requested');
  });

  it("another vendor cannot see or act on Raj's booking", async () => {
    const tries = [
      as(other).get(`/v1/partner/bookings/${bookingId}`),
      as(other).post(`/v1/partner/bookings/${bookingId}/accept`),
      as(other).post(`/v1/partner/bookings/${bookingId}/reject`, { reason: 'No thanks' }),
      as(other).post(`/v1/partner/bookings/${bookingId}/cancel`, { reason: 'No thanks' }),
      as(other).post(`/v1/partner/bookings/${bookingId}/progress`, { status: 'on_the_way' }),
      as(other).post('/v1/conversations', { bookingId }),
      as(other).get(`/v1/conversations/${convId}/messages`),
    ];
    for (const res of await Promise.all(tries)) expect([403, 404]).toContain(res.status);
    expect((await as(raj).get(`/v1/partner/bookings/${bookingId}`).expect(200)).body.status).toBe('requested');
  });

  it('a customer-app login cannot use Partner routes, and app logins cannot use admin routes', async () => {
    expect((await as(alice).get('/v1/partner/bookings').expect(403)).body.error.code).toBe('PARTNER_APP_ONLY');
    for (const token of [null, alice, raj]) {
      expect((await as(token).get('/v1/admin/dashboard')).status).toBe(401);
      expect((await as(token).get('/v1/admin/bookings')).status).toBe(401);
    }
    await as(null).get('/v1/bookings').expect(401);
    await as('not-a-token').get('/v1/bookings').expect(401);
  });

  it('broken ids, path tricks and unknown parameters are refused before any query runs', async () => {
    for (const bad of ['../events', 'b1', `${bookingId}'--`, `${bookingId}%20OR%201=1`]) {
      expect((await as(alice).get(`/v1/bookings/${bad}`)).status).toBeGreaterThanOrEqual(400);
    }
    await as(alice).get('/v1/bookings?status=confirmed&admin=true').expect(400);
    await as(alice).post('/v1/events', { title: 'X1', eventType: 'wedding', eventDate: inDays(5), cityId, customerId: 'someone-else' }).expect(400);
    await t.http().get(`/v1/vendors?lat=25.4&lng=81.8&sort=nearest;DROP TABLE vendors`).expect(400);
  });

  it('personal answers are never cacheable; public catalogue ones are', async () => {
    expect((await as(alice).get(`/v1/bookings/${bookingId}`).expect(200)).headers['cache-control']).toBe('no-store');
    expect((await as(raj).get('/v1/partner/bookings').expect(200)).headers['cache-control']).toBe('no-store');
    expect((await t.http().get('/v1/categories').expect(200)).headers['cache-control']).toMatch(/^public/);
    // Security headers from helmet.
    const h = (await t.http().get('/v1/categories')).headers;
    expect(h['x-powered-by']).toBeUndefined();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toMatch(/max-age/);
  });
});
