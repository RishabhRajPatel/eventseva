// Platform settings: the money rules a super admin can change without a deploy, and the guarantee
// that changing them never moves money on bookings already made.
import { SettingsService } from '../src/admin/settings.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('platform settings', () => {
  let t: TestApp;
  let settings: SettingsService;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let serviceId: string;
  let customer: string;

  beforeAll(async () => {
    t = await createTestApp();
    settings = t.app.get(SettingsService);
    t.app.get(BookingsService); // the sweep is off in tests (BOOKING_SWEEP_SEC=0)
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
    // reset() does not touch platform_settings, so put it back to the migration's defaults.
    await t.db.query(
      `UPDATE platform_settings SET advance_percent = 25, commission_percent = 10, cash_dues_limit_paise = 500000,
              cancellation = '{"customer":[{"minDays":15,"percent":90},{"minDays":7,"percent":50},{"minDays":0,"percent":0}],"vendorPercent":100}'::jsonb,
              platform_name = 'EventSeva', platform_address = NULL, platform_gstin = NULL, updated_by = NULL
        WHERE id = 1`,
    );
    settings.invalidate();
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    serviceId = (await as(vendorToken).post('/v1/partner/services', { title: 'DJ night', pricePaise: 1_000_000, unit: 'per_event' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now()`);
    customer = (await t.login('9822222222')).body.accessToken;
  });

  const book = async () => {
    const event = (await as(customer).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(20), cityId }).expect(201)).body;
    return (await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot: 'night' }).expect(201)).body;
  };

  it('defaults come from the migration and match what .env used to say', async () => {
    const admin = await t.adminLogin('super');
    const body = (await as(admin).get('/v1/admin/settings').expect(200)).body;
    expect(body.settings).toMatchObject({ advancePercent: 25, commissionPercent: 10, cashDuesLimitPaise: 500_000 });
    expect(body.settings.platform).toEqual({ name: 'EventSeva', address: null, gstin: null });
    expect(body.updatedBy).toBeNull();
  });

  it('only a super admin reaches it, and a change needs a fresh 2FA code', async () => {
    const finance = await t.adminLogin('finance', 'finance@eventseva.test');
    await as(finance).get('/v1/admin/settings').expect(403);
    await as(finance).patch('/v1/admin/settings', { advancePercent: 40 }).expect(403);

    // A super admin who has not entered a code recently is asked for one before saving.
    const stale = await t.adminLogin('super', 'stale@eventseva.test', false);
    await as(stale).get('/v1/admin/settings').expect(200); // reading is fine
    expect((await as(stale).patch('/v1/admin/settings', { advancePercent: 40 })).status).toBe(403);
  });

  it('a saved change takes effect on the next booking, and is in the audit log with before and after', async () => {
    const admin = await t.adminLogin('super');
    const saved = (await as(admin).patch('/v1/admin/settings', { advancePercent: 50, commissionPercent: 20 }).expect(200)).body;
    expect(saved).toMatchObject({ advancePercent: 50, commissionPercent: 20 });

    const b = await book();
    // ₹10,000 service: half as the advance, a fifth as commission.
    expect(b).toMatchObject({ amountPaise: 1_000_000, advancePaise: 500_000 });
    const row = await t.db.one<{ commission_paise: number }>(t.db, 'SELECT commission_paise FROM bookings WHERE id = $1', [b.id]);
    expect(row!.commission_paise).toBe(200_000);

    const audit = (await as(admin).get('/v1/admin/audit?targetType=settings').expect(200)).body.items;
    expect(audit[0]).toMatchObject({ action: 'settings.update' });
    expect(audit[0].before).toMatchObject({ advancePercent: 25, commissionPercent: 10 });
    expect(audit[0].after).toMatchObject({ advancePercent: 50, commissionPercent: 20 });
  });

  it('bookings already made keep the money they were made with', async () => {
    const before = await book();
    const admin = await t.adminLogin('super');
    await as(admin).patch('/v1/admin/settings', { advancePercent: 90, commissionPercent: 90 }).expect(200);

    const after = (await as(customer).get(`/v1/bookings/${before.id}`).expect(200)).body;
    expect(after.advancePaise).toBe(before.advancePaise);
    expect(after.amountPaise).toBe(before.amountPaise);
  });

  it('the commission can never be larger than the advance it comes out of', async () => {
    const admin = await t.adminLogin('super');
    const err = (await as(admin).patch('/v1/admin/settings', { advancePercent: 20, commissionPercent: 30 }).expect(400)).body.error;
    expect(err).toMatchObject({ code: 'COMMISSION_OVER_ADVANCE', advancePercent: 20, commissionPercent: 30 });
    // Checked against the saved advance too, not just the one in the same request.
    await as(admin).patch('/v1/admin/settings', { commissionPercent: 90 }).expect(400);
    expect((await as(admin).get('/v1/admin/settings')).body.settings).toMatchObject({ advancePercent: 25, commissionPercent: 10 });
  });

  it('a bad cancellation policy is refused by the same rules the vendor editor uses', async () => {
    const admin = await t.adminLogin('super');
    // Refunds may not grow as the event gets closer.
    await as(admin).patch('/v1/admin/settings', {
      cancellation: { customer: [{ minDays: 10, percent: 10 }, { minDays: 0, percent: 90 }], vendorPercent: 100 },
    }).expect(400);
    // The last tier has to start at 0 days.
    await as(admin).patch('/v1/admin/settings', {
      cancellation: { customer: [{ minDays: 5, percent: 50 }], vendorPercent: 100 },
    }).expect(400);

    const ok = (await as(admin).patch('/v1/admin/settings', {
      cancellation: { customer: [{ minDays: 30, percent: 100 }, { minDays: 0, percent: 25 }], vendorPercent: 100 },
    }).expect(200)).body;
    expect(ok.cancellation.customer).toHaveLength(2);
  });

  it('the invoice identity is editable, and a GSTIN has to look like one', async () => {
    const admin = await t.adminLogin('super');
    await as(admin).patch('/v1/admin/settings', { platformGstin: 'not-a-gstin' }).expect(400);
    const ok = (await as(admin).patch('/v1/admin/settings', {
      platformName: 'EventSeva Private Limited', platformAddress: 'Civil Lines, Prayagraj', platformGstin: '09ABCDE1234F1Z5',
    }).expect(200)).body;
    expect(ok.platform).toEqual({ name: 'EventSeva Private Limited', address: 'Civil Lines, Prayagraj', gstin: '09ABCDE1234F1Z5' });
    // An empty string clears an optional field rather than storing "".
    expect((await as(admin).patch('/v1/admin/settings', { platformAddress: '' }).expect(200)).body.platform.address).toBeNull();
  });

  it('an empty change is refused rather than writing an audit entry that says nothing', async () => {
    const admin = await t.adminLogin('super');
    expect((await as(admin).patch('/v1/admin/settings', {}).expect(400)).body.error.code).toBe('VALIDATION');
  });
});
