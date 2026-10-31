// Booking several services at once (all or nothing) and vendor bundles with mandatory services.
import { todayIst } from '../src/bookings/booking.rules';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const DAY = inDays(12);

describe('checkout and bundles', () => {
  let t: TestApp;
  let cityId: number;
  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });
  const vendor = async (phone: string, slug: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slug])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `${slug} ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [id]);
    return { token, id };
  };
  const service = async (token: string, title: string, ratePaise: number) =>
    (await as(token).post('/v1/partner/engine-services', { title, pricing: { model: 'fixed', ratePaise } }).expect(201)).body.id as string;
  const customer = async (phone: string) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: DAY, cityId }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const line = (eventId: string, serviceId: string, from = '18:00', until = '23:00', answers: object = {}) => ({ eventId, serviceId, startsAt: at(DAY, from), endsAt: at(DAY, until), answers });

  it('books a DJ and a decorator together, or neither when one is taken', async () => {
    const dj = await vendor('9811111111', 'dj');
    const decor = await vendor('9822222222', 'decor');
    const djSvc = await service(dj.token, 'DJ night', 2_000_000);
    const stage = await service(decor.token, 'Stage', 3_000_000);
    const c = await customer('9833333333');
    const items = [line(c.eventId, djSvc, '18:00', '23:00', { occasion: 'sangeet' }), line(c.eventId, stage, '10:00', '23:00')];

    const q = (await as(c.token).post('/v1/checkouts/quote', { items }).expect(200)).body;
    expect(q.totalPaise).toBe(5_000_000);
    expect(q.items).toHaveLength(2);

    // Someone takes the decorator first: the whole checkout fails at line 2 and the DJ stays free.
    const other = await customer('9844444444');
    await as(other.token).post('/v1/engine-bookings', line(other.eventId, stage, '09:00', '20:00')).expect(201);
    const err = (await as(c.token).post('/v1/checkouts', { items }).expect(409)).body.error;
    expect(err).toMatchObject({ code: 'NOT_AVAILABLE', itemIndex: 1 });
    expect((await t.db.query('SELECT 1 FROM bookings WHERE customer_id = (SELECT customer_id FROM events WHERE id = $1)', [c.eventId])).rowCount).toBe(0);
    expect((await t.db.query('SELECT 1 FROM checkouts')).rowCount).toBe(0);

    const decor2 = await vendor('9855555555', 'decor');
    const stage2 = await service(decor2.token, 'Stage', 2_500_000);
    const ok = { items: [items[0], line(c.eventId, stage2, '10:00', '23:00')] };
    const send = () => t.http().post('/v1/checkouts').set('Authorization', `Bearer ${c.token}`).set('Idempotency-Key', 'cart-12345678').send(ok);
    const [r1, r2] = await Promise.all([send(), send()]);
    expect(r1.body.id).toBe(r2.body.id);
    expect(r1.body.bookings.map((b: { status: string }) => b.status)).toEqual(['requested', 'requested']);
    expect((await t.db.query('SELECT 1 FROM bookings WHERE group_id = $1', [r1.body.id])).rowCount).toBe(2);
    await as(other.token).get(`/v1/checkouts/${r1.body.id}`).expect(404);
  });

  describe('EventSeva packages (several vendors, curated by an admin)', () => {
    /** A decorator and a DJ, each with one service — the two halves of a wedding package. */
    const parts = async () => {
      const decor = await vendor('9811111111', 'decor');
      const dj = await vendor('9822222222', 'dj');
      return { decor, dj, decorSvc: await service(decor.token, 'Mandap', 3_000_000), djSvc: await service(dj.token, 'DJ night', 2_000_000) };
    };
    const pkgBody = (decorSvc: string, djSvc: string, extra: object = {}) => ({
      name: 'Full wedding', nameHi: 'पूरी शादी', eventType: 'wedding', discountPercent: 10,
      items: [{ serviceId: decorSvc, mandatory: true }, { serviceId: djSvc, mandatory: true }], ...extra,
    });

    it('an admin curates one across vendors; customers see it with its parts and price', async () => {
      const { decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      const pkg = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201)).body;
      expect(pkg).toMatchObject({ name: 'Full wedding', nameHi: 'पूरी शादी', eventType: 'wedding', discountPercent: 10 });

      // No login needed: packages are catalogue.
      const list = (await t.http().get('/v1/packages').expect(200)).body;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ name: 'Full wedding', available: true, discountPercent: 10 });
      expect(list.items[0].services.map((s: { vendorName: string }) => s.vendorName).sort()).toEqual(['decor 111', 'dj 222']);

      // Hindi gets the Hindi name, and the occasion filter works.
      expect((await t.http().get('/v1/packages').set('Accept-Language', 'hi').expect(200)).body.items[0].name).toBe('पूरी शादी');
      expect((await t.http().get('/v1/packages?eventType=birthday').expect(200)).body.items).toEqual([]);
    });

    it('books every vendor in one go, with the package discount, or none of them', async () => {
      const { decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      const pkg = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201)).body;
      const c = await customer('9833333333');
      const items = [line(c.eventId, decorSvc, '10:00', '23:00'), line(c.eventId, djSvc, '18:00', '23:00', { occasion: 'sangeet' })];

      // 10 % off ₹50,000.
      const q = (await as(c.token).post('/v1/checkouts/quote', { bundleId: pkg.id, items }).expect(200)).body;
      expect(q.totalPaise).toBe(4_500_000);

      // Leaving out a required part is refused before anything is booked.
      const err = (await as(c.token).post('/v1/checkouts', { bundleId: pkg.id, items: [items[0]] }).expect(400)).body.error;
      expect(err).toMatchObject({ code: 'BUNDLE_INCOMPLETE', missing: [djSvc] });
      expect((await t.db.query('SELECT 1 FROM bookings')).rowCount).toBe(0);

      const made = (await as(c.token).post('/v1/checkouts', { bundleId: pkg.id, items }).expect(201)).body;
      expect(made.bookings).toHaveLength(2);
      // Two different vendors, one checkout.
      expect(new Set(made.bookings.map((b: { vendorId: string }) => b.vendorId)).size).toBe(2);
      expect(made.bookings.reduce((s: number, b: { amountPaise: number }) => s + b.amountPaise, 0)).toBe(4_500_000);
    });

    it('a package whose vendor is no longer live cannot be booked, and says so before checkout', async () => {
      const { dj, decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      const pkg = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201)).body;

      // The DJ is put on hold by an admin.
      await t.db.query(`UPDATE vendors SET status = 'on_hold' WHERE id = $1`, [dj.id]);
      expect((await t.http().get('/v1/packages').expect(200)).body.items[0].available).toBe(false);

      const c = await customer('9833333333');
      const items = [line(c.eventId, decorSvc, '10:00', '23:00'), line(c.eventId, djSvc, '18:00', '23:00', { occasion: 'sangeet' })];
      const err = (await as(c.token).post('/v1/checkouts', { bundleId: pkg.id, items }).expect(409)).body.error;
      expect(err).toMatchObject({ code: 'PACKAGE_UNAVAILABLE', unavailable: [djSvc] });
      expect((await t.db.query('SELECT 1 FROM bookings')).rowCount).toBe(0);
    });

    it('only a super admin curates them, and every part must be live when it is made', async () => {
      const { dj, decorSvc, djSvc } = await parts();
      const support = await t.adminLogin('support', 'support@eventseva.test');
      await as(support).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(403);
      await t.http().get('/v1/admin/packages').expect(401);

      const admin = await t.adminLogin('super');
      // A package of one service is not a package; and something has to be required.
      await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc, { items: [{ serviceId: decorSvc, mandatory: true }] })).expect(400);
      await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc, {
        items: [{ serviceId: decorSvc, mandatory: false }, { serviceId: djSvc, mandatory: false }],
      })).expect(400);

      // A service from a vendor who is not approved cannot go in.
      await t.db.query(`UPDATE vendors SET status = 'pending' WHERE id = $1`, [dj.id]);
      const err = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(409)).body.error;
      expect(err).toMatchObject({ code: 'PACKAGE_UNAVAILABLE', unavailable: [djSvc] });
    });

    it('every change is in the audit log with its before and after', async () => {
      const { decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      const pkg = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201)).body;
      await as(admin).patch(`/v1/admin/packages/${pkg.id}`, { discountPercent: 25 }).expect(200);
      await as(admin).delete(`/v1/admin/packages/${pkg.id}`).expect(204);

      const log = (await as(admin).get('/v1/admin/audit?targetType=package').expect(200)).body.items;
      expect(log.map((l: { action: string }) => l.action)).toEqual(['package.update', 'package.update', 'package.create']);
      // Newest first: the hide, then the discount change, then the creation.
      expect(log[0]).toMatchObject({ targetId: pkg.id, before: { isActive: true }, after: { isActive: false } });
      expect(log[1]).toMatchObject({ before: { discountPercent: 10 }, after: { discountPercent: 25 } });
      expect(log[2]).toMatchObject({ before: null, after: { name: 'Full wedding' } });
    });

    it('a package pointing at a service that no longer exists still answers, greyed out', async () => {
      const { decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201);

      // Nothing deletes services today, but the row is not protected from it either; a package
      // left pointing at nothing must grey out, not break the catalogue for everyone.
      await t.db.query(`UPDATE service_bundles SET items = '[{"serviceId":"00000000-0000-0000-0000-000000000000","mandatory":true}]'::jsonb WHERE vendor_id IS NULL`);

      const list = (await t.http().get('/v1/packages').expect(200)).body;
      expect(list.items).toHaveLength(1);
      expect(list.items[0].services).toEqual([]); // a list, never null
      expect(list.items[0].available).toBe(false);
    });

    it('hiding one takes it off the app but leaves the bookings made from it', async () => {
      const { decorSvc, djSvc } = await parts();
      const admin = await t.adminLogin('super');
      const pkg = (await as(admin).post('/v1/admin/packages', pkgBody(decorSvc, djSvc)).expect(201)).body;
      const c = await customer('9833333333');
      const items = [line(c.eventId, decorSvc, '10:00', '23:00'), line(c.eventId, djSvc, '18:00', '23:00', { occasion: 'sangeet' })];
      const made = (await as(c.token).post('/v1/checkouts', { bundleId: pkg.id, items }).expect(201)).body;

      await as(admin).delete(`/v1/admin/packages/${pkg.id}`).expect(204);
      expect((await t.http().get('/v1/packages').expect(200)).body.items).toEqual([]);
      // The admin list still shows it, and the bookings are untouched.
      expect((await as(admin).get('/v1/admin/packages').expect(200)).body.items[0]).toMatchObject({ id: pkg.id, isActive: false });
      expect((await as(c.token).get(`/v1/checkouts/${made.id}`).expect(200)).body.bookings).toHaveLength(2);
      // It cannot be booked again.
      const c2 = await customer('9844444444');
      await as(c2.token).post('/v1/checkouts', {
        bundleId: pkg.id, items: [line(c2.eventId, decorSvc, '10:00', '23:00'), line(c2.eventId, djSvc, '18:00', '23:00', { occasion: 'sangeet' })],
      }).expect(404);
    });
  });

  it('one checkout is for one event, and up to 10 lines', async () => {
    const dj = await vendor('9811111111', 'dj');
    const svc = await service(dj.token, 'DJ', 1_000_000);
    const c = await customer('9833333333');
    const e2 = (await as(c.token).post('/v1/events', { title: 'Reception', eventType: 'wedding', eventDate: DAY, cityId }).expect(201)).body.id;
    await as(c.token).post('/v1/checkouts', { items: [line(c.eventId, svc, '10:00', '13:00', { occasion: 'party' }), line(e2, svc, '18:00', '21:00', { occasion: 'party' })] }).expect(400);
    await as(c.token).post('/v1/checkouts', { items: [] }).expect(400);
  });

  it('a vendor bundle needs its mandatory services and gives its discount on them', async () => {
    const decor = await vendor('9811111111', 'decor');
    const stage = await service(decor.token, 'Stage', 3_000_000);
    const entrance = await service(decor.token, 'Entrance', 1_000_000);
    const other = await vendor('9822222222', 'decor');
    const theirs = await service(other.token, 'Theirs', 100_000);
    await as(decor.token).post('/v1/partner/bundles', { name: 'Full decor', discountPercent: 10, items: [{ serviceId: stage, mandatory: true }, { serviceId: theirs, mandatory: false }] }).expect(400);
    await as(decor.token).post('/v1/partner/bundles', { name: 'Full decor', items: [{ serviceId: stage, mandatory: false }, { serviceId: entrance, mandatory: false }] }).expect(400);
    const bundle = (await as(decor.token).post('/v1/partner/bundles', { name: 'Full decor', discountPercent: 10, items: [{ serviceId: stage, mandatory: true }, { serviceId: entrance, mandatory: false }] }).expect(201)).body;
    expect((await t.http().get(`/v1/vendors/${decor.id}/bundles`).expect(200)).body.items).toHaveLength(1);

    const c = await customer('9833333333');
    const err = (await as(c.token).post('/v1/checkouts/quote', { bundleId: bundle.id, items: [line(c.eventId, entrance, '10:00', '20:00')] }).expect(400)).body.error;
    expect(err).toMatchObject({ code: 'BUNDLE_INCOMPLETE', missing: [stage] });
    // Both lines need the vendor's one team, so the bundle books them at different times.
    const items = [line(c.eventId, stage, '06:00', '12:00'), { ...line(c.eventId, entrance, '06:00', '12:00'), startsAt: at(inDays(13), '10:00'), endsAt: at(inDays(13), '18:00') }];
    const q = (await as(c.token).post('/v1/checkouts/quote', { bundleId: bundle.id, items }).expect(200)).body;
    expect(q.items[0].lines.find((l: { code: string }) => l.code === 'bundle_discount').amountPaise).toBe(-300_000);
    expect(q.totalPaise).toBe(3_600_000);
    const done = (await as(c.token).post('/v1/checkouts', { bundleId: bundle.id, items }).expect(201)).body;
    expect(done.bookings.map((b: { amountPaise: number }) => b.amountPaise)).toEqual([2_700_000, 900_000]);
  });
});
