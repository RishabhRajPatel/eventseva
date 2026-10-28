// Vendor-configurable services: rate plans (DJ per hour / full night, car local / outstation), the
// vendor's own questions saved with the booking, event types served, price rules, availability limits,
// a history of every change, and a category added by an admin that books with no code change.
import { todayIst } from '../src/bookings/booking.rules';
import { signParams } from '../src/media/cloudinary.service';
import { adjustmentLines, checkPlans, pickPlan, schemaVersion } from '../src/engine/service-config';
import { checkTimes } from '../src/engine/rules';
import type { Pricing, QuoteLine } from '../src/engine/types';
import { createTestApp, restoreLiveCategories, TestApp } from './helpers';

const SECRET = 'test-secret';
const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const DAY = inDays(20);
const bi = (en: string, hi = en) => ({ en, hi });

const DJ_PLANS = [
  { id: 'per_hour', name: bi('Per hour', 'प्रति घंटा'), pricing: { model: 'hourly', ratePaise: 300_000 } },
  { id: 'full_night', name: bi('Full night', 'पूरी रात'), pricing: { model: 'fixed', ratePaise: 2_000_000, includedHours: 8, overtimeHourPaise: 250_000 }, rules: { minDurationMin: 360 } },
];

describe('service config rules (pure)', () => {
  const base: QuoteLine[] = [{ code: 'base', label: 'DJ', qty: 1, unitPaise: 100_000, amountPaise: 100_000, kind: 'base' }];
  const sat = new Date('2026-12-05T13:00:00Z'); // a Saturday, India time

  it('price rules match by weekday, dates and event type, and never take the price below zero', () => {
    const p = (adjustments: Pricing['adjustments']): Pricing => ({ model: 'fixed', ratePaise: 100_000, adjustments });
    expect(adjustmentLines(p([{ label: bi('Weekend'), days: [6], percent: 20 }]), base, sat, 'wedding').map((l) => l.amountPaise)).toEqual([20_000]);
    expect(adjustmentLines(p([{ label: bi('Weekend'), days: [0], percent: 20 }]), base, sat, 'wedding')).toEqual([]);
    expect(adjustmentLines(p([{ label: bi('Diwali'), from: '2026-12-01', until: '2026-12-04', percent: 50 }]), base, sat, 'wedding')).toEqual([]);
    expect(adjustmentLines(p([{ label: bi('Birthday'), eventTypes: ['birthday'], amountPaise: 5_000 }]), base, sat, 'wedding')).toEqual([]);
    const floor = adjustmentLines(p([{ label: bi('Free'), percent: -90 }, { label: bi('More off'), amountPaise: -50_000 }]), base, sat, 'wedding');
    expect(floor.reduce((s, l) => s + l.amountPaise, 0)).toBe(-100_000);
  });

  it('plans: none or 2–6 with unique ids; a request must name one when there are plans', () => {
    const plan = (id: string) => ({ id, name: bi(id), pricing: { model: 'fixed' as const, ratePaise: 1_000 } });
    expect(() => checkPlans([plan('a'), plan('a')], undefined, 1e8)).toThrow(/appears twice/);
    expect(() => checkPlans([plan('a'), { ...plan('b'), rules: { advance: { percent: 10 } } }], undefined, 1e8)).toThrow(/set by EventSeva/);
    expect(checkPlans([], undefined, 1e8)).toEqual([]);
    expect(pickPlan([], undefined)).toBeNull();
    expect(() => pickPlan([], 'a')).toThrow(/one price/);
    expect(pickPlan([plan('a'), plan('b')], 'b')!.id).toBe('b');
  });

  it('availability rules and the question version', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(() => checkTimes(sat, new Date(sat.getTime() + 3_600_000), { workingDays: [1, 2, 3, 4, 5] }, now)).toThrow(/day of the week/);
    expect(() => checkTimes(sat, new Date(sat.getTime() + 3_600_000), { blockedDates: ['2026-12-05'] }, now)).toThrow(/this date/);
    expect(() => checkTimes(sat, new Date(sat.getTime() + 3_600_000), { maxAdvanceDays: 30 }, now)).toThrow(/30 days/);
    expect(() => checkTimes(sat, new Date(sat.getTime() + 3_600_000), { maxAdvanceDays: 40, workingDays: [6] }, now)).not.toThrow();
    const q = [{ key: 'a', label: bi('A'), type: 'text' as const }];
    expect(schemaVersion(q)).toBe(schemaVersion([...q]));
    expect(schemaVersion(q)).not.toBe(schemaVersion([{ ...q[0], required: true }]));
  });
});

