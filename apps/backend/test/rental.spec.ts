// Tent house / bartan rentals and vendor-managed inventory: listing items, pricing, stock by date,
// races, edits that must not break bookings, and the whole dispatch → return → deposit trip.
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { signParams } from '../src/media/cloudinary.service';
import { createTestApp, TestApp } from './helpers';

/** What Cloudinary returns for an upload signed with the test secret. */
const signed = (publicId: string) => ({ publicId, version: 1, signature: signParams({ public_id: publicId, version: 1 }, 'test-secret') });

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;

describe('rentals and inventory', () => {
  let t: TestApp;
  let bookings: BookingsService;
  let gateway: FakeGateway;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let categories: { id: string; key: string | null }[];
  const DAY = inDays(10);
  const NEXT = inDays(11);

  beforeAll(async () => {
    t = await createTestApp();
    bookings = t.app.get(BookingsService);
    gateway = t.app.get(PAYMENT_GATEWAY);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object = {}) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    del: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });
  const cat = (key: string) => categories.find((c) => c.key === key)!.id;

  const makeVendor = async (phone: string, name: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const tent = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'tent'`)).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: name, categoryId: tent, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.4358, lng = 81.8463 WHERE id = $1`, [id]);
    return { token, id };
  };

  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
    ({ token: vendorToken, id: vendorId } = await makeVendor('9811111111', 'Shree Tent House'));
    categories = (await as(vendorToken).get('/v1/partner/item-categories').expect(200)).body.items;
  });

  const addItem = (body: object = {}, token = vendorToken) =>
    as(token).post('/v1/partner/inventory', {
      name: 'Plastic chair', categoryId: cat('furniture'), unit: 'piece', rentPaise: 1_000, totalQty: 100,
      depositPaise: 500, damagePaise: 30_000, ...body,
    });

  const customer = async (phone: string) => {
    const token = (await t.login(phone)).body.accessToken;
    const event = (await as(token).post('/v1/events', {
      title: 'Shaadi', eventType: 'wedding', eventDate: DAY, cityId, venueAddress: 'Civil Lines, Prayagraj', venueLat: 25.45, venueLng: 81.85,
    }).expect(201)).body;
    return { token, eventId: event.id as string };
  };

  const serviceId = async () => (await t.db.one(t.db, `SELECT id FROM services WHERE vendor_id = $1 AND booking_type = 'rental'`, [vendorId])).id as string;

  const rentalBody = async (eventId: string, lines: { itemId: string; qty: number }[], from = at(DAY, '10:00'), until = at(NEXT, '10:00')) => ({
    eventId, serviceId: await serviceId(), startsAt: from, endsAt: until, lines,
  });

  /** Request → vendor accepts → advance paid. */
  const book = async (c: { token: string; eventId: string }, lines: { itemId: string; qty: number }[], from?: string, until?: string) => {
    const id = (await as(c.token).post('/v1/engine-bookings', await rentalBody(c.eventId, lines, from, until)).expect(201)).body.id as string;
    await as(vendorToken).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    return id;
  };

  const used = async (itemId: string) =>
    (await t.db.one(t.db, `SELECT COALESCE(sum(qty), 0)::int AS n FROM capacity_holds WHERE pool_key = $1 AND status IN ('hold', 'active')`, [`item:${itemId}`])).n;

  // ---------- vendor item management ----------

  describe('items', () => {
    it('has the six default categories and takes the vendor\'s own', async () => {
      expect(categories.map((c) => c.key)).toEqual(['tent_decor', 'furniture', 'cooking', 'dining', 'serving', 'equipment']);
      const own = (await as(vendorToken).post('/v1/partner/item-categories', { nameEn: 'Mandap sets' }).expect(201)).body;
      expect(own.isCustom).toBe(true);
      await as(vendorToken).post('/v1/partner/item-categories', { nameEn: 'mandap  sets' }).expect(409);
      const item = (await addItem({ name: 'Golden mandap', categoryId: own.id, unit: 'set', rentPaise: 500_000 }).expect(201)).body;
      expect(item.categoryName).toBe('Mandap sets');
      // Removing the category keeps the item, under "Other event equipment".
      await as(vendorToken).del(`/v1/partner/item-categories/${own.id}`).expect(204);
      expect((await as(vendorToken).get(`/v1/partner/inventory/${item.id}`).expect(200)).body.categoryId).toBe(cat('equipment'));
    });

    it('adds an item with quality, condition, custom unit and details, and validates it on the server', async () => {
      const item = (await addItem({
        name: 'Steel deg (50 kg)', categoryId: cat('cooking'), unit: 'deg', rentPaise: 40_000, rentPer: 'day', totalQty: 6,
        quality: 'premium', condition: 'new', minDays: 1, maxDays: 5, attributes: { capacityKg: 50, material: 'steel' },
      }).expect(201)).body;
      expect(item).toMatchObject({ unit: 'deg', rentPer: 'day', quality: 'premium', condition: 'new', attributes: { capacityKg: 50 } });
      const list = (await as(vendorToken).get('/v1/partner/inventory?q=deg').expect(200)).body.items;
      expect(list).toHaveLength(1);
      expect(list[0].availableNow).toBe(6);

      expect((await addItem({ name: 'X', quality: 'custom' }).expect(400)).body.error.code).toBe('VALIDATION');
      expect((await addItem({ name: 'Custom grade', quality: 'custom' }).expect(400)).body.error.field).toBe('qualityLabel');
      expect((await addItem({ name: 'Too many in repair', totalQty: 5, repairQty: 6 }).expect(400)).body.error.field).toBe('repairQty');
      expect((await addItem({ name: 'Free chair', rentPaise: 0 }).expect(400)).body.error.code).toBe('VALIDATION');
      expect((await addItem({ name: 'Negative', totalQty: -1 }).expect(400)).body.error.code).toBe('VALIDATION');
      expect((await addItem({ name: 'Bad days', minDays: 3, maxDays: 2 }).expect(400)).body.error.field).toBe('maxDays');
      expect((await addItem({ name: 'Plastic chair' }).expect(201)));
      expect((await addItem({ name: 'plastic chair' }).expect(409)).body.error.code).toBe('ITEM_EXISTS');
      expect((await addItem({ name: 'Unknown category', categoryId: '00000000-0000-4000-8000-000000000000' }).expect(400)).body.error.code).toBe('CATEGORY_NOT_FOUND');
    });

    it('one vendor can never see, change or delete another vendor\'s items or categories', async () => {
      const mine = (await addItem().expect(201)).body;
      const own = (await as(vendorToken).post('/v1/partner/item-categories', { nameEn: 'Mine only' }).expect(201)).body;
      const other = await makeVendor('9822222222', 'Other Tent');
      await as(other.token).get(`/v1/partner/inventory/${mine.id}`).expect(404);
      await as(other.token).patch(`/v1/partner/inventory/${mine.id}`, { rentPaise: 100 }).expect(404);
      await as(other.token).del(`/v1/partner/inventory/${mine.id}`).expect(404);
      await as(other.token).post(`/v1/partner/inventory/${mine.id}/blocks`, { from: at(DAY, '00:00'), until: at(NEXT, '00:00'), qty: 1, note: 'xx' }).expect(404);
      await as(other.token).del(`/v1/partner/item-categories/${own.id}`).expect(404);
      expect((await addItem({ categoryId: own.id }, other.token).expect(400)).body.error.code).toBe('CATEGORY_NOT_FOUND');
      expect((await as(other.token).get('/v1/partner/inventory').expect(200)).body.items).toHaveLength(0);
      // Customers cannot use partner routes at all.
      const c = await customer('9833333333');
      expect((await as(c.token).get('/v1/partner/inventory').expect(403)).body.error.code).toBe('PARTNER_APP_ONLY');
      expect((await as(vendorToken).get(`/v1/partner/inventory/${mine.id}`).expect(200)).body.rentPaise).toBe(1_000);
    });

    it('deletes an unused item for good, archives one with bookings, and keeps those bookings intact', async () => {
      const unused = (await addItem({ name: 'Unused' }).expect(201)).body;
      expect((await as(vendorToken).del(`/v1/partner/inventory/${unused.id}`).expect(200)).body).toEqual({ result: 'deleted', openBookings: 0 });
      expect((await t.db.query('SELECT 1 FROM inventory_items WHERE id = $1', [unused.id])).rowCount).toBe(0);

      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      const id = await book(c, [{ itemId: chair.id, qty: 40 }]);
      expect((await as(vendorToken).del(`/v1/partner/inventory/${chair.id}`).expect(200)).body).toEqual({ result: 'archived', openBookings: 1 });
      await as(vendorToken).get(`/v1/partner/inventory/${chair.id}`).expect(404);
      // Gone from the shop, not bookable, but the booking and its hold stand.
      const shop = (await t.http().get(`/v1/vendors/${vendorId}/rentals`).expect(200)).body;
      expect(shop.items).toHaveLength(0);
      const c2 = await customer('9844444444');
      expect((await as(c2.token).post('/v1/engine-bookings', await rentalBody(c2.eventId, [{ itemId: chair.id, qty: 1 }])).expect(400)).body.error.code).toBe('ITEM_NOT_FOUND');
      const lines = (await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.lines;
      expect(lines[0]).toMatchObject({ qty: 40, item: { name: 'Plastic chair' } });
      expect(await used(chair.id)).toBe(40);
    });

    it('deactivated or needs-repair items cannot be newly booked', async () => {
      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { isActive: false }).expect(200);
      expect((await t.http().get(`/v1/vendors/${vendorId}/rentals`).expect(200)).body.items).toHaveLength(0);
      expect((await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 1 }])).expect(400)).body.error.code).toBe('ITEM_NOT_FOUND');
      await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { isActive: true, condition: 'needs_repair' }).expect(200);
      expect((await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 1 }])).expect(400)).body.error.code).toBe('ITEM_NOT_FOUND');
      await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { condition: 'good' }).expect(200);
      await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 1 }])).expect(200);
    });
  });

  // ---------- customer: catalogue, price, booking ----------

  describe('booking', () => {
    it('shows active items with photos, quality and availability, and quotes rent × qty × days, delivery and deposit', async () => {
      await as(vendorToken).put('/v1/partner/rental-settings', { deliveryFeePaise: 50_000, minOrderPaise: 0 }).expect(200);
      const chair = (await addItem().expect(201)).body;
      const deg = (await addItem({ name: 'Deg', categoryId: cat('cooking'), unit: 'piece', rentPaise: 20_000, rentPer: 'day', totalQty: 4, depositPaise: 100_000, quality: 'premium' }).expect(201)).body;
      await t.db.query(
        `INSERT INTO media (vendor_id, type, public_id, width, height, bytes, file_hash, status, inventory_item_id) VALUES ($1, 'photo', 'p1', 10, 10, 10, 'h1', 'approved', $2), ($1, 'photo', 'p2', 10, 10, 10, 'h2', 'pending', $2)`,
        [vendorId, deg.id],
      );
      const shop = (await t.http().get(`/v1/vendors/${vendorId}/rentals?from=${encodeURIComponent(at(DAY, '10:00'))}&until=${encodeURIComponent(at(NEXT, '18:00'))}`).expect(200)).body;
      expect(shop.categories.map((c: { itemCount: number }) => c.itemCount)).toEqual([1, 1]);
      const shownDeg = shop.items.find((i: { id: string }) => i.id === deg.id);
      expect(shownDeg).toMatchObject({ quality: 'premium', available: 4, stock: 4, rentPaise: 20_000, rentPer: 'day' });
      expect(shownDeg.photos.map((p: { publicId: string }) => p.publicId)).toEqual(['p1']); // pending photos are not public
      expect(shownDeg.repairQty).toBeUndefined();
      expect((await t.http().get(`/v1/vendors/${vendorId}`).expect(200)).body.rentalItemCount).toBe(2);

      const c = await customer('9833333333');
      // 10:00 today+10 → 18:00 today+11: 32 h = 2 days for per-day items.
      const q = (await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 50 }, { itemId: deg.id, qty: 2 }], at(DAY, '10:00'), at(NEXT, '18:00'))).expect(200)).body;
      const amount = (code: string) => q.lines.find((l: { code: string }) => l.code === code)?.amountPaise;
      expect(amount('base')).toBe(50_000); // delivery and setup
      expect(amount(`item_${chair.id}`)).toBe(50 * 1_000);
      expect(amount(`item_${deg.id}`)).toBe(2 * 2 * 20_000);
      expect(q.depositPaise).toBe(50 * 500 + 2 * 100_000);
      expect(q.totalPaise).toBe(50_000 + 50_000 + 80_000);
      expect(q.advancePaise + q.balancePaise).toBe(q.totalPaise);
    });

    it('checks quantities on the server', async () => {
      const chair = (await addItem({ minQty: 10, maxQty: 80 }).expect(201)).body;
      const c = await customer('9833333333');
      const sid = await serviceId();
      const body = (qty: number) => ({ eventId: c.eventId, serviceId: sid, startsAt: at(DAY, '10:00'), endsAt: at(NEXT, '10:00'), lines: [{ itemId: chair.id, qty }] });
      const quote = (qty: number) => as(c.token).post('/v1/quotes', body(qty));
      expect((await quote(5).expect(400)).body.error.code).toBe('QUANTITY_OUT_OF_RANGE');
      expect((await quote(81).expect(400)).body.error.code).toBe('QUANTITY_OUT_OF_RANGE');
      expect((await quote(0).expect(400)).body.error.code).toBe('VALIDATION');
      await quote(80).expect(200);
      await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { maxQty: null, totalQty: 50 }).expect(200);
      expect((await quote(60).expect(409)).body.error.code).toBe('NOT_AVAILABLE');
      const both = await rentalBody(c.eventId, [{ itemId: chair.id, qty: 10 }, { itemId: chair.id, qty: 10 }]);
      await as(c.token).post('/v1/quotes', both).expect(400);
    });

    it('holds stock by date: overlapping bookings share it, other dates are free', async () => {
      const chair = (await addItem().expect(201)).body;
      const a = await customer('9833333333');
      await book(a, [{ itemId: chair.id, qty: 70 }]);
      const b = await customer('9844444444');
      const clash = (await as(b.token).post('/v1/engine-bookings', await rentalBody(b.eventId, [{ itemId: chair.id, qty: 40 }])).expect(409)).body.error;
      expect(clash).toMatchObject({ code: 'NOT_AVAILABLE', available: 30, requested: 40 });
      await as(b.token).post('/v1/engine-bookings', await rentalBody(b.eventId, [{ itemId: chair.id, qty: 30 }])).expect(201);
      // Three days later the chairs are back (4 h cleaning buffer included) and all 100 are free.
      const later = inDays(14);
      await t.db.query('UPDATE events SET event_date = $2 WHERE id = $1', [b.eventId, later]);
      await as(b.token).post('/v1/quotes', await rentalBody(b.eventId, [{ itemId: chair.id, qty: 100 }], at(later, '10:00'), at(later, '22:00'))).expect(200);
      // Ends at 10:00 + 4 h buffer: a pickup at 12:00 the same day still clashes.
      const shop = (await t.http().get(`/v1/vendors/${vendorId}/rentals?from=${encodeURIComponent(at(NEXT, '12:00'))}&until=${encodeURIComponent(at(NEXT, '20:00'))}`).expect(200)).body;
      expect(shop.items[0].available).toBe(0);
    });

    it('two customers grabbing the last stock at the same moment: exactly one gets it', async () => {
      const chair = (await addItem().expect(201)).body;
      const people = await Promise.all(['9833333333', '9844444444', '9855555555'].map(customer));
      const results = await Promise.all(people.map(async (p) => as(p.token).post('/v1/engine-bookings', await rentalBody(p.eventId, [{ itemId: chair.id, qty: 60 }]))));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await used(chair.id)).toBe(60);
    });

    it('a repeated request with the same Idempotency-Key makes one booking', async () => {
      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      const body = await rentalBody(c.eventId, [{ itemId: chair.id, qty: 10 }]);
      const send = () => t.http().post('/v1/engine-bookings').set('Authorization', `Bearer ${c.token}`).set('Idempotency-Key', 'tap-1234567').send(body);
      const ids = (await Promise.all([send(), send()])).map((r) => r.body.id);
      expect(new Set(ids).size).toBe(1);
      expect(await used(chair.id)).toBe(10);
    });

    it('keeps the agreed price and details when the vendor edits the listing later', async () => {
      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      const id = await book(c, [{ itemId: chair.id, qty: 10 }]);
      const before = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
      await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { name: 'Cushion chair', rentPaise: 5_000, damagePaise: 90_000, quality: 'premium' }).expect(200);
      const after = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
      expect(after.amountPaise).toBe(before.amountPaise);
      const line = (await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.lines[0];
      expect(line).toMatchObject({ unitPaise: 1_000, damagePaise: 30_000, item: { name: 'Plastic chair', quality: 'standard' } });
      // New quotes use the new price.
      const q = (await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 10 }])).expect(200)).body;
      expect(q.lines.find((l: { code: string }) => l.code === `item_${chair.id}`).amountPaise).toBe(50_000);
    });

    it('stock cannot drop below what bookings hold at the busiest moment ahead', async () => {
      const chair = (await addItem().expect(201)).body;
      await book(await customer('9833333333'), [{ itemId: chair.id, qty: 60 }]);
      const err = (await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { totalQty: 50 }).expect(409)).body.error;
      expect(err).toMatchObject({ code: 'STOCK_COMMITTED', committed: 60, minTotalQty: 60 });
      expect((await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { totalQty: 70, repairQty: 20 }).expect(409)).body.error.minTotalQty).toBe(80);
      const ok = (await as(vendorToken).patch(`/v1/partner/inventory/${chair.id}`, { totalQty: 60 }).expect(200)).body;
      expect(ok.totalQty).toBe(60);
      const moves = (await as(vendorToken).get(`/v1/partner/inventory/${chair.id}/movements`).expect(200)).body.items;
      expect(moves.map((m: { kind: string; qty: number }) => [m.kind, m.qty])).toEqual([['removed', 40], ['added', 100]]);
    });

    it('vendor date blocks take stock out for those dates only', async () => {
      const chair = (await addItem().expect(201)).body;
      const block = (await as(vendorToken).post(`/v1/partner/inventory/${chair.id}/blocks`, { from: at(DAY, '00:00'), until: at(NEXT, '23:00'), qty: 90, note: 'Own family function' }).expect(201)).body;
      await as(vendorToken).post(`/v1/partner/inventory/${chair.id}/blocks`, { from: at(DAY, '00:00'), until: at(NEXT, '23:00'), qty: 11, note: 'Too many' }).expect(409);
      const c = await customer('9833333333');
      expect((await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 20 }])).expect(409)).body.error.available).toBe(10);
      await as(vendorToken).del(`/v1/partner/inventory/${chair.id}/blocks/${block.id}`).expect(204);
      await as(c.token).post('/v1/quotes', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 20 }])).expect(200);
    });

    it('cancellation and expiry give the stock back', async () => {
      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      const id = await book(c, [{ itemId: chair.id, qty: 100 }]);
      expect(await used(chair.id)).toBe(100);
      await as(c.token).post(`/v1/bookings/${id}/cancel`, { reason: 'Plan changed' }).expect(200);
      expect(await used(chair.id)).toBe(0);

      const c2 = await customer('9844444444');
      const id2 = (await as(c2.token).post('/v1/engine-bookings', await rentalBody(c2.eventId, [{ itemId: chair.id, qty: 100 }])).expect(201)).body.id;
      expect(await used(chair.id)).toBe(100);
      await t.db.query(`UPDATE bookings SET respond_by = now() - interval '1 minute' WHERE id = $1`, [id2]);
      await bookings.sweep();
      expect((await t.db.one(t.db, 'SELECT status FROM bookings WHERE id = $1', [id2])).status).toBe('expired');
      expect(await used(chair.id)).toBe(0);
    });

    it('a hold that ran out is not trusted even before the sweep runs', async () => {
      const chair = (await addItem().expect(201)).body;
      const c = await customer('9833333333');
      const id = (await as(c.token).post('/v1/engine-bookings', await rentalBody(c.eventId, [{ itemId: chair.id, qty: 100 }])).expect(201)).body.id;
      await t.db.query(`UPDATE capacity_holds SET expires_at = now() - interval '1 second' WHERE booking_id = $1`, [id]);
      const c2 = await customer('9844444444');
      await as(c2.token).post('/v1/quotes', await rentalBody(c2.eventId, [{ itemId: chair.id, qty: 100 }])).expect(200);
    });
  });

  // ---------- dispatch, delivery, return ----------

  describe('fulfilment', () => {
    const setup = async () => {
      const chair = (await addItem().expect(201)).body; // deposit ₹5, damage ₹300
      const plate = (await addItem({ name: 'Steel plate', categoryId: cat('dining'), rentPaise: 500, totalQty: 500, depositPaise: 0, damagePaise: 10_000, missingPaise: 15_000 }).expect(201)).body;
      const c = await customer('9833333333');
      const id = await book(c, [{ itemId: chair.id, qty: 50 }, { itemId: plate.id, qty: 200 }]);
      const lines = (await as(vendorToken).get(`/v1/partner/bookings/${id}/rental`).expect(200)).body.lines;
      const line = (itemId: string) => lines.find((l: { itemId: string }) => l.itemId === itemId).id as string;
      return { chair, plate, c, id, chairLine: line(chair.id), plateLine: line(plate.id) };
    };
    const R = (id: string) => `/v1/partner/bookings/${id}/rental`;

    it('runs prepare → load → dispatch → deliver → return → verify, with stock and money right at every step', async () => {
      const { chair, plate, c, id, chairLine, plateLine } = await setup();
      // Security deposit paid online before dispatch.
      await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=deposit`).expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.deposit).toMatchObject({ requiredPaise: 25_000, paidPaise: 25_000 });

      await as(vendorToken).post(`${R(id)}/prepare`).expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.stage).toBe('preparing');
      await as(vendorToken).post(`${R(id)}/load`, { lines: [{ lineId: chairLine, qty: 51 }] }).expect(400);
      await as(vendorToken).post(`${R(id)}/load`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/deliver`, { lines: [{ lineId: chairLine, qty: 50 }] }).expect(409); // not dispatched yet
      await as(vendorToken).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }], note: 'Truck UP70 1234' }).expect(200);
      // Customers cannot cancel once items are on the way.
      expect((await as(c.token).post(`/v1/bookings/${id}/cancel`, { reason: 'Changed' }).expect(409)).body.error.code).toBe('BOOKING_IN_PROGRESS');
      await as(vendorToken).post(`${R(id)}/deliver`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 201 }] }).expect(400);
      await as(vendorToken).post(`${R(id)}/deliver`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.stage).toBe('delivered');

      // The event ends; the stock is still out until checked back in, so it blocks later dates too.
      await t.db.query(`UPDATE bookings SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' WHERE id = $1`, [id]);
      await t.db.query(`UPDATE capacity_holds SET period = tstzrange(now() - interval '2 days', now() - interval '20 hours') WHERE booking_id = $1`, [id]);
      await bookings.sweep();
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.stage).toBe('return_pending');
      const c2 = await customer('9844444444');
      expect((await as(c2.token).post('/v1/quotes', await rentalBody(c2.eventId, [{ itemId: chair.id, qty: 60 }])).expect(409)).body.error.available).toBe(50);

      // Verify needs a count first; the count must add up.
      expect((await as(vendorToken).post(`${R(id)}/verify`).expect(409)).body.error.code).toBe('RETURN_NOT_COUNTED');
      await as(vendorToken).post(`${R(id)}/return`, { lines: [{ lineId: chairLine, returned: 50, damaged: 0, missing: 0 }] }).expect(400);
      expect((await as(vendorToken).post(`${R(id)}/return`, { lines: [
        { lineId: chairLine, returned: 47, damaged: 2, missing: 0 }, { lineId: plateLine, returned: 190, damaged: 0, missing: 9 },
      ] }).expect(400)).body.error.code).toBe('RETURN_COUNT_MISMATCH');
      expect((await as(vendorToken).post(`${R(id)}/return`, { lines: [
        { lineId: chairLine, returned: 48, damaged: 2, missing: 0, chargePaise: 70_000 }, { lineId: plateLine, returned: 190, damaged: 0, missing: 10 },
      ] }).expect(400)).body.error.code).toBe('CHARGE_TOO_HIGH');
      const counted = (await as(vendorToken).post(`${R(id)}/return`, { lines: [
        { lineId: chairLine, returned: 48, damaged: 2, missing: 0, note: 'Two legs broken' }, { lineId: plateLine, returned: 190, damaged: 0, missing: 10, chargePaise: 100_000 },
      ], photos: [signed(`eventseva/vendors/${vendorId}/media/broken1`)] }).expect(200)).body;
      expect(counted.charges.map((x: { amountPaise: number; kind: string }) => [x.kind, x.amountPaise])).toEqual([['damage', 60_000], ['missing', 100_000]]);
      // Nothing is back in stock until verified.
      expect((await t.db.one(t.db, 'SELECT total_qty, repair_qty FROM inventory_items WHERE id = $1', [chair.id]))).toEqual({ total_qty: 100, repair_qty: 0 });

      await as(vendorToken).post(`${R(id)}/verify`).expect(200);
      expect(await t.db.one(t.db, 'SELECT total_qty, repair_qty FROM inventory_items WHERE id = $1', [chair.id])).toEqual({ total_qty: 100, repair_qty: 2 });
      expect(await t.db.one(t.db, 'SELECT total_qty, repair_qty FROM inventory_items WHERE id = $1', [plate.id])).toEqual({ total_qty: 490, repair_qty: 0 });
      expect(await used(chair.id)).toBe(0);
      expect((await as(c2.token).post('/v1/quotes', await rentalBody(c2.eventId, [{ itemId: chair.id, qty: 99 }])).expect(409)).body.error.available).toBe(98);
      const kinds = (await as(vendorToken).get(`/v1/partner/inventory/${plate.id}/movements`).expect(200)).body.items.map((m: { kind: string; qty: number }) => `${m.kind}:${m.qty}`);
      expect(kinds).toEqual(expect.arrayContaining(['dispatch:200', 'return:190', 'missing:10']));

      // Customer accepts the damage, disputes the missing plates; admin settles at ₹500.
      const charges = (await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.charges;
      await as(c.token).post(`/v1/bookings/${id}/charges/${charges[0].id}`, { decision: 'accept' }).expect(200);
      await as(c.token).post(`/v1/bookings/${id}/charges/${charges[1].id}`, { decision: 'dispute' }).expect(400); // needs a reason
      await as(c.token).post(`/v1/bookings/${id}/charges/${charges[1].id}`, { decision: 'dispute', note: 'Only 4 were missing' }).expect(200);
      await as(c.token).post(`/v1/bookings/${id}/charges/${charges[1].id}`, { decision: 'accept' }).expect(409);
      expect((await t.db.one(t.db, 'SELECT deposit_settled_at FROM bookings WHERE id = $1', [id])).deposit_settled_at).toBeNull();
      const admin = await t.adminLogin('finance');
      await as(admin).post(`/v1/admin/bookings/${id}/charges/${charges[1].id}/resolve`, { amountPaise: 200_000, note: 'More than asked' }).expect(400);
      await as(admin).post(`/v1/admin/bookings/${id}/charges/${charges[1].id}/resolve`, { amountPaise: 50_000, note: '4 plates at the agreed rate (rounded)' }).expect(200);

      // Deposit ₹250 covers part of ₹1,100 agreed: all of it is kept, nothing refunded, rest due to the vendor.
      const view = (await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body;
      expect(view.deposit).toMatchObject({ paidPaise: 25_000, keptPaise: 25_000 });
      expect(view.deposit.settledAt).not.toBeNull();
      expect(view.dueToVendorPaise).toBe(110_000 - 25_000);
      expect(gateway.refunds.filter((r) => r.amountPaise === 0)).toHaveLength(0);

      await bookings.sweep();
      const done = (await as(vendorToken).get(`/v1/partner/bookings/${id}`).expect(200)).body;
      expect(done.status).toBe('completed');
      const payout = (await t.db.one(t.db, 'SELECT amount_paise FROM payouts WHERE booking_id = $1', [id])).amount_paise;
      expect(payout).toBe(done.advancePaise + 25_000 - done.commissionPaise);

      // The customer pays the balance (rest of the rent + ₹850 of charges beyond the deposit) online afterwards;
      // the vendor's payout grows by that amount.
      const due = (await as(c.token).get(`/v1/bookings/${id}/rental`).expect(200)).body.balanceDuePaise;
      expect(due).toBe(done.amountPaise - done.advancePaise + 85_000);
      const order = (await as(c.token).post(`/v1/bookings/${id}/pay?part=balance`).expect(200)).body;
      expect(order.amountPaise).toBe(due);
      await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=balance`).expect(200);
      expect((await t.db.one(t.db, 'SELECT amount_paise FROM payouts WHERE booking_id = $1', [id])).amount_paise).toBe(payout + order.amountPaise);
      await as(c.token).post(`/v1/bookings/${id}/pay?part=balance`).expect(409);
    });

    it('returns the deposit in full when everything comes back fine', async () => {
      const { c, id, chairLine, plateLine } = await setup();
      await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=deposit`).expect(200);
      await as(vendorToken).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/deliver`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/return`, { lines: [{ lineId: chairLine, returned: 50, damaged: 0, missing: 0 }, { lineId: plateLine, returned: 200, damaged: 0, missing: 0 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/verify`).expect(200);
      expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([25_000]);
      expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.stage).toBe('returned_verified');
    });

    it('unanswered charges count as accepted after 48 hours', async () => {
      const { c, id, chairLine, plateLine } = await setup();
      await as(c.token).post(`/v1/bookings/${id}/pay/dev?part=deposit`).expect(200);
      await as(vendorToken).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/deliver`, { lines: [{ lineId: chairLine, qty: 50 }, { lineId: plateLine, qty: 200 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/return`, { lines: [{ lineId: chairLine, returned: 49, damaged: 0, missing: 1, chargePaise: 10_000 }, { lineId: plateLine, returned: 200, damaged: 0, missing: 0 }] }).expect(200);
      await as(vendorToken).post(`${R(id)}/verify`).expect(200);
      await bookings.sweep();
      expect((await t.db.one(t.db, 'SELECT deposit_settled_at FROM bookings WHERE id = $1', [id])).deposit_settled_at).toBeNull();
      await t.db.query(`UPDATE booking_charges SET created_at = now() - interval '49 hours' WHERE booking_id = $1`, [id]);
      await bookings.sweep();
      expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([15_000]);
      expect((await t.db.one(t.db, 'SELECT charges_paise FROM bookings WHERE id = $1', [id])).charges_paise).toBe(10_000);
    });

    it('only the booking\'s own vendor can move it, and only in order', async () => {
      const { c, id, chairLine } = await setup();
      const other = await makeVendor('9822222222', 'Other Tent');
      await as(other.token).get(R(id)).expect(404);
      await as(other.token).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 1 }] }).expect(404);
      await as(c.token).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 1 }] }).expect(403);
      const stranger = await customer('9866666666');
      await as(stranger.token).get(`/v1/bookings/${id}/rental`).expect(404);
      expect((await as(vendorToken).post(`${R(id)}/return`, { lines: [] }).expect(409)).body.error.code).toBe('FULFILMENT_BAD_STEP');
      await as(vendorToken).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 1 }], photos: [signed('eventseva/vendors/someone-else/media/x')] }).expect(403);
      // Own folder but a made-up signature: refused too.
      await as(vendorToken).post(`${R(id)}/dispatch`, { lines: [{ lineId: chairLine, qty: 1 }], photos: [{ ...signed(`eventseva/vendors/${vendorId}/media/x`), signature: 'a'.repeat(40) }] }).expect(403);
    });

    it('the vendor can cancel while preparing (full refund, stock free), not after dispatch', async () => {
      const { chair, id } = await setup();
      await as(vendorToken).post(`${R(id)}/prepare`).expect(200);
      const paid = (await as(vendorToken).get(`/v1/partner/bookings/${id}`).expect(200)).body;
      await as(vendorToken).post(`/v1/partner/bookings/${id}/cancel`, { reason: 'Truck broke down' }).expect(200);
      expect(await used(chair.id)).toBe(0);
      expect(gateway.refunds.map((r) => r.amountPaise)).toEqual([paid.advancePaise]);

      const c2 = await customer('9844444444');
      const id2 = await book(c2, [{ itemId: chair.id, qty: 5 }]);
      const line = (await as(vendorToken).get(R(id2)).expect(200)).body.lines[0].id;
      await as(vendorToken).post(`${R(id2)}/dispatch`, { lines: [{ lineId: line, qty: 5 }] }).expect(200);
      expect((await as(vendorToken).post(`/v1/partner/bookings/${id2}/cancel`, { reason: 'Changed mind' }).expect(409)).body.error.code).toBe('BOOKING_IN_PROGRESS');
    });
  });
});
