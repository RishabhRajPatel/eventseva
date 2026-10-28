// Vendor-configurable services, part 2: more question types (long text, date, time) and questions shown
// only after an earlier answer; rental price rules and availability; the day limit on a reschedule; an
// admin taking a service off the app; and the day view a customer's time picker reads.
import { todayIst } from '../src/bookings/booking.rules';
import { checkFields, checkValues } from '../src/engine/rules';
import type { FieldDef } from '../src/engine/types';
import { signParams } from '../src/media/cloudinary.service';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const DAY = inDays(20);
const NEXT = inDays(21);
const bi = (en: string, hi = en) => ({ en, hi });

describe('question types and conditions (pure)', () => {
  const fields: FieldDef[] = [
    { key: 'venue_type', label: bi('Venue'), type: 'select', required: true, options: [{ value: 'indoor', label: bi('Indoor') }, { value: 'outdoor', label: bi('Outdoor') }] },
    { key: 'power_backup', label: bi('Generator needed?'), type: 'boolean', required: true, showIf: { key: 'venue_type', values: ['outdoor'] } },
    { key: 'brief', label: bi('Tell us more'), type: 'longtext', maxLength: 1000 },
    { key: 'mehendi_date', label: bi('Mehendi date'), type: 'date' },
    { key: 'arrive_by', label: bi('Arrive by'), type: 'time' },
  ];

  it('checks the schema: types, conditions on earlier questions only, plain-text labels', () => {
    expect(checkFields(fields, 'questions')).toHaveLength(5);
    expect(() => checkFields([{ ...fields[1], showIf: { key: 'venue_type', values: ['x'] } }, fields[0]], 'questions')).toThrow(/earlier question/);
    expect(() => checkFields([{ key: 'a', label: bi('<b>Hi</b>'), type: 'text' }], 'questions')).toThrow(/no < >/);
    expect(() => checkFields([{ key: 'a', label: bi('A'), type: 'file' as never }], 'questions')).toThrow(/unknown type/);
  });

  it('a hidden question is not asked and its answer is dropped; a shown one is required', () => {
    expect(checkValues(fields, { venue_type: 'indoor', power_backup: true }, 'answers')).toEqual({ venue_type: 'indoor' });
    expect(() => checkValues(fields, { venue_type: 'outdoor' }, 'answers')).toThrow(/required/);
    expect(checkValues(fields, { venue_type: 'outdoor', power_backup: false, brief: ' Garden lawn \n near gate ', mehendi_date: '2026-12-01', arrive_by: '17:30' }, 'answers'))
      .toEqual({ venue_type: 'outdoor', power_backup: false, brief: 'Garden lawn \n near gate', mehendi_date: '2026-12-01', arrive_by: '17:30' });
    for (const bad of [{ mehendi_date: '2026-02-30' }, { arrive_by: '25:00' }, { brief: 'x'.repeat(1001) }, { brief: 'bad \u0007 bell' }]) {
      expect(() => checkValues(fields, { venue_type: 'indoor', ...bad }, 'answers')).toThrow(/not valid/);
    }
  });
});

