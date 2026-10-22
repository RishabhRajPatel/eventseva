import { randomBytes } from 'node:crypto';
import { decrypt, encrypt } from '../src/common/crypto';
import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('encryption at rest', () => {
  it('round-trips, uses a fresh IV, and refuses tampered data or the wrong key', () => {
    const key = randomBytes(32);
    const a = encrypt('123456789012', key);
    expect(a).not.toContain('123456789012');
    expect(encrypt('123456789012', key)).not.toBe(a);
    expect(decrypt(a, key)).toBe('123456789012');
    const parts = a.split(':');
    parts[3] = Buffer.from('999999999999').toString('base64');
    expect(() => decrypt(parts.join(':'), key)).toThrow();
    expect(() => decrypt(a, randomBytes(32))).toThrow();
  });
});

describe('account deletion and vendor bank accounts', () => {
  let t: TestApp;
  let cityId: number;
  let djId: number;

  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities LIMIT 1`)).id;
    djId = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    t.cloudinary.destroyed.length = 0;
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: object) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string, body: object = {}) => t.http().delete(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  async function liveVendor(phone = '9811111111') {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const v = (await as(token).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: djId, cityId, area: 'Naini' }).expect(201)).body;
    const s = (await as(token).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_000_000, unit: 'per_event' }).expect(201)).body;
    await t.db.query(
      `INSERT INTO media (vendor_id, type, public_id, width, height, bytes, file_hash, status) VALUES ($1::uuid, 'photo', 'p/' || $1::text, 10, 10, 1, 'h', 'approved')`,
      [v.id],
    );
    await t.db.query(`UPDATE vendors SET status = 'approved' WHERE id = $1`, [v.id]);
    return { token, vendorId: v.id as string, serviceId: s.id as string };
  }

  async function book(customer: string, vendorId: string, serviceId: string) {
    const event = (await as(customer).post('/v1/events', { title: 'Party', eventType: 'birthday', eventDate: inDays(10), cityId }).expect(201)).body;
    return (await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot: 'day' }).expect(201)).body.id as string;
  }

  it('needs an explicit confirmation', async () => {
    const customer = (await t.login('9822222222')).body.accessToken;
    expect((await as(customer).delete('/v1/me', {}).expect(400)).body.error.code).toBe('VALIDATION');
    await as(customer).delete('/v1/me', { confirm: 'yes' }).expect(400);
  });

  it('is refused while a booking is open, on either side', async () => {
    const vendor = await liveVendor();
    const customer = (await t.login('9822222222')).body.accessToken;
    await book(customer, vendor.vendorId, vendor.serviceId);
    const c = await as(customer).delete('/v1/me', { confirm: 'DELETE' }).expect(409);
    expect(c.body.error).toMatchObject({ code: 'ACCOUNT_HAS_ACTIVE_BOOKINGS', bookings: 1 });
    expect((await as(vendor.token).delete('/v1/me', { confirm: 'DELETE' }).expect(409)).body.error.code).toBe('ACCOUNT_HAS_ACTIVE_BOOKINGS');
  });

  it('customer: logged out everywhere, personal data gone, the number can sign up again fresh', async () => {
    const vendor = await liveVendor();
    const login = (await t.login('9822222222')).body;
    await as(login.accessToken).patch('/v1/me', { name: 'Rahul' });
    await as(login.accessToken).put(`/v1/shortlist/${vendor.vendorId}`, {}).expect(204);
    await as(login.accessToken).post('/v1/devices', { fcmToken: 'fcm-token-abcdefghijk', platform: 'android' }).expect(204);
    // A finished booking stays for records, without the phone number.
    const bookingId = await book(login.accessToken, vendor.vendorId, vendor.serviceId);
    await as(vendor.token).post(`/v1/partner/bookings/${bookingId}/accept`).expect(200);
    await as(login.accessToken).post(`/v1/bookings/${bookingId}/pay/dev`).expect(200);
    await t.db.query(`UPDATE bookings SET day = $1`, [inDays(-1)]);
    await t.app.get(BookingsService).sweep();

    await as(login.accessToken).delete('/v1/me', { confirm: 'DELETE' }).expect(204);
    await as(login.accessToken).get('/v1/me').expect(401);
    expect((await t.http().post('/v1/auth/refresh').send({ refreshToken: login.refreshToken }).expect(401)).body.error.code).toMatch(/REFRESH_/);

    const u = await t.db.one(t.db, 'SELECT phone, name, deleted_at FROM users WHERE id = $1', [login.user.id]);
    expect(u.phone).toBe(`deleted:${login.user.id}`);
    expect(u.name).toBeNull();
    expect(u.deleted_at).not.toBeNull();
    expect((await t.db.query('SELECT 1 FROM shortlists UNION ALL SELECT 1 FROM device_tokens')).rows).toEqual([]);
    const seen = (await as(vendor.token).get(`/v1/partner/bookings/${bookingId}`).expect(200)).body;
    expect(seen).toMatchObject({ status: 'completed', customer: { name: null, phone: null } });

    t.sms.sent.length = 0;
    const again = (await t.login('9822222222')).body;
    expect(again.isNewUser).toBe(true);
    expect(again.user.id).not.toBe(login.user.id);
  });

  it('vendor: hidden from customers, photos and documents removed from Cloudinary, bank details deleted', async () => {
    const vendor = await liveVendor();
    await t.db.query(`INSERT INTO vendor_documents (vendor_id, doc_type, storage_key, last4) VALUES ($1, 'aadhaar', 'doc/a', '1234')`, [vendor.vendorId]);
    await as(vendor.token).put('/v1/partner/bank-account', { holderName: 'Raj Kumar', accountNumber: '123456789012', ifsc: 'SBIN0001234' }).expect(200);
    expect((await t.http().get('/v1/vendors')).body.items).toHaveLength(1);

    await as(vendor.token).delete('/v1/me', { confirm: 'DELETE' }).expect(204);
    expect((await t.http().get('/v1/vendors')).body.items).toEqual([]);
    await t.http().get(`/v1/vendors/${vendor.vendorId}`).expect(404);
    expect(t.cloudinary.destroyed.sort()).toEqual(['doc/a', `p/${vendor.vendorId}`]);
    expect((await t.db.query('SELECT 1 FROM vendor_bank_accounts UNION ALL SELECT 1 FROM media UNION ALL SELECT 1 FROM vendor_documents')).rows).toEqual([]);
  });

  it('bank account: validated, stored encrypted, masked for the vendor, full for finance (audited), verify notifies', async () => {
    const vendor = await liveVendor();
    expect((await as(vendor.token).get('/v1/partner/bank-account').expect(200)).body).toEqual({ account: null });
    const bad = await as(vendor.token).put('/v1/partner/bank-account', { holderName: 'Raj', accountNumber: '12ab', ifsc: 'SBIN1234' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION');

    const saved = (await as(vendor.token)
      .put('/v1/partner/bank-account', { holderName: 'Raj Kumar', accountNumber: '123456789012', ifsc: 'sbin0001234', upiId: 'Raj@okSBI' })
      .expect(200)).body.account;
    expect(saved).toMatchObject({ holderName: 'Raj Kumar', accountLast4: '9012', ifsc: 'SBIN0001234', upiId: 'raj@oksbi', status: 'pending' });
    expect(JSON.stringify(saved)).not.toContain('123456789012');
    const raw = await t.db.one(t.db, 'SELECT account_enc FROM vendor_bank_accounts');
    expect(raw.account_enc).toMatch(/^v1:/);
    expect(raw.account_enc).not.toContain('123456789012');

    const support = await t.adminLogin('support');
    await as(support).get(`/v1/admin/vendors/${vendor.vendorId}/bank-account`).expect(403);
    const finance = await t.adminLogin('finance');
    const full = (await as(finance).get(`/v1/admin/vendors/${vendor.vendorId}/bank-account`).expect(200)).body;
    expect(full).toMatchObject({ accountNumber: '123456789012', ifsc: 'SBIN0001234' });
    expect((await t.db.query(`SELECT action FROM admin_audit_log WHERE action = 'bank.view'`)).rows).toHaveLength(1);

    await as(finance).post(`/v1/admin/vendors/${vendor.vendorId}/bank-account/verify`).expect(200);
    expect((await as(vendor.token).get('/v1/partner/bank-account')).body.account.status).toBe('verified');
    expect((await as(vendor.token).get('/v1/notifications')).body.items[0]).toMatchObject({ kind: 'bank_verified' });

    // Changing the details sends them back for a check.
    await as(vendor.token).put('/v1/partner/bank-account', { holderName: 'Raj Kumar', accountNumber: '999988887777', ifsc: 'HDFC0000123' }).expect(200);
    expect((await as(vendor.token).get('/v1/partner/bank-account')).body.account).toMatchObject({ status: 'pending', accountLast4: '7777' });
  });
});
