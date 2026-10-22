import { totpAt } from '../src/admin/totp';
import { hashPassword } from '../src/admin/password';
import { createTestApp, TestApp } from './helpers';

const VENDOR_PHONE = '9811111111';

describe('vendor onboarding and approval', () => {
  let t: TestApp;
  let partner: string;
  let cityId: number;
  let djId: number;
  let hallId: number;

  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
    djId = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    hallId = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'hall'`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    partner = (await t.login(VENDOR_PHONE, 'partner')).body.accessToken;
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  const createVendor = () =>
    as(partner).post('/v1/partner/vendor', { businessName: 'Raj DJ Sound', categoryId: djId, cityId }).expect(201);

  /** A complete profile, ready to send for review. */
  const readyVendor = async () => {
    const { id } = (await createVendor()).body;
    await as(partner)
      .patch('/v1/partner/vendor', { area: 'Civil Lines', about: 'DJ, lights and sound for weddings and parties since 2015.' })
      .expect(200);
    await as(partner).post('/v1/partner/services', { title: 'Wedding DJ (5 hours)', pricePaise: 1_500_000, unit: 'per_event' }).expect(201);
    // One photo; the upload flow itself is covered in media.spec.ts.
    await t.db.query(
      `INSERT INTO media (vendor_id, type, public_id, width, height, bytes, file_hash, status)
       VALUES ($1::uuid, 'photo', 'p/' || $1::text, 1200, 900, 1000, 'h-' || $1::text, 'pending')`,
      [id],
    );
    return (await as(partner).get('/v1/partner/vendor').expect(200)).body;
  };

  describe('Partner app', () => {
    it('only works with a Partner app login', async () => {
      const customer = (await t.login('9822222222')).body.accessToken;
      const res = await as(customer).get('/v1/partner/vendor').expect(403);
      expect(res.body.error.code).toBe('PARTNER_APP_ONLY');
    });

    it('new partner has no profile yet', async () => {
      expect((await as(partner).get('/v1/partner/vendor').expect(404)).body.error.code).toBe('VENDOR_NOT_FOUND');
    });

    it('creates a draft profile with a checklist, only once', async () => {
      const v = (await createVendor()).body;
      expect(v).toMatchObject({
        businessName: 'Raj DJ Sound',
        status: 'draft',
        category: { slug: 'dj' },
        city: { name: 'Prayagraj' },
        missingForReview: ['area', 'about', 'services_or_packages', 'photos'],
      });
      const again = await as(partner).post('/v1/partner/vendor', { businessName: 'Second', categoryId: djId, cityId }).expect(409);
      expect(again.body.error.code).toBe('VENDOR_EXISTS');
    });

    it('rejects unknown category and city', async () => {
      const cat = await as(partner).post('/v1/partner/vendor', { businessName: 'X Y', categoryId: 999, cityId }).expect(400);
      expect(cat.body.error.code).toBe('CATEGORY_NOT_FOUND');
      const city = await as(partner).post('/v1/partner/vendor', { businessName: 'X Y', categoryId: djId, cityId: 999 }).expect(400);
      expect(city.body.error.code).toBe('CITY_NOT_FOUND');
    });

    it('login tells the Partner app the vendor status', async () => {
      await createVendor();
      await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '1 minute'`);
      const res = await t.login(VENDOR_PHONE, 'partner');
      expect(res.body.vendor).toMatchObject({ status: 'draft' });
    });

    it('services: add, edit, delete, with validation', async () => {
      await createVendor();
      const bad = await as(partner).post('/v1/partner/services', { title: 'DJ', pricePaise: 50, unit: 'per_event' }).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION');
      const guests = await as(partner)
        .post('/v1/partner/services', { title: 'Hall', pricePaise: 10000, unit: 'per_shift', minGuests: 500, maxGuests: 100 })
        .expect(400);
      expect(guests.body.error.message).toMatch(/guests/);

      const s = (await as(partner).post('/v1/partner/services', { title: 'DJ night', pricePaise: 800_000, unit: 'per_event' }).expect(201)).body;
      expect(s).toMatchObject({ title: 'DJ night', pricePaise: 800_000, unit: 'per_event', isActive: true });
      const edited = (await as(partner).patch(`/v1/partner/services/${s.id}`, { pricePaise: 900_000 }).expect(200)).body;
      expect(edited).toMatchObject({ title: 'DJ night', pricePaise: 900_000 });
      await as(partner).delete(`/v1/partner/services/${s.id}`).expect(204);
      await as(partner).delete(`/v1/partner/services/${s.id}`).expect(404);
      expect((await as(partner).get('/v1/partner/vendor')).body.services).toEqual([]);
    });

    it('packages: add, edit, delete', async () => {
      await createVendor();
      const p = (await as(partner)
        .post('/v1/partner/packages', { title: 'Gold', items: ['DJ', 'Lights', '5 hours'], pricePaise: 2_500_000 })
        .expect(201)).body;
      expect(p.items).toEqual(['DJ', 'Lights', '5 hours']);
      const edited = (await as(partner).patch(`/v1/partner/packages/${p.id}`, { items: ['DJ', 'Lights', 'Smoke', '6 hours'] }).expect(200)).body;
      expect(edited.items).toHaveLength(4);
      await as(partner).delete(`/v1/partner/packages/${p.id}`).expect(204);
    });

    it("cannot touch another vendor's service", async () => {
      await createVendor();
      const s = (await as(partner).post('/v1/partner/services', { title: 'DJ night', pricePaise: 800_000, unit: 'per_event' })).body;
      const other = (await t.login('9833333333', 'partner')).body.accessToken;
      await as(other).post('/v1/partner/vendor', { businessName: 'Other DJ', categoryId: djId, cityId }).expect(201);
      await as(other).patch(`/v1/partner/services/${s.id}`, { pricePaise: 100 }).expect(404);
      await as(other).delete(`/v1/partner/services/${s.id}`).expect(404);
    });

    it('cannot submit an incomplete profile', async () => {
      await createVendor();
      const res = await as(partner).post('/v1/partner/vendor/submit').expect(400);
      expect(res.body.error).toMatchObject({ code: 'VENDOR_INCOMPLETE', missing: ['area', 'about', 'services_or_packages', 'photos'] });
    });

    it('submit → pending, and the profile is locked during review', async () => {
      await readyVendor();
      const v = (await as(partner).post('/v1/partner/vendor/submit').expect(200)).body;
      expect(v.status).toBe('pending');
      expect((await as(partner).patch('/v1/partner/vendor', { area: 'Naini' }).expect(409)).body.error.code).toBe('VENDOR_UNDER_REVIEW');
      await as(partner).post('/v1/partner/services', { title: 'More', pricePaise: 10000, unit: 'per_hour' }).expect(409);
      expect((await as(partner).post('/v1/partner/vendor/submit').expect(409)).body.error.code).toBe('VENDOR_BAD_STATUS');
    });
  });

  describe('admin', () => {
    it('login needs the right password and 2FA code', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      await t.db.query(`INSERT INTO admin_users (email, password_hash, totp_secret, role) VALUES ($1, $2, $3, 'verifier')`, [
        'priya@eventseva.test',
        await hashPassword('right password 1'),
        secret,
      ]);
      const login = (password: string, totp: string, email = 'priya@eventseva.test') =>
        t.http().post('/v1/admin/login').send({ email, password, totp });

      const wrongTotp = totpAt(secret) === '000000' ? '111111' : '000000';
      expect((await login('wrong password', totpAt(secret)).expect(401)).body.error.code).toBe('ADMIN_LOGIN_FAILED');
      await login('right password 1', wrongTotp).expect(401);
      await login('right password 1', totpAt(secret), 'nobody@eventseva.test').expect(401);
      const ok = (await login('right password 1', totpAt(secret), 'PRIYA@eventseva.test').expect(200)).body;
      expect(ok.admin).toMatchObject({ email: 'priya@eventseva.test', role: 'verifier' });

      // Deactivated admins are locked out of an open session too.
      await t.http().get('/v1/admin/me').set('Authorization', `Bearer ${ok.accessToken}`).expect(200);
      await t.db.query('UPDATE admin_users SET is_active = false');
      await t.http().get('/v1/admin/me').set('Authorization', `Bearer ${ok.accessToken}`).expect(401);
    });

    it('app tokens and admin tokens cannot be swapped', async () => {
      await as(partner).get('/v1/admin/vendors').expect(401);
      const admin = await t.adminLogin();
      await as(admin).get('/v1/me').expect(401);
    });

    it('roles: finance cannot see or approve vendors', async () => {
      const finance = await t.adminLogin('finance');
      expect((await as(finance).get('/v1/admin/vendors').expect(403)).body.error.code).toBe('FORBIDDEN');
      const support = await t.adminLogin('support');
      await as(support).get('/v1/admin/vendors').expect(200);
      const v = await readyVendor();
      await as(partner).post('/v1/partner/vendor/submit').expect(200);
      await as(support).post(`/v1/admin/vendors/${v.id}/approve`).expect(403);
    });

    it('approve: queue → approved → visible to customers, with audit log and notification', async () => {
      const admin = await t.adminLogin();
      const v = await readyVendor();
      await as(partner).post('/v1/partner/vendor/submit').expect(200);

      const queue = (await as(admin).get('/v1/admin/vendors').expect(200)).body;
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({ id: v.id, phone: '+919811111111', category: 'dj', serviceCount: 1, packageCount: 0 });

      // Not public before approval.
      await t.http().get(`/v1/vendors/${v.id}`).expect(404);

      expect((await as(admin).post(`/v1/admin/vendors/${v.id}/approve`).expect(200)).body).toMatchObject({ status: 'approved' });
      expect((await as(admin).post(`/v1/admin/vendors/${v.id}/approve`).expect(409)).body.error.code).toBe('VENDOR_BAD_STATUS');

      const detail = (await as(admin).get(`/v1/admin/vendors/${v.id}`).expect(200)).body;
      expect(detail.owner.phone).toBe('+919811111111');
      expect(detail.history).toEqual([expect.objectContaining({ action: 'vendor.approve', adminEmail: 'verifier@eventseva.test' })]);

      const { rows } = await t.db.query('SELECT kind, title FROM notifications');
      expect(rows).toEqual([{ kind: 'vendor_approved', title: 'Your profile is live' }]);

      const pub = (await t.http().get(`/v1/vendors/${v.id}`).expect(200)).body;
      expect(pub).toMatchObject({ businessName: 'Raj DJ Sound', address: null });
      expect(pub.status).toBeUndefined();
      expect(pub.services).toHaveLength(1);
    });

    it('reject needs a reason; vendor fixes and sends again; notice in Hindi', async () => {
      const admin = await t.adminLogin();
      const v = await readyVendor();
      await as(partner).patch('/v1/me', { language: 'hi' }).expect(200);
      await as(partner).post('/v1/partner/vendor/submit').expect(200);

      await as(admin).post(`/v1/admin/vendors/${v.id}/reject`, {}).expect(400);
      const rejected = (await as(admin).post(`/v1/admin/vendors/${v.id}/reject`, { reason: 'Add a clearer business name' }).expect(200)).body;
      expect(rejected).toMatchObject({ status: 'rejected', rejectReason: 'Add a clearer business name' });

      const mine = (await as(partner).get('/v1/partner/vendor').expect(200)).body;
      expect(mine).toMatchObject({ status: 'rejected', rejectReason: 'Add a clearer business name' });
      const { rows } = await t.db.query('SELECT title, body FROM notifications');
      expect(rows[0].title).toBe('प्रोफ़ाइल में बदलाव ज़रूरी');
      expect(rows[0].body).toContain('Add a clearer business name');

      // Rejected vendors can still change category, then resubmit.
      await as(partner).patch('/v1/partner/vendor', { businessName: 'Raj DJ & Sound Prayagraj', categoryId: hallId }).expect(200);
      const again = (await as(partner).post('/v1/partner/vendor/submit').expect(200)).body;
      expect(again).toMatchObject({ status: 'pending', rejectReason: null, category: { slug: 'hall' } });
    });

    it('hold hides an approved vendor; category is locked once approved', async () => {
      const admin = await t.adminLogin();
      const v = await readyVendor();
      await as(partner).post('/v1/partner/vendor/submit');
      await as(admin).post(`/v1/admin/vendors/${v.id}/approve`).expect(200);

      const locked = await as(partner).patch('/v1/partner/vendor', { categoryId: hallId }).expect(409);
      expect(locked.body.error.code).toBe('CATEGORY_LOCKED');
      await as(partner).patch('/v1/partner/vendor', { area: 'Naini' }).expect(200);

      await as(admin).post(`/v1/admin/vendors/${v.id}/hold`, { reason: 'Customer complaints under check' }).expect(200);
      await t.http().get(`/v1/vendors/${v.id}`).expect(404);
      expect((await t.http().get('/v1/vendors').expect(200)).body.items).toEqual([]);
      await as(admin).post(`/v1/admin/vendors/${v.id}/approve`).expect(200);
      await t.http().get(`/v1/vendors/${v.id}`).expect(200);
    });
  });

  describe('customer listing', () => {
    it('lists only approved vendors, filters by category, starting price, Hindi names', async () => {
      const admin = await t.adminLogin();
      const v = await readyVendor();
      await as(partner).post('/v1/partner/packages', { title: 'Basic', items: ['DJ'], pricePaise: 600_000 }).expect(201);
      await as(partner).post('/v1/partner/vendor/submit');
      await as(admin).post(`/v1/admin/vendors/${v.id}/approve`).expect(200);

      // A second vendor that stays in draft.
      const other = (await t.login('9844444444', 'partner')).body.accessToken;
      await as(other).post('/v1/partner/vendor', { businessName: 'Draft DJ', categoryId: djId, cityId }).expect(201);

      const all = (await t.http().get('/v1/vendors').expect(200)).body;
      expect(all.items).toHaveLength(1);
      expect(all.items[0]).toMatchObject({ id: v.id, startingPricePaise: 600_000, isFeatured: false, category: { slug: 'dj', name: 'DJ & sound' } });
      expect(all.hasMore).toBe(false);

      expect((await t.http().get('/v1/vendors?category=hall').expect(200)).body.items).toEqual([]);
      expect((await t.http().get(`/v1/vendors?category=dj&cityId=${cityId}`).expect(200)).body.items).toHaveLength(1);

      const hi = (await t.http().get('/v1/vendors').set('Accept-Language', 'hi').expect(200)).body;
      expect(hi.items[0].category.name).toBe('डीजे और साउंड');
      await t.http().get('/v1/vendors/not-a-uuid').expect(400);
    });

    it('featured vendors come first', async () => {
      const admin = await t.adminLogin();
      const ids: string[] = [];
      for (const phone of ['9855555551', '9855555552']) {
        partner = (await t.login(phone, 'partner')).body.accessToken;
        ids.push((await readyVendor()).id);
        await as(partner).post('/v1/partner/vendor/submit');
        await as(admin).post(`/v1/admin/vendors/${ids.at(-1)}/approve`).expect(200);
      }
      await t.db.query(`UPDATE vendors SET rating_avg = 4.8 WHERE id = $1`, [ids[0]]);
      await t.db.query(`UPDATE vendors SET featured_until = now() + interval '7 days' WHERE id = $1`, [ids[1]]);
      const items = (await t.http().get('/v1/vendors').expect(200)).body.items;
      expect(items.map((i: { id: string }) => i.id)).toEqual([ids[1], ids[0]]);
      expect(items[0].isFeatured).toBe(true);
    });
  });
});
