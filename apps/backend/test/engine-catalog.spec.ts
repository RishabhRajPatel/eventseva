// Category templates, vendor-configured engine services, resources (vehicles, drivers) with document
// checks and admin verification, add-ons, and the public service list customers book from.
import { todayIst } from '../src/bookings/booking.rules';
import { checkTemplate } from '../src/engine/rules';
import { signParams } from '../src/media/cloudinary.service';
import { createTestApp, TestApp } from './helpers';

const SECRET = 'test-secret';
const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;

describe('engine catalogue', () => {
  let t: TestApp;
  let cityId: number;

  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  // Tests switch hidden categories on; put back the owner's seven for the other suites.
  const restore = () => t.db.query(`UPDATE categories SET is_active = (slug IN ('dj','decor','catering','bartan','tent','planner','camera'))`);
  afterAll(async () => {
    await restore();
    await t.app.close();
  });
  beforeEach(() => t.reset());
  afterEach(restore);

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    del: (url: string) => t.http().delete(url).set('Authorization', `Bearer ${token}`),
  });

  const vendor = async (phone: string, slug: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    await t.db.query(`UPDATE categories SET is_active = true WHERE slug = $1`, [slug]);
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slug])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `${slug} vendor ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now() WHERE id = $1`, [id]);
    return { token, id };
  };
  const customer = async (phone: string, day = inDays(10)) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: day, cityId, venueAddress: 'Civil Lines', venueLat: 25.45, venueLng: 81.85 }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const doc = (vendorId: string, name: string) => {
    const publicId = `eventseva/vendors/${vendorId}/docs/${name}`;
    return { publicId, version: 1, signature: signParams({ public_id: publicId, version: 1 }, SECRET), format: 'pdf' };
  };

  it('every category template is valid', async () => {
    const { rows } = await t.db.query('SELECT slug, booking_type, template FROM categories');
    for (const r of rows) expect(() => checkTemplate(r.booking_type, r.template)).not.toThrow();
    const types = Object.fromEntries(rows.map((r) => [r.slug, r.booking_type]));
    expect(types).toMatchObject({ dj: 'time_window', catering: 'per_person', tent: 'rental', car: 'transport', makeup: 'appointment', bartender: 'staffing', planner: 'quote' });
    // Customers still see the seven categories the owner chose.
    expect((await t.http().get('/v1/categories').expect(200)).body.items).toHaveLength(7);
  });

  it('admins change a category\'s booking type and template, checked on the server', async () => {
    const admin = await t.adminLogin('super');
    const band = await t.db.one(t.db, `SELECT id, template FROM categories WHERE slug = 'band'`);
    await as(admin).patch(`/v1/admin/categories/${band.id}`, { template: { rules: { setupMin: -5 } } }).expect(400);
    await as(admin).patch(`/v1/admin/categories/${band.id}`, { template: { pricingModels: ['magic'] } }).expect(400);
    const ok = (await as(admin).patch(`/v1/admin/categories/${band.id}`, { template: { pricingModels: ['fixed'], rules: { leadTimeHours: 24 } } }).expect(200)).body;
    expect(ok.template.rules.leadTimeHours).toBe(24);
    await as(admin).patch(`/v1/admin/categories/${band.id}`, { template: band.template }).expect(200);
  });

  it('a DJ sets up a priced service within the category\'s rules, and customers book it', async () => {
    const dj = await vendor('9811111111', 'dj');
    const setup = (await as(dj.token).get('/v1/partner/service-setup').expect(200)).body;
    expect(setup).toMatchObject({ bookingType: 'time_window', pricingModels: ['fixed', 'hourly'] });

    const svc = { title: 'DJ night', pricing: { model: 'fixed', ratePaise: 2_000_000, includedHours: 5, overtimeHourPaise: 200_000, taxPercent: 18 } };
    await as(dj.token).post('/v1/partner/engine-services', { ...svc, pricing: { model: 'per_trip', ratePaise: 100 } }).expect(400);
    expect((await as(dj.token).post('/v1/partner/engine-services', { ...svc, rules: { advance: { percent: 5 } } }).expect(400)).body.error.field).toBe('rules.advance');
    expect((await as(dj.token).post('/v1/partner/engine-services', { ...svc, rules: { leadTimeHours: 2 } }).expect(400)).body.error.field).toBe('rules.leadTimeHours');
    await as(dj.token).post('/v1/partner/engine-services', { ...svc, attributes: { horns: 4 } }).expect(400);
    const created = (await as(dj.token).post('/v1/partner/engine-services', { ...svc, attributes: { speakers_watt: 5000, lights_included: true } }).expect(201)).body;
    expect(created).toMatchObject({ bookingType: 'time_window', pricing: { model: 'fixed' } });
    // Slot service routes cannot touch it, and it is not in the old services list.
    await as(dj.token).patch(`/v1/partner/services/${created.id}`, { title: 'Renamed' }).expect(404);
    expect((await t.http().get(`/v1/vendors/${dj.id}`).expect(200)).body.services).toHaveLength(0);

    const pub = (await t.http().get(`/v1/vendors/${dj.id}/engine-services`).expect(200)).body.items;
    expect(pub[0]).toMatchObject({ id: created.id, bookingType: 'time_window', rules: { minDurationMin: 120, leadTimeHours: 12 } });
    expect(pub[0].questions.map((q: { key: string }) => q.key)).toEqual(['occasion', 'power_at_venue']);

    const c = await customer('9833333333');
    const body = { eventId: c.eventId, serviceId: created.id, startsAt: at(inDays(10), '19:00'), endsAt: at(inDays(11), '01:00') };
    expect((await as(c.token).post('/v1/quotes', body).expect(400)).body.error.code).toBe('ANSWER_REQUIRED');
    const q = (await as(c.token).post('/v1/quotes', { ...body, answers: { occasion: 'sangeet' } }).expect(200)).body;
    // 6 h across midnight: base + 1 h overtime, then 18% GST.
    expect(q.subtotalPaise).toBe(2_200_000);
    expect(q.taxPaise).toBe(396_000);
    const id = (await as(c.token).post('/v1/engine-bookings', { ...body, answers: { occasion: 'sangeet' } }).expect(201)).body.id;
    // The same evening is taken for anyone else (the vendor's team is one exclusive resource).
    const c2 = await customer('9844444444');
    expect((await as(c2.token).post('/v1/engine-bookings', { ...body, eventId: c2.eventId, answers: { occasion: 'party' } }).expect(409)).body.error.code).toBe('NOT_AVAILABLE');
    await as(dj.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body).toMatchObject({ status: 'confirmed', bookingType: 'time_window', stage: 'confirmed' });

    // The vendor's day + slot calendar sees the engine booking too.
    const old = (await as(dj.token).post('/v1/partner/services', { title: 'Old DJ', pricePaise: 1_000_000, unit: 'per_event' }).expect(201)).body;
    const c3 = await customer('9855555555');
    expect((await as(c3.token).post('/v1/bookings', { eventId: c3.eventId, vendorId: dj.id, serviceId: old.id, slot: 'night' }).expect(409)).body.error.code).toBe('SLOT_TAKEN');
    // The day slot of the same date is still free.
    await as(c3.token).post('/v1/bookings', { eventId: c3.eventId, vendorId: dj.id, serviceId: old.id, slot: 'day' }).expect(201);
  });

  it('vehicles and drivers need documents and an admin check before they can be booked', async () => {
    const car = await vendor('9811111111', 'car');
    const vehicle = { kind: 'vehicle', name: 'White Audi A6', attributes: { registration: 'up70 ab 1234', make: 'Audi', model: 'A6', seats: 4, with_driver: true, decorated: true } };
    expect((await as(car.token).post('/v1/partner/resources', { ...vehicle, attributes: { ...vehicle.attributes, registration: 'BAD' } }).expect(400)).body.error.field).toBe('attributes.registration');
    await as(car.token).post('/v1/partner/resources', { ...vehicle, attributes: { ...vehicle.attributes, with_driver: false } }).expect(400);
    const v = (await as(car.token).post('/v1/partner/resources', vehicle).expect(201)).body;
    expect(v).toMatchObject({ verification: 'pending', attributes: { registration: 'UP70AB1234' } });
    const other = await vendor('9822222222', 'car');
    expect((await as(other.token).post('/v1/partner/resources', vehicle).expect(409)).body.error.code).toBe('VEHICLE_EXISTS');
    await as(other.token).patch(`/v1/partner/resources/${v.id}`, { name: 'Mine now' }).expect(404);
    await as(other.token).post(`/v1/partner/resources/${v.id}/documents`, { ...doc(other.id, 'rc'), docType: 'vehicle_rc' }).expect(404);
    await as(car.token).post('/v1/partner/resources', { kind: 'driver', name: 'Ramesh', attributes: { licence_last4: '1234', licence_expires: '2001-01-01' } }).expect(400);
    const driver = (await as(car.token).post('/v1/partner/resources', { kind: 'driver', name: 'Ramesh', attributes: { licence_last4: '1234', licence_expires: '2030-01-01' } }).expect(201)).body;

    // A transport service needs one of the vendor's own vehicles.
    const pricing = { model: 'fixed', ratePaise: 1_100_000, includedHours: 8, includedKm: 80, extraKmPaise: 2_500, overtimeHourPaise: 50_000, driverDayPaise: 50_000 };
    await as(car.token).post('/v1/partner/engine-services', { title: 'Dulha car', pricing }).expect(400);
    await as(car.token).post('/v1/partner/engine-services', { title: 'Dulha car', pricing, resourceId: driver.id }).expect(400);
    const svc = (await as(car.token).post('/v1/partner/engine-services', { title: 'Dulha car', pricing, resourceId: v.id }).expect(201)).body;

    const c = await customer('9833333333');
    const route = { pickup: { address: 'Civil Lines', lat: 25.45, lng: 81.85 }, destination: { address: 'Jhunsi', lat: 25.43, lng: 81.91 } };
    const ask = { eventId: c.eventId, serviceId: svc.id, startsAt: at(inDays(10), '16:00'), endsAt: at(inDays(11), '00:30'), route, mode: 'with_driver' };
    expect((await as(c.token).post('/v1/quotes', ask).expect(409)).body.error.code).toBe('VEHICLE_NOT_AVAILABLE');
    const pub = (await t.http().get(`/v1/vendors/${car.id}/engine-services`).expect(200)).body.items[0];
    expect(pub.resource.attributes.registration).toBeUndefined();
    expect(pub.resource.attributes.registrationMasked).toBe('UP70 •• 1234');
    expect(pub.resource.bookable).toBe(false);

    const verifier = await t.adminLogin('verifier');
    expect((await as(verifier).post(`/v1/admin/resources/${v.id}/verify`, { decision: 'approve' }).expect(409)).body.error.missing).toEqual(['vehicle_rc', 'vehicle_insurance']);
    await as(car.token).post(`/v1/partner/resources/${v.id}/documents`, { ...doc(car.id, 'rc'), docType: 'driver_licence' }).expect(400);
    await as(car.token).post(`/v1/partner/resources/${v.id}/documents`, { ...doc(car.id, 'rc'), docType: 'vehicle_rc' }).expect(201);
    await as(car.token).post(`/v1/partner/resources/${v.id}/documents`, { ...doc(car.id, 'ins'), docType: 'vehicle_insurance' }).expect(201);
    expect((await as(verifier).get('/v1/admin/resources/pending').expect(200)).body.items.map((r: { id: string }) => r.id).sort()).toEqual([v.id, driver.id].sort());
    expect((await as(verifier).get(`/v1/admin/resources/${v.id}/documents`).expect(200)).body.items[0].viewUrl).toContain('private');
    await as(verifier).post(`/v1/admin/resources/${v.id}/verify`, { decision: 'reject' }).expect(400);
    await as(verifier).post(`/v1/admin/resources/${v.id}/verify`, { decision: 'approve' }).expect(200);
    // The car is approved, but no approved driver yet.
    expect((await as(c.token).post('/v1/quotes', ask).expect(409)).body.error.code).toBe('NO_DRIVER');
    await as(car.token).post(`/v1/partner/resources/${driver.id}/documents`, { ...doc(car.id, 'dl'), docType: 'driver_licence' }).expect(201);
    await as(verifier).post(`/v1/admin/resources/${driver.id}/verify`, { decision: 'approve' }).expect(200);
    const q = (await as(c.token).post('/v1/quotes', ask).expect(200)).body;
    expect(q.lines.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(['base', 'overtime', 'driver']));

    // Changing the registration sends the car back for checks.
    expect((await as(car.token).patch(`/v1/partner/resources/${v.id}`, { attributes: { registration: 'UP70 CD 9999' } }).expect(200)).body.verification).toBe('pending');
    const support = await t.adminLogin('support');
    await as(support).post(`/v1/admin/resources/${v.id}/verify`, { decision: 'approve' }).expect(403);
  });

  it('a resource with bookings ahead cannot be switched off', async () => {
    const hall = await vendor('9811111111', 'hall');
    const venue = (await as(hall.token).post('/v1/partner/resources', { kind: 'venue', name: 'Main lawn', attributes: { capacity: 800 } }).expect(201)).body;
    expect(venue.verification).toBe('not_required');
    const svc = (await as(hall.token).post('/v1/partner/engine-services', { title: 'Lawn', pricing: { model: 'daily', ratePaise: 5_000_000 }, resourceId: venue.id }).expect(201)).body;
    const c = await customer('9833333333');
    await as(c.token).post('/v1/engine-bookings', { eventId: c.eventId, serviceId: svc.id, startsAt: at(inDays(10), '10:00'), endsAt: at(inDays(10), '23:00') }).expect(201);
    expect((await as(hall.token).del(`/v1/partner/resources/${venue.id}`).expect(409)).body.error.code).toBe('RESOURCE_BOOKED');
    expect((await as(hall.token).patch(`/v1/partner/resources/${venue.id}`, { status: 'maintenance' }).expect(409)).body.error.code).toBe('RESOURCE_BOOKED');
  });

  it('add-ons: own services only, shown to customers, and ones needing approval make the price indicative', async () => {
    const dec = await vendor('9811111111', 'decor');
    const svc = (await as(dec.token).post('/v1/partner/engine-services', { title: 'Stage decoration', pricing: { model: 'fixed', ratePaise: 3_000_000 } }).expect(201)).body;
    const other = await vendor('9822222222', 'decor');
    await as(other.token).post('/v1/partner/addons', { serviceId: svc.id, name: 'Flowers', pricePaise: 100 }).expect(404);
    const plain = (await as(dec.token).post('/v1/partner/addons', { serviceId: svc.id, name: 'Fog machine', pricePaise: 300_000 }).expect(201)).body;
    const custom = (await as(dec.token).post('/v1/partner/addons', { name: 'Custom theme', pricePaise: 1_000_000, requiresApproval: true, inclusions: ['Design call'] }).expect(201)).body;
    await as(other.token).patch(`/v1/partner/addons/${plain.id}`, { pricePaise: 1 }).expect(404);
    const pub = (await t.http().get(`/v1/vendors/${dec.id}/engine-services`).expect(200)).body.items[0];
    expect(pub.addons.map((a: { name: string }) => a.name).sort()).toEqual(['Custom theme', 'Fog machine']);
    const c = await customer('9833333333');
    const body = { eventId: c.eventId, serviceId: svc.id, startsAt: at(inDays(10), '10:00'), endsAt: at(inDays(10), '22:00'), answers: {} };
    const q1 = (await as(c.token).post('/v1/quotes', { ...body, addons: [{ addonId: plain.id }] }).expect(200)).body;
    expect(q1).toMatchObject({ priceKind: 'confirmed', subtotalPaise: 3_300_000 });
    const q2 = (await as(c.token).post('/v1/quotes', { ...body, addons: [{ addonId: custom.id, note: 'Royal blue' }] }).expect(200)).body;
    expect(q2).toMatchObject({ priceKind: 'indicative', approval: 'vendor' });

    // The vendor must answer each extra needing approval; a declined one comes off the price.
    const id = (await as(c.token).post('/v1/engine-bookings', { ...body, addons: [{ addonId: plain.id }, { addonId: custom.id }] }).expect(201)).body.id;
    expect((await as(dec.token).post(`/v1/partner/bookings/${id}/accept`).expect(400)).body.error.code).toBe('ADDON_DECISION_REQUIRED');
    await as(dec.token).post(`/v1/partner/bookings/${id}/accept`, { addons: [{ addonId: custom.id, approve: false }] }).expect(200);
    expect((await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body.amountPaise).toBe(3_300_000);
  });
});
