// Every booking type the engine handles beyond rentals and cars (which have their own specs):
// catering by guests, staff by head-count, makeup by people × time, custom quotations, and changing a
// booked time (reschedule, extension) with conflicts, price differences and refunds.
import { todayIst } from '../src/bookings/booking.rules';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, restoreLiveCategories, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const DAY = inDays(12);
const NEXT = inDays(13);

describe('booking types and changes', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let cityId: number;

  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  const restore = () => restoreLiveCategories(t.db);
  afterAll(async () => {
    await restore();
    await t.app.close();
  });
  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
  });
  afterEach(restore);

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const vendor = async (phone: string, slug: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    await t.db.query(`UPDATE categories SET is_active = true WHERE slug = $1`, [slug]);
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slug])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `${slug} ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [id]);
    return { token, id };
  };
  const customer = async (phone: string) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: DAY, cityId }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const confirm = async (vendorToken: string, c: { token: string }, body: object, accept: object = {}) => {
    const id = (await as(c.token).post('/v1/engine-bookings', body).expect(201)).body.id as string;
    await as(vendorToken).post(`/v1/partner/bookings/${id}/accept`, accept).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    return id;
  };

  it('catering: guests × rate, menu asked, and the vendor\'s daily guest capacity is shared', async () => {
    const v = await vendor('9811111111', 'catering');
    await as(v.token).post('/v1/partner/engine-services', { title: 'Veg thali', pricing: { model: 'hourly', ratePaise: 100 } }).expect(400);
    const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'Veg thali', pricing: { model: 'per_person', ratePaise: 45_000 }, rules: { capacity: 600 } }).expect(201)).body.id;
    const a = await customer('9833333333');
    const body = (eventId: string, guests: number) => ({ eventId, serviceId: svc, startsAt: at(DAY, '19:00'), endsAt: at(DAY, '23:00'), guestCount: guests, answers: { menu: 'veg' } });
    expect((await as(a.token).post('/v1/quotes', { ...body(a.eventId, 400), answers: {} }).expect(400)).body.error.code).toBe('ANSWER_REQUIRED');
    expect((await as(a.token).post('/v1/quotes', body(a.eventId, 10)).expect(400)).body.error.code).toBe('QUANTITY_OUT_OF_RANGE');
    const q = (await as(a.token).post('/v1/quotes', body(a.eventId, 400)).expect(200)).body;
    expect(q.subtotalPaise).toBe(400 * 45_000);
    await as(a.token).post('/v1/engine-bookings', body(a.eventId, 400)).expect(201);
    const b = await customer('9844444444');
    expect((await as(b.token).post('/v1/engine-bookings', body(b.eventId, 300)).expect(409)).body.error).toMatchObject({ code: 'NOT_AVAILABLE', available: 200 });
    await as(b.token).post('/v1/engine-bookings', body(b.eventId, 200)).expect(201);
  });

  it('staff: workers from the vendor\'s staff pool, never more than they have at once', async () => {
    const v = await vendor('9811111111', 'bartender');
    const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'Waiters', pricing: { model: 'hourly', ratePaise: 30_000 } }).expect(201)).body.id;
    const a = await customer('9833333333');
    const body = (eventId: string, n: number) => ({ eventId, serviceId: svc, startsAt: at(DAY, '18:00'), endsAt: at(DAY, '23:00'), quantity: n });
    expect((await as(a.token).post('/v1/quotes', body(a.eventId, 2)).expect(409)).body.error.code).toBe('SERVICE_NOT_CONFIGURED');
    for (const name of ['Raju', 'Mohan', 'Shyam']) await as(v.token).post('/v1/partner/resources', { kind: 'staff', name, attributes: { role: 'waiter' } }).expect(201);
    const q = (await as(a.token).post('/v1/quotes', body(a.eventId, 2)).expect(200)).body;
    expect(q.subtotalPaise).toBe(2 * 5 * 30_000);
    await as(a.token).post('/v1/engine-bookings', body(a.eventId, 2)).expect(201);
    const b = await customer('9844444444');
    expect((await as(b.token).post('/v1/engine-bookings', body(b.eventId, 2)).expect(409)).body.error).toMatchObject({ code: 'NOT_AVAILABLE', available: 1 });
    // A later shift is free again.
    await as(b.token).post('/v1/engine-bookings', { ...body(b.eventId, 3), startsAt: at(NEXT, '10:00'), endsAt: at(NEXT, '16:00') }).expect(201);
  });

  it('makeup: people × minutes each, early-morning fee, one artist at a time', async () => {
    const v = await vendor('9811111111', 'makeup');
    const artist = (await as(v.token).post('/v1/partner/resources', { kind: 'artist', name: 'Priya', attributes: { speciality: 'Bridal' } }).expect(201)).body.id;
    const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'Bridal + family', pricing: { model: 'per_person', ratePaise: 500_000, earlyMorningPaise: 100_000 }, resourceId: artist }).expect(201)).body.id;
    const a = await customer('9833333333');
    const body = (eventId: string, start: string, people: number) => ({ eventId, serviceId: svc, startsAt: at(DAY, start), people, answers: { service: 'bridal' } });
    const q = (await as(a.token).post('/v1/quotes', body(a.eventId, '05:30', 3)).expect(200)).body;
    expect(q.endsAt).toBe(new Date(at(DAY, '08:30')).toISOString());
    expect(q.subtotalPaise).toBe(3 * 500_000 + 100_000);
    await as(a.token).post('/v1/engine-bookings', body(a.eventId, '05:30', 3)).expect(201);
    const b = await customer('9844444444');
    expect((await as(b.token).post('/v1/engine-bookings', body(b.eventId, '08:30', 1)).expect(409)).body.error.code).toBe('NOT_AVAILABLE'); // 30 min buffer
    await as(b.token).post('/v1/engine-bookings', body(b.eventId, '09:00', 1)).expect(201);
  });

  it('quotation: the vendor prices the request; amounts follow that price', async () => {
    const v = await vendor('9811111111', 'planner');
    const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'Full planning', pricing: { model: 'quote', ratePaise: 0 } }).expect(201)).body.id;
    const a = await customer('9833333333');
    const body = { eventId: a.eventId, serviceId: svc, startsAt: at(DAY, '10:00'), answers: { needs: '300 guests, sangeet and wedding' } };
    const q = (await as(a.token).post('/v1/quotes', body).expect(200)).body;
    expect(q).toMatchObject({ priceKind: 'indicative', totalPaise: 0, approval: 'vendor' });
    const id = (await as(a.token).post('/v1/engine-bookings', body).expect(201)).body.id;
    expect((await as(v.token).post(`/v1/partner/bookings/${id}/accept`).expect(400)).body.error.code).toBe('QUOTE_PRICE_REQUIRED');
    await as(v.token).post(`/v1/partner/bookings/${id}/accept`, { pricePaise: 20_000_000 }).expect(200);
    const b = (await as(a.token).get(`/v1/bookings/${id}`).expect(200)).body;
    expect(b).toMatchObject({ status: 'accepted', amountPaise: 20_000_000, advancePaise: 5_000_000 });
    await as(a.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    expect((await as(a.token).get(`/v1/bookings/${id}`).expect(200)).body.status).toBe('confirmed');
  });

  describe('changes', () => {
    const djSetup = async () => {
      const v = await vendor('9811111111', 'dj');
      const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 } }).expect(201)).body.id;
      return { v, svc };
    };
    const djBody = (eventId: string, svc: string, from: string, until: string) => ({ eventId, serviceId: svc, startsAt: from, endsAt: until, answers: { occasion: 'sangeet' } });

    it('extension: priced with the agreed rate, refused when the next booking is in the way, the old booking unchanged', async () => {
      const { v, svc } = await djSetup();
      const a = await customer('9833333333');
      const id = await confirm(v.token, a, djBody(a.eventId, svc, at(DAY, '18:00'), at(DAY, '22:00')));
      // The vendor raises the price later; the extension still uses ₹3,000 an hour.
      await t.db.query(`UPDATE services SET pricing = jsonb_set(pricing, '{ratePaise}', '900000') WHERE id = $1`, [svc]);
      const change = (await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(DAY, '23:59') }).expect(201)).body;
      expect(change.priceDiffPaise).toBe(2 * 300_000);
      expect((await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(NEXT, '00:30') }).expect(409)).body.error.code).toBe('CHANGE_PENDING');

      // Meanwhile someone books the DJ from midnight (after the 1 h pack-up); the vendor's approval fails, nothing moves.
      await t.db.query(`UPDATE services SET pricing = jsonb_set(pricing, '{ratePaise}', '300000') WHERE id = $1`, [svc]);
      const b = await customer('9844444444');
      await confirm(v.token, b, djBody(b.eventId, svc, at(NEXT, '02:00'), at(NEXT, '05:00')));
      expect((await as(v.token).post(`/v1/partner/bookings/${id}/changes/${change.id}/approve`).expect(409)).body.error.code).toBe('NOT_AVAILABLE');
      const still = (await as(a.token).get(`/v1/bookings/${id}`).expect(200)).body;
      expect(still.endsAt).toBe(new Date(at(DAY, '22:00')).toISOString());
      expect((await t.db.query(`SELECT 1 FROM reservations WHERE booking_id = $1 AND status = 'active'`, [id])).rowCount).toBe(1);

      // A shorter extension that fits is asked for and approved; the price goes up by one hour.
      await as(a.token).post(`/v1/bookings/${id}/changes/${change.id}/cancel`).expect(204);
      const fits = (await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(DAY, '23:00') }).expect(201)).body;
      await as(v.token).post(`/v1/partner/bookings/${id}/changes/${fits.id}/approve`).expect(200);
      const after = (await as(a.token).get(`/v1/bookings/${id}`).expect(200)).body;
      expect(after.amountPaise).toBe(still.amountPaise + 300_000);
      expect(after.endsAt).toBe(new Date(at(DAY, '23:00')).toISOString());
    });

    it('reschedule: the new time is taken and the old one freed in one step; a cheaper change refunds what was overpaid', async () => {
      const { v, svc } = await djSetup();
      const a = await customer('9833333333');
      const id = await confirm(v.token, a, djBody(a.eventId, svc, at(DAY, '18:00'), at(DAY, '22:00')));
      await as(a.token).post(`/v1/bookings/${id}/pay/dev?part=balance`).expect(200); // ₹12,000 paid in full
      const change = (await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'reschedule', startsAt: at(NEXT, '19:00'), endsAt: at(NEXT, '21:00'), reason: 'Sangeet moved' }).expect(201)).body;
      expect(change.priceDiffPaise).toBe(-600_000);
      const other = await customer('9844444444');
      // Until approved, the old time is still held.
      await as(other.token).post('/v1/quotes', djBody(other.eventId, svc, at(DAY, '18:00'), at(DAY, '22:00'))).expect(409);
      const stranger = await vendor('9822222222', 'dj');
      await as(stranger.token).post(`/v1/partner/bookings/${id}/changes/${change.id}/approve`).expect(404);
      await as(v.token).post(`/v1/partner/bookings/${id}/changes/${change.id}/approve`).expect(200);
      await as(other.token).post('/v1/quotes', djBody(other.eventId, svc, at(DAY, '18:00'), at(DAY, '22:00'))).expect(200);
      await as(other.token).post('/v1/quotes', djBody(other.eventId, svc, at(NEXT, '19:00'), at(NEXT, '21:00'))).expect(409);
      const b = (await as(a.token).get(`/v1/bookings/${id}`).expect(200)).body;
      expect(b).toMatchObject({ amountPaise: 600_000, day: NEXT });
      expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([600_000]);
    });

    it('reschedules only before the start; slot bookings and strangers cannot ask', async () => {
      const { v, svc } = await djSetup();
      const a = await customer('9833333333');
      const id = await confirm(v.token, a, djBody(a.eventId, svc, at(DAY, '18:00'), at(DAY, '22:00')));
      const stranger = await customer('9855555555');
      await as(stranger.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(DAY, '23:00') }).expect(404);
      await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(DAY, '21:00') }).expect(400);
      await t.db.query(`UPDATE bookings SET fulfilment = 'in_progress' WHERE id = $1`, [id]);
      expect((await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'reschedule', startsAt: at(NEXT, '18:00'), endsAt: at(NEXT, '20:00') }).expect(409)).body.error.code).toBe('BOOKING_IN_PROGRESS');
      const old = (await as(v.token).post('/v1/partner/services', { title: 'Old DJ', pricePaise: 1_000_000, unit: 'per_event' }).expect(201)).body;
      const slot = (await as(a.token).post('/v1/bookings', { eventId: a.eventId, vendorId: v.id, serviceId: old.id, slot: 'day' }).expect(201)).body;
      expect((await as(a.token).post(`/v1/bookings/${slot.id}/changes`, { kind: 'extension', endsAt: at(DAY, '23:00') }).expect(409)).body.error.code).toBe('CHANGE_NOT_SUPPORTED');
    });

    it('a rental extension keeps the stock counted and charges the agreed daily rent', async () => {
      const v = await vendor('9811111111', 'tent');
      const cat = (await as(v.token).get('/v1/partner/item-categories').expect(200)).body.items.find((c: { key: string }) => c.key === 'furniture').id;
      const sofa = (await as(v.token).post('/v1/partner/inventory', { name: 'Sofa', categoryId: cat, rentPaise: 100_000, rentPer: 'day', totalQty: 4 }).expect(201)).body;
      const serviceId = (await t.db.one(t.db, `SELECT id FROM services WHERE vendor_id = $1 AND booking_type = 'rental'`, [v.id])).id;
      const a = await customer('9833333333');
      const id = await confirm(v.token, a, { eventId: a.eventId, serviceId, startsAt: at(DAY, '10:00'), endsAt: at(NEXT, '10:00'), lines: [{ itemId: sofa.id, qty: 2 }] });
      await as(v.token).post('/v1/partner/inventory/' + sofa.id, {}).expect(404);
      const ch = (await as(a.token).post(`/v1/bookings/${id}/changes`, { kind: 'extension', endsAt: at(inDays(14), '10:00') }).expect(201)).body;
      expect(ch.priceDiffPaise).toBe(2 * 100_000);
      await as(v.token).post(`/v1/partner/bookings/${id}/changes/${ch.id}/approve`).expect(200);
      const line = (await as(a.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.lines[0];
      expect(line.unitPaise).toBe(200_000);
      expect((await t.db.one(t.db, `SELECT sum(qty)::int AS n FROM capacity_holds WHERE booking_id = $1 AND status = 'active'`, [id])).n).toBe(2);
    });
  });
});