describe('vendor-configurable booking engine', () => {
  let t: TestApp;
  let cityId: number;
  beforeAll(async () => {
    t = await createTestApp();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(async () => {
    // The category the admin adds in the last test must not show up in other specs.
    await t.reset();
    await t.db.query(`DELETE FROM categories WHERE slug = 'henna-studio'`);
    await restoreLiveCategories(t.db);
    await t.app.close();
  });
  beforeEach(() => t.reset());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const vendor = async (phone: string, slugOrId: string | number) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const cat = typeof slugOrId === 'number' ? slugOrId : (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slugOrId])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `Vendor ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.44, lng = 81.84 WHERE id = $1`, [id]);
    return { token, id: id as string };
  };
  const customer = async (phone: string, eventType = 'wedding', day = DAY) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Function', eventType, eventDate: day, cityId }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const djLine = (eventId: string, from: string, until: string, extra: object = {}, day = DAY) =>
    ({ eventId, serviceId: '', startsAt: at(day, from), endsAt: at(day, until), answers: { occasion: 'sangeet' }, ...extra });

  describe('rate plans', () => {
    it('DJ: per hour or full night, each priced and ruled by its own plan; a plan must be chosen', async () => {
      const dj = await vendor('9811111111', 'dj');
      // One plan alone is not a choice.
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, plans: [DJ_PLANS[0]] }).expect(400);
      // A plan priced with a model the category does not allow is refused.
      const badModel = [DJ_PLANS[0], { ...DJ_PLANS[1], pricing: { model: 'per_person', ratePaise: 100 } }];
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, plans: badModel }).expect(400);
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ night', pricing: { model: 'hourly', ratePaise: 300_000 }, plans: DJ_PLANS }).expect(201)).body;
      expect(svc.plans.map((p: { id: string }) => p.id)).toEqual(['per_hour', 'full_night']);

      const pub = (await t.http().get(`/v1/vendors/${dj.id}/engine-services`).expect(200)).body.items[0];
      expect(pub.plans).toHaveLength(2);
      expect(pub.plans[1].rules.minDurationMin).toBe(360);

      const c = await customer('9833333333');
      const base = { ...djLine(c.eventId, '19:00', '23:00'), serviceId: svc.id };
      expect((await as(c.token).post('/v1/quotes', base).expect(400)).body.error).toMatchObject({ code: 'RATE_PLAN_REQUIRED', plans: ['per_hour', 'full_night'] });
      expect((await as(c.token).post('/v1/quotes', { ...base, planId: 'weekly' }).expect(400)).body.error.code).toBe('RATE_PLAN_NOT_FOUND');

      const hourly = (await as(c.token).post('/v1/quotes', { ...base, planId: 'per_hour' }).expect(200)).body;
      expect(hourly.subtotalPaise).toBe(4 * 300_000);
      // The full-night plan needs at least 6 hours.
      expect((await as(c.token).post('/v1/quotes', { ...base, planId: 'full_night' }).expect(400)).body.error.code).toBe('DURATION_TOO_SHORT');
      const night = (await as(c.token).post('/v1/quotes', { ...base, endsAt: at(inDays(21), '05:00'), planId: 'full_night' }).expect(200)).body;
      expect(night.subtotalPaise).toBe(2_000_000 + 2 * 250_000);

      const id = (await as(c.token).post('/v1/engine-bookings', { ...base, planId: 'per_hour' }).expect(201)).body.id;
      const snap = (await t.db.one<{ snapshot: { plan: object; service: { pricing: { model: string } } } }>(t.db, 'SELECT snapshot FROM bookings WHERE id = $1', [id]))!.snapshot;
      expect(snap.plan).toEqual({ id: 'per_hour', name: DJ_PLANS[0].name });
      expect(snap.service.pricing.model).toBe('hourly');
    });

    it('car: local by the hour or outstation by the day, with the same vehicle', async () => {
      const admin = await t.adminLogin('super');
      const v = await vendor('9811111111', 'car');
      const doc = (name: string) => {
        const publicId = `eventseva/vendors/${v.id}/docs/${name}`;
        return { publicId, version: 1, signature: signParams({ public_id: publicId, version: 1 }, SECRET), format: 'pdf' };
      };
      const mk = async (body: object) => (await as(v.token).post('/v1/partner/resources', body).expect(201)).body.id as string;
      const car = await mk({ kind: 'vehicle', name: 'White Innova', attributes: { registration: 'UP70AB1234', make: 'Toyota', model: 'Innova', seats: 7, with_driver: true } });
      const driver = await mk({ kind: 'driver', name: 'Ramesh', attributes: { licence_last4: '1111', licence_expires: '2032-01-01' } });
      for (const [r, docs] of [[car, ['vehicle_rc', 'vehicle_insurance']], [driver, ['driver_licence']]] as const) {
        for (const d of docs) await as(v.token).post(`/v1/partner/resources/${r}/documents`, { ...doc(`${r}-${d}`), docType: d }).expect(201);
        await as(admin).post(`/v1/admin/resources/${r}/verify`, { decision: 'approve' }).expect(200);
      }
      const plans = [
        { id: 'local', name: bi('Local, by the hour', 'शहर में, घंटे के हिसाब से'), pricing: { model: 'hourly', ratePaise: 80_000 } },
        { id: 'outstation', name: bi('Outstation, per day', 'बाहर, प्रति दिन'), pricing: { model: 'daily', ratePaise: 450_000, includedKm: 250, extraKmPaise: 1_400, driverDayPaise: 60_000 } },
      ];
      const svc = (await as(v.token).post('/v1/partner/engine-services', { title: 'Innova', pricing: { model: 'hourly', ratePaise: 80_000 }, resourceId: car, plans }).expect(201)).body.id;
      const c = await customer('9833333333');
      const local = { eventId: c.eventId, serviceId: svc, startsAt: at(DAY, '10:00'), endsAt: at(DAY, '15:00'), mode: 'with_driver',
        route: { pickup: { address: 'Civil Lines', lat: 25.45, lng: 81.85 }, destination: { address: 'Jhunsi', lat: 25.43, lng: 81.91 } } };
      const q1 = (await as(c.token).post('/v1/quotes', { ...local, planId: 'local' }).expect(200)).body;
      expect(q1.lines.find((l: { code: string }) => l.code === 'base')).toMatchObject({ qty: 5, unitPaise: 80_000 });
      const trip = { ...local, endsAt: at(inDays(22), '10:00'), planId: 'outstation',
        route: { pickup: local.route.pickup, destination: { address: 'Varanasi', lat: 25.32, lng: 82.97 } } };
      const q2 = (await as(c.token).post('/v1/quotes', trip).expect(200)).body;
      expect(q2.lines.find((l: { code: string }) => l.code === 'base')).toMatchObject({ qty: 2, unitPaise: 450_000 });
      expect(q2.lines.find((l: { code: string }) => l.code === 'driver')).toMatchObject({ qty: 2, unitPaise: 60_000 });
      await as(c.token).post('/v1/engine-bookings', trip).expect(201);
    });
  });

  describe('questions, event types and price rules', () => {
    it('the vendor\'s own questions are asked after the category\'s and saved with the booking as answered', async () => {
      const dj = await vendor('9811111111', 'dj');
      const questions = [
        { key: 'song_list', label: bi('Song requests', 'गानों की लिस्ट'), type: 'text', required: true, maxLength: 300 },
        { key: 'dhol', label: bi('Add a dhol player?', 'ढोल वाला जोड़ें?'), type: 'select', options: [
          { value: 'no', label: bi('No', 'नहीं') }, { value: 'yes', label: bi('Yes', 'हाँ'), pricePaise: 150_000 },
        ] },
      ];
      // The category already asks "occasion": the vendor cannot ask it again.
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 },
        questions: [{ key: 'occasion', label: bi('Occasion'), type: 'text' }] }).expect(400);
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, questions }).expect(201)).body.id;
      const pub = (await t.http().get(`/v1/vendors/${dj.id}/engine-services`).expect(200)).body.items[0];
      expect(pub.questions.map((q: { key: string }) => q.key)).toEqual(['occasion', 'power_at_venue', 'song_list', 'dhol']);

      const c = await customer('9833333333');
      const base = { ...djLine(c.eventId, '19:00', '23:00'), serviceId: svc };
      expect((await as(c.token).post('/v1/quotes', base).expect(400)).body.error).toMatchObject({ code: 'ANSWER_REQUIRED', field: 'song_list' });
      expect((await as(c.token).post('/v1/quotes', { ...base, answers: { occasion: 'sangeet', song_list: 'x', mystery: 1 } }).expect(400)).body.error.code).toBe('VALIDATION');
      expect((await as(c.token).post('/v1/quotes', { ...base, answers: { occasion: 'sangeet', song_list: 'x', dhol: 'maybe' } }).expect(400)).body.error.code).toBe('ANSWER_INVALID');
      const answers = { occasion: 'sangeet', song_list: 'Old Bollywood', dhol: 'yes' };
      const q = (await as(c.token).post('/v1/quotes', { ...base, answers }).expect(200)).body;
      expect(q.subtotalPaise).toBe(4 * 300_000 + 150_000);
      const id = (await as(c.token).post('/v1/engine-bookings', { ...base, answers }).expect(201)).body.id;

      // The vendor rewrites the questions later: the booking keeps the version that was answered.
      await as(dj.token).patch(`/v1/partner/engine-services/${svc}`, { questions: [questions[0]] }).expect(200);
      const snap = (await t.db.one<{ snapshot: { questions: { version: string; fields: { key: string }[] }; answers: object } }>(t.db, 'SELECT snapshot FROM bookings WHERE id = $1', [id]))!.snapshot;
      expect(snap.questions.fields.map((f) => f.key)).toEqual(['occasion', 'power_at_venue', 'song_list', 'dhol']);
      expect(snap.questions.version).toMatch(/^[0-9a-f]{12}$/);
      expect(snap.answers).toMatchObject(answers);
    });

    it('event types: a service for birthdays only is refused for a wedding and hidden from its listing', async () => {
      const dj = await vendor('9811111111', 'dj');
      await as(dj.token).post('/v1/partner/engine-services', { title: 'Kids party DJ', pricing: { model: 'hourly', ratePaise: 200_000 }, eventTypes: ['dance'] }).expect(400);
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'Kids party DJ', pricing: { model: 'hourly', ratePaise: 200_000 }, eventTypes: ['birthday'] }).expect(201)).body.id;
      expect((await t.http().get(`/v1/vendors/${dj.id}/engine-services?eventType=wedding`).expect(200)).body.items).toHaveLength(0);
      expect((await t.http().get(`/v1/vendors/${dj.id}/engine-services?eventType=birthday`).expect(200)).body.items).toHaveLength(1);
      const wedding = await customer('9833333333');
      const err = (await as(wedding.token).post('/v1/quotes', { ...djLine(wedding.eventId, '19:00', '22:00'), serviceId: svc }).expect(400)).body.error;
      expect(err).toMatchObject({ code: 'EVENT_TYPE_NOT_SERVED', eventTypes: ['birthday'] });
      const birthday = await customer('9844444444', 'birthday');
      await as(birthday.token).post('/v1/quotes', { ...djLine(birthday.eventId, '19:00', '22:00'), serviceId: svc }).expect(200);
    });

    it('price rules: a weekday surcharge, a peak-date rule and an event-type rule, in order', async () => {
      const dj = await vendor('9811111111', 'dj');
      const adjustments = [
        { label: bi('Peak season', 'पीक सीज़न'), from: DAY, until: DAY, percent: 25 },
        { label: bi('Wedding setup', 'शादी सेटअप'), eventTypes: ['wedding'], amountPaise: 100_000 },
        { label: bi('Weekday offer', 'वीकडे ऑफ़र'), days: [weekday(DAY)], percent: -10 },
      ];
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000, adjustments: [{ label: bi('x'), percent: 500 }] } }).expect(400);
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000, adjustments: [{ label: bi('x') }] } }).expect(400);
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000, adjustments } }).expect(201)).body.id;
      const c = await customer('9833333333');
      const q = (await as(c.token).post('/v1/quotes', { ...djLine(c.eventId, '19:00', '23:00'), serviceId: svc }).expect(200)).body;
      const rules = q.lines.filter((l: { code: string }) => l.code.startsWith('rule_'));
      expect(rules.map((l: { amountPaise: number }) => l.amountPaise)).toEqual([300_000, 100_000, -120_000]);
      expect(q.subtotalPaise).toBe(1_200_000 + 300_000 + 100_000 - 120_000);
      // A day outside the peak range and another weekday: only the wedding rule.
      const later = await customer('9844444444', 'wedding', inDays(23));
      const q2 = (await as(later.token).post('/v1/quotes', { ...djLine(later.eventId, '19:00', '23:00', {}, inDays(23)), serviceId: svc }).expect(200)).body;
      expect(q2.lines.filter((l: { code: string }) => l.code.startsWith('rule_')).map((l: { code: string }) => l.code)).toEqual(['rule_1']);
    });
  });

  describe('availability set by the vendor', () => {
    it('working days, blocked dates and how far ahead are enforced', async () => {
      const dj = await vendor('9811111111', 'dj');
      const otherDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday(DAY));
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 },
        rules: { workingDays: otherDays, blockedDates: [inDays(21)], maxAdvanceDays: 21 } }).expect(201)).body.id;
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, rules: { workingDays: [7] } }).expect(400);
      await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, rules: { blockedDates: ['2026-02-30'] } }).expect(400);
      const c = await customer('9833333333');
      const ask = (day: string) => as(c.token).post('/v1/quotes', { ...djLine(c.eventId, '19:00', '23:00', {}, day), serviceId: svc });
      expect((await ask(DAY).expect(400)).body.error.code).toBe('CLOSED_THAT_DAY');
      expect((await ask(inDays(21)).expect(400)).body.error.code).toBe('DATE_BLOCKED');
      await ask(inDays(19)).expect(200);
      const far = await customer('9844444444', 'wedding', inDays(25));
      expect((await as(far.token).post('/v1/quotes', { ...djLine(far.eventId, '19:00', '23:00', {}, inDays(25)), serviceId: svc }).expect(400)).body.error)
        .toMatchObject({ code: 'DATE_TOO_FAR', maxAdvanceDays: 21 });
    });

    it('a limit of bookings per day holds when two customers ask at the same moment', async () => {
      const decor = await vendor('9811111111', 'decor');
      const svc = (await as(decor.token).post('/v1/partner/engine-services', { title: 'Stage', pricing: { model: 'fixed', ratePaise: 1_000_000 }, rules: { maxPerDay: 1 } }).expect(201)).body.id;
      // Two crews, so only the day limit can stop the second booking.
      const a = await customer('9833333333');
      const b = await customer('9844444444');
      await t.db.query(`INSERT INTO resources (vendor_id, kind, name) VALUES ($1, 'crew', 'Team B')`, [decor.id]);
      const line = (e: string, from: string, until: string) => ({ eventId: e, serviceId: svc, startsAt: at(DAY, from), endsAt: at(DAY, until), answers: { theme: 'floral' } });
      const results = await Promise.all([
        as(a.token).post('/v1/engine-bookings', line(a.eventId, '06:00', '10:00')),
        as(b.token).post('/v1/engine-bookings', line(b.eventId, '16:00', '22:00')),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes[0]).toBe(201);
      const failed = results.find((r) => r.status !== 201)!;
      expect(failed.status).toBe(409);
      expect(['DAY_FULL', 'NOT_AVAILABLE']).toContain(failed.body.error.code);
      expect((await t.db.query('SELECT 1 FROM bookings WHERE service_id = $1', [svc])).rowCount).toBe(1);
    });
  });

  describe('changes after booking', () => {
    it('editing the price keeps the booked price; every change is kept with its version; only the owner and admins see it', async () => {
      const dj = await vendor('9811111111', 'dj');
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, plans: DJ_PLANS }).expect(201)).body.id;
      const c = await customer('9833333333');
      const id = (await as(c.token).post('/v1/engine-bookings', { ...djLine(c.eventId, '19:00', '23:00'), serviceId: svc, planId: 'per_hour' }).expect(201)).body.id;
      const before = (await t.db.one<{ amount_paise: number }>(t.db, 'SELECT amount_paise FROM bookings WHERE id = $1', [id]))!.amount_paise;

      const raised = [{ ...DJ_PLANS[0], pricing: { model: 'hourly', ratePaise: 400_000 } }, DJ_PLANS[1]];
      const after = (await as(dj.token).patch(`/v1/partner/engine-services/${svc}`, { plans: raised, eventTypes: ['wedding'] }).expect(200)).body;
      expect(after.configVersion).toBe(2);
      // Saving the same settings again is not a change.
      expect((await as(dj.token).patch(`/v1/partner/engine-services/${svc}`, { plans: raised }).expect(200)).body.configVersion).toBe(2);
      expect((await t.db.one<{ amount_paise: number }>(t.db, 'SELECT amount_paise FROM bookings WHERE id = $1', [id]))!.amount_paise).toBe(before);

      const history = (await as(dj.token).get(`/v1/partner/engine-services/${svc}/history`).expect(200)).body.items;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ version: 2 });
      expect(Object.keys(history[0].changes).sort()).toEqual(['eventTypes', 'plans']);
      expect(history[0].changes.plans.before[0].pricing.ratePaise).toBe(300_000);
      expect(history[0].changes.plans.after[0].pricing.ratePaise).toBe(400_000);

      const other = await vendor('9822222222', 'dj');
      await as(other.token).get(`/v1/partner/engine-services/${svc}/history`).expect(404);
      await as(other.token).patch(`/v1/partner/engine-services/${svc}`, { plans: raised }).expect(404);
      await as(c.token).get(`/v1/partner/engine-services/${svc}/history`).expect(403);
      const verifier = await t.adminLogin('verifier');
      expect((await as(verifier).get(`/v1/admin/services/${svc}/history`).expect(200)).body.items).toHaveLength(1);
      const finance = await t.adminLogin('finance');
      await as(finance).get(`/v1/admin/services/${svc}/history`).expect(403);
    });

    it('a cart line with a wrong plan rolls the whole checkout back', async () => {
      const dj = await vendor('9811111111', 'dj');
      const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, plans: DJ_PLANS }).expect(201)).body.id;
      const decor = await vendor('9822222222', 'decor');
      const stage = (await as(decor.token).post('/v1/partner/engine-services', { title: 'Stage', pricing: { model: 'fixed', ratePaise: 1_000_000 } }).expect(201)).body.id;
      const c = await customer('9833333333');
      const items: Record<string, unknown>[] = [
        { eventId: c.eventId, serviceId: stage, startsAt: at(DAY, '08:00'), endsAt: at(DAY, '14:00'), answers: { theme: 'floral' } },
        { ...djLine(c.eventId, '19:00', '23:00'), serviceId: svc, planId: 'monthly' },
      ];
      expect((await as(c.token).post('/v1/checkouts', { items }).expect(400)).body.error).toMatchObject({ code: 'RATE_PLAN_NOT_FOUND', itemIndex: 1 });
      expect((await t.db.query('SELECT 1 FROM bookings')).rowCount).toBe(0);
      items[1].planId = 'per_hour';
      const done = (await as(c.token).post('/v1/checkouts', { items }).expect(201)).body;
      expect(done.bookings).toHaveLength(2);
    });
  });

  it('a category an admin adds today books through its template and the vendor\'s settings alone', async () => {
    const admin = await t.adminLogin('super');
    const cat = (await as(admin).post('/v1/admin/categories', { nameEn: 'Henna Studio', nameHi: 'हिना स्टूडियो', icon: 'makeup', defaultUnit: 'per_person' }).expect(201)).body;
    await as(admin).patch(`/v1/admin/categories/${cat.id}`, {
      bookingType: 'appointment',
      template: {
        pricingModels: ['per_person', 'fixed'],
        questions: [{ key: 'design', label: bi('Design', 'डिज़ाइन'), type: 'select', required: true, options: [
          { value: 'arabic', label: bi('Arabic', 'अरबी') }, { value: 'bridal', label: bi('Full bridal', 'दुल्हन वाली'), pricePaise: 200_000 },
        ] }],
        rules: { minQty: 1, maxQty: 15, perPersonMin: 45, leadTimeHours: 24 },
      },
    }).expect(200);
    const v = await vendor('9811111111', cat.id);
    const svc = (await as(v.token).post('/v1/partner/engine-services', {
      title: 'Mehendi at home',
      pricing: { model: 'per_person', ratePaise: 50_000 },
      questions: [{ key: 'both_hands', label: bi('Both hands?', 'दोनों हाथ?'), type: 'boolean', required: true }],
      plans: [
        { id: 'guests', name: bi('Guests, per person', 'मेहमान, प्रति व्यक्ति'), pricing: { model: 'per_person', ratePaise: 50_000 } },
        { id: 'bride', name: bi('Bride only, fixed', 'सिर्फ़ दुल्हन'), pricing: { model: 'fixed', ratePaise: 800_000 }, rules: { maxQty: 1 } },
      ],
      eventTypes: ['mehendi', 'wedding'],
    }).expect(201)).body.id;
    const c = await customer('9833333333', 'mehendi');
    const req = { eventId: c.eventId, serviceId: svc, startsAt: at(DAY, '11:00'), people: 4, planId: 'guests', answers: { design: 'arabic', both_hands: true } };
    const q = (await as(c.token).post('/v1/quotes', req).expect(200)).body;
    expect(q.subtotalPaise).toBe(4 * 50_000);
    expect((await as(c.token).post('/v1/quotes', { ...req, planId: 'bride' }).expect(400)).body.error.code).toBe('QUANTITY_OUT_OF_RANGE');
    const id = (await as(c.token).post('/v1/engine-bookings', { ...req, planId: 'bride', people: 1, answers: { design: 'bridal', both_hands: true } }).expect(201)).body.id;
    const b = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
    expect(b.amountPaise).toBe(800_000 + 200_000);
    await as(v.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
  });
});