describe('vendor-configurable booking engine, part 2', () => {
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
    put: (url: string, body: object = {}) => t.http().put(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const vendor = async (phone: string, slug: string) => {
    const token = (await t.login(phone, 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = $1`, [slug])).id;
    const id = (await as(token).post('/v1/partner/vendor', { businessName: `Vendor ${phone.slice(-3)}`, categoryId: cat, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), lat = 25.4358, lng = 81.8463 WHERE id = $1`, [id]);
    return { token, id: id as string };
  };
  const customer = async (phone: string, day = DAY) => {
    const token = (await t.login(phone)).body.accessToken;
    const e = (await as(token).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: day, cityId, venueAddress: 'Civil Lines', venueLat: 25.45, venueLng: 81.85 }).expect(201)).body;
    return { token, eventId: e.id as string };
  };
  const djLine = (eventId: string, serviceId: string, day: string, from: string, until: string, answers: object = { occasion: 'sangeet' }) =>
    ({ eventId, serviceId, startsAt: at(day, from), endsAt: at(day, until), answers });

  it('vendor questions with a condition, long text, date and time go through a real booking', async () => {
    const dj = await vendor('9811111111', 'dj');
    const questions = [
      { key: 'venue_type', label: bi('Indoor or outdoor?'), type: 'select', required: true, options: [{ value: 'indoor', label: bi('Indoor') }, { value: 'outdoor', label: bi('Outdoor') }] },
      { key: 'generator', label: bi('Generator needed?'), type: 'boolean', required: true, showIf: { key: 'venue_type', values: ['outdoor'] } },
      { key: 'brief', label: bi('Anything else?'), type: 'longtext' },
      { key: 'arrive_by', label: bi('Arrive by'), type: 'time', help: bi('India time', 'भारत का समय') },
    ];
    const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, questions }).expect(201)).body.id;
    const c = await customer('9833333333');
    const base = djLine(c.eventId, svc, DAY, '19:00', '23:00');
    const ask = (answers: object) => as(c.token).post('/v1/quotes', { ...base, answers: { occasion: 'sangeet', ...answers } });
    expect((await ask({ venue_type: 'outdoor' }).expect(400)).body.error).toMatchObject({ code: 'ANSWER_REQUIRED', field: 'generator' });
    await ask({ venue_type: 'indoor' }).expect(200);
    expect((await ask({ venue_type: 'indoor', arrive_by: '7 pm' }).expect(400)).body.error.code).toBe('ANSWER_INVALID');
    const id = (await as(c.token).post('/v1/engine-bookings', { ...base, answers: { occasion: 'sangeet', venue_type: 'indoor', generator: true, brief: 'Lawn\nNo smoke', arrive_by: '17:30' } }).expect(201)).body.id;
    const b = (await as(c.token).get(`/v1/bookings/${id}`).expect(200)).body;
    // The hidden question's answer was dropped; the booking shows the questions as they were answered.
    expect(b.answers).toMatchObject({ venue_type: 'indoor', brief: 'Lawn\nNo smoke', arrive_by: '17:30' });
    expect(b.answers.generator).toBeUndefined();
    expect(b.questions.map((q: { key: string }) => q.key)).toEqual(expect.arrayContaining(['occasion', 'venue_type', 'generator', 'brief', 'arrive_by']));
  });

  it('rentals: price rules apply to the rent (not delivery); working days and blocked dates hold; changes are kept', async () => {
    const tent = await vendor('9811111111', 'tent');
    const cats = (await as(tent.token).get('/v1/partner/item-categories').expect(200)).body.items;
    const chair = (await as(tent.token).post('/v1/partner/inventory', {
      name: 'Plastic chair', categoryId: cats.find((x: { key: string }) => x.key === 'furniture').id, unit: 'piece', rentPaise: 1_000, totalQty: 100, depositPaise: 0,
    }).expect(201)).body;
    const settings = {
      deliveryFeePaise: 50_000,
      adjustments: [{ label: bi('Wedding season', 'शादी का सीज़न'), from: DAY, until: NEXT, percent: 50 }],
      workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday(inDays(25))),
      blockedDates: [inDays(26)],
    };
    await as(tent.token).put('/v1/partner/rental-settings', { ...settings, adjustments: [{ label: bi('x'), percent: 999 }] }).expect(400);
    const saved = (await as(tent.token).put('/v1/partner/rental-settings', settings).expect(200)).body;
    expect(saved).toMatchObject({ workingDays: settings.workingDays, blockedDates: settings.blockedDates, adjustments: settings.adjustments });
    const serviceId = (await t.db.one(t.db, `SELECT id FROM services WHERE vendor_id = $1 AND booking_type = 'rental'`, [tent.id])).id;
    const c = await customer('9833333333');
    const body = (from: string, until: string) => ({ eventId: c.eventId, serviceId, startsAt: from, endsAt: until, lines: [{ itemId: chair.id, qty: 100 }] });
    const q = (await as(c.token).post('/v1/quotes', body(at(DAY, '10:00'), at(NEXT, '10:00'))).expect(200)).body;
    const rule = q.lines.find((l: { code: string }) => l.code === 'rule_0');
    const rent = q.lines.filter((l: { code: string }) => l.code.startsWith('item_')).reduce((s: number, l: { amountPaise: number }) => s + l.amountPaise, 0);
    expect(rule.amountPaise).toBe(rent / 2);
    const c2 = await customer('9844444444', inDays(25));
    const body2 = (day: string) => ({ eventId: c2.eventId, serviceId, startsAt: at(day, '10:00'), endsAt: at(day, '20:00'), lines: [{ itemId: chair.id, qty: 10 }] });
    expect((await as(c2.token).post('/v1/quotes', body2(inDays(25))).expect(400)).body.error.code).toBe('CLOSED_THAT_DAY');
    expect((await as(c2.token).post('/v1/quotes', body2(inDays(26))).expect(400)).body.error.code).toBe('DATE_BLOCKED');
    const history = (await t.db.query(`SELECT version, changes FROM service_config_history WHERE service_id = $1`, [serviceId])).rows;
    expect(history).toHaveLength(1);
    expect(Object.keys(history[0].changes).sort()).toEqual(['pricing', 'rules']);
  });

  it('a reschedule onto a full day is refused; moving within the same day is fine', async () => {
    const dj = await vendor('9811111111', 'dj');
    const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, rules: { maxPerDay: 1 } }).expect(201)).body.id;
    const confirm = async (c: { token: string; eventId: string }, day: string) => {
      const id = (await as(c.token).post('/v1/engine-bookings', djLine(c.eventId, svc, day, '19:00', '22:00')).expect(201)).body.id;
      await as(dj.token).post(`/v1/partner/bookings/${id}/accept`).expect(200);
      await as(c.token).post(`/v1/bookings/${id}/pay/dev`).expect(200);
      return id as string;
    };
    const a = await customer('9833333333');
    await confirm(a, DAY);
    const b = await customer('9844444444', NEXT);
    const id = await confirm(b, NEXT);
    expect((await as(b.token).post(`/v1/bookings/${id}/changes`, { kind: 'reschedule', startsAt: at(DAY, '19:00'), endsAt: at(DAY, '22:00') }).expect(409)).body.error.code).toBe('DAY_FULL');
    await as(b.token).post(`/v1/bookings/${id}/changes`, { kind: 'reschedule', startsAt: at(NEXT, '18:00'), endsAt: at(NEXT, '21:00') }).expect(201);
  });

  it('an admin takes a service off the app with a reason, and puts it back; audited and told to the vendor', async () => {
    const dj = await vendor('9811111111', 'dj');
    const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 } }).expect(201)).body.id;
    const finance = await t.adminLogin('finance');
    await as(finance).patch(`/v1/admin/services/${svc}/status`, { active: false, reason: 'Misleading price' }).expect(403);
    await as(dj.token).patch(`/v1/admin/services/${svc}/status`, { active: false, reason: 'Misleading price' }).expect(401);
    const verifier = await t.adminLogin('verifier');
    await as(verifier).patch(`/v1/admin/services/${svc}/status`, { active: false }).expect(400);
    await as(verifier).patch(`/v1/admin/services/${svc}/status`, { active: true }).expect(409);
    await as(verifier).patch(`/v1/admin/services/${svc}/status`, { active: false, reason: 'Misleading price' }).expect(200);

    expect((await t.http().get(`/v1/vendors/${dj.id}/engine-services`).expect(200)).body.items).toHaveLength(0);
    const c = await customer('9833333333');
    expect((await as(c.token).post('/v1/quotes', djLine(c.eventId, svc, DAY, '19:00', '22:00')).expect(404)).body.error.code).toBe('ITEM_NOT_FOUND');
    const mine = (await as(dj.token).get('/v1/partner/engine-services').expect(200)).body.items;
    expect(mine[0]).toMatchObject({ isActive: false, disabledReason: 'Misleading price' });
    expect((await as(dj.token).patch(`/v1/partner/engine-services/${svc}`, { title: 'DJ 2' }).expect(409)).body.error).toMatchObject({ code: 'SERVICE_DISABLED', reason: 'Misleading price' });
    expect((await t.db.query(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone LIKE '%9811111111' AND n.kind = 'service_status'`)).rowCount).toBe(1);

    await as(verifier).patch(`/v1/admin/services/${svc}/status`, { active: true }).expect(200);
    await as(c.token).post('/v1/quotes', djLine(c.eventId, svc, DAY, '19:00', '22:00')).expect(200);
    const actions = (await t.db.query(`SELECT action FROM admin_audit_log WHERE target_type = 'service' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(['service.disable', 'service.enable']);
    const history = (await as(verifier).get(`/v1/admin/services/${svc}/history`).expect(200)).body.items;
    expect(history.map((h: { changes: { active: { after: boolean }; note?: string } }) => [h.changes.active.after, h.changes.note ?? null])).toEqual([[true, null], [false, 'Misleading price']]);
  });

  it('the day view: why a day is not offered, the notice, and when the team is already taken', async () => {
    const dj = await vendor('9811111111', 'dj');
    const svc = (await as(dj.token).post('/v1/partner/engine-services', {
      title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 },
      rules: { workingDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekday(NEXT)), blockedDates: [inDays(22)], maxAdvanceDays: 30, maxPerDay: 2 },
    }).expect(201)).body.id;
    const day = (date: string, planId?: string) => t.http().get(`/v1/vendors/${dj.id}/engine-services/${svc}/day`).query({ date, ...(planId ? { planId } : {}) });
    expect((await day(NEXT).expect(200)).body).toMatchObject({ open: false, reason: 'closed' });
    expect((await day(inDays(22)).expect(200)).body).toMatchObject({ open: false, reason: 'blocked' });
    expect((await day(inDays(40)).expect(200)).body).toMatchObject({ open: false, reason: 'too_far' });
    expect((await day(inDays(-1)).expect(200)).body).toMatchObject({ open: false, reason: 'past' });
    await day('2026-13-01').expect(400);
    await day(DAY, 'weekly').expect(400);

    const free = (await day(DAY).expect(200)).body;
    expect(free).toMatchObject({ open: true, reason: null, busy: [], setupMin: 90, afterMin: 60, maxPerDay: 2, booked: 0 });
    const c = await customer('9833333333');
    await as(c.token).post('/v1/engine-bookings', djLine(c.eventId, svc, DAY, '19:00', '22:00')).expect(201);
    const taken = (await day(DAY).expect(200)).body;
    expect(taken.booked).toBe(1);
    // The team is busy from set-up (90 min before) to after packing up (60 min after); nothing about who.
    expect(taken.busy).toEqual([{ from: new Date(at(DAY, '17:30')).toISOString(), until: new Date(at(DAY, '23:00')).toISOString() }]);
    expect(JSON.stringify(taken)).not.toMatch(/9833333333|customer/);
  });

  it('daily breaks: a booking may not run through one, and the day view shows them as taken', async () => {
    const dj = await vendor('9811111111', 'dj');
    await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, rules: { breaks: [{ from: '14:00', to: '13:00' }] } }).expect(400);
    const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, rules: { breaks: [{ from: '13:00', to: '14:00' }] } }).expect(201)).body.id;
    const c = await customer('9833333333');
    expect((await as(c.token).post('/v1/quotes', djLine(c.eventId, svc, DAY, '12:00', '15:00')).expect(400)).body.error).toMatchObject({ code: 'DURING_BREAK', from: '13:00', to: '14:00' });
    await as(c.token).post('/v1/quotes', djLine(c.eventId, svc, DAY, '10:00', '13:00')).expect(200);
    await as(c.token).post('/v1/quotes', djLine(c.eventId, svc, DAY, '14:00', '18:00')).expect(200);
    const day = (await t.http().get(`/v1/vendors/${dj.id}/engine-services/${svc}/day`).query({ date: DAY }).expect(200)).body;
    expect(day.breaks).toEqual([{ from: '13:00', to: '14:00' }]);
    expect(day.busy).toEqual([{ from: new Date(at(DAY, '13:00')).toISOString(), until: new Date(at(DAY, '14:00')).toISOString() }]);
  });

  it('several teams: that many bookings can overlap, one more is refused, and the day view shows when all are out', async () => {
    const decor = await vendor('9811111111', 'decor');
    const svc = (await as(decor.token).post('/v1/partner/engine-services', { title: 'Stage', pricing: { model: 'fixed', ratePaise: 1_000_000 }, rules: { maxConcurrent: 2 } }).expect(201)).body.id;
    await as(decor.token).post('/v1/partner/engine-services', { title: 'X', pricing: { model: 'fixed', ratePaise: 1_000_000 }, rules: { maxConcurrent: 500 } }).expect(400);
    const line = (e: string, from: string, until: string) => ({ eventId: e, serviceId: svc, startsAt: at(DAY, from), endsAt: at(DAY, until), answers: { theme: 'floral' } });
    const people = await Promise.all(['9833333333', '9844444444', '9855555555'].map((p) => customer(p)));
    const results = await Promise.all(people.map((c) => as(c.token).post('/v1/engine-bookings', line(c.eventId, '12:00', '16:00'))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('NOT_AVAILABLE');
    const day = (await t.http().get(`/v1/vendors/${decor.id}/engine-services/${svc}/day`).query({ date: DAY }).expect(200)).body;
    // Both teams are out from set-up (4 h before) to after dismantling (2 h after).
    expect(day.busy).toEqual([{ from: new Date(at(DAY, '08:00')).toISOString(), until: new Date(at(DAY, '18:00')).toISOString() }]);
  });

  it('a photo answer must be the customer\'s own signed upload; only the customer and the vendor can open it', async () => {
    const dj = await vendor('9811111111', 'dj');
    const questions = [{ key: 'venue_photo', label: bi('Photo of the venue'), type: 'photo', required: true }];
    const svc = (await as(dj.token).post('/v1/partner/engine-services', { title: 'DJ', pricing: { model: 'hourly', ratePaise: 300_000 }, questions }).expect(201)).body.id;
    const c = await customer('9833333333');
    const me = (await t.db.one<{ id: string }>(t.db, `SELECT id FROM users WHERE phone LIKE '%9833333333'`))!.id;
    const sign = (await as(c.token).post('/v1/me/answer-upload').expect(200)).body;
    expect(sign.folder ?? sign.params?.folder ?? JSON.stringify(sign)).toContain(`eventseva/customers/${me}/answers`);
    const upload = (publicId: string, signature?: string) => ({ publicId, version: 7, format: 'jpg', signature: signature ?? signParams({ public_id: publicId, version: 7 }, 'test-secret') });
    const body = (photo: object) => ({ ...djLine(c.eventId, svc, DAY, '19:00', '22:00', { occasion: 'sangeet', venue_photo: photo }) });
    // Someone else's file, or a forged signature, is refused.
    expect((await as(c.token).post('/v1/engine-bookings', body(upload('eventseva/customers/someone/answers/a'))).expect(403)).body.error.code).toBe('UPLOAD_INVALID');
    expect((await as(c.token).post('/v1/engine-bookings', body(upload(`eventseva/customers/${me}/answers/a`, 'ab'.repeat(20)))).expect(403)).body.error.code).toBe('UPLOAD_INVALID');
    expect((await as(c.token).post('/v1/engine-bookings', body({ publicId: 'x', version: 7, format: 'exe', signature: 'x' })).expect(400)).body.error.code).toBe('ANSWER_INVALID');
    const id = (await as(c.token).post('/v1/engine-bookings', body(upload(`eventseva/customers/${me}/answers/venue1`))).expect(201)).body.id;
    // Only the file's id and format are kept.
    const saved = (await t.db.one<{ snapshot: { answers: Record<string, unknown> } }>(t.db, 'SELECT snapshot FROM bookings WHERE id = $1', [id]))!.snapshot.answers.venue_photo;
    expect(saved).toEqual({ publicId: `eventseva/customers/${me}/answers/venue1`, format: 'jpg' });
    const mine = (await as(c.token).get(`/v1/bookings/${id}/answer-files/venue_photo`).expect(200)).body;
    expect(mine.url).toMatch(/^https:\/\/api\.cloudinary\.com\/v1_1\/testcloud\/image\/download\?/);
    await as(dj.token).get(`/v1/partner/bookings/${id}/answer-files/venue_photo`).expect(200);
    const other = await vendor('9822222222', 'dj');
    await as(other.token).get(`/v1/partner/bookings/${id}/answer-files/venue_photo`).expect(404);
    const stranger = await customer('9844444444');
    await as(stranger.token).get(`/v1/bookings/${id}/answer-files/venue_photo`).expect(404);
    await as(c.token).get(`/v1/bookings/${id}/answer-files/occasion`).expect(404);
  });
});
