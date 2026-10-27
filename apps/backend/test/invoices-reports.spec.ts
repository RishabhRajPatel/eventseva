// GST invoices, refund results from Razorpay webhooks, admin retry of a failed refund, reports and
// the disputes list.
import { todayIst } from '../src/bookings/booking.rules';
import { financialYear } from '../src/payments/invoices.service';
import { FakeGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00+05:30`;
const DAY = inDays(12);

describe('invoices, refunds and reports', () => {
  let t: TestApp;
  let gateway: FakeGateway;
  let cityId: number;
  beforeAll(async () => {
    t = await createTestApp();
    gateway = t.app.get(PAYMENT_GATEWAY);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    gateway.refunds.length = 0;
  });

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const webhook = (event: object) => {
    const body = JSON.stringify(event);
    return t.http().post('/v1/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', FakeGateway.signWebhook(body)).send(body).expect(200);
  };

  /** A confirmed DJ booking at ₹20,000 + 18% GST from a GST-registered vendor. */
  const setup = async (gstin: string | null = '09ABCDE1234F1Z5') => {
    const vt = (await t.login('9811111111', 'partner')).body.accessToken;
    const cat = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const vendorId = (await as(vt).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: cat, cityId, area: 'Civil Lines', address: 'Shop 4, Civil Lines' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now(), gstin = $2 WHERE id = $1`, [vendorId, gstin]);
    const svc = (await as(vt).post('/v1/partner/engine-services', { title: 'DJ night', pricing: { model: 'fixed', ratePaise: 2_000_000, ...(gstin ? { taxPercent: 18 } : {}) } }).expect(201)).body.id;
    const ct = (await t.login('9833333333')).body.accessToken;
    await as(ct).patch('/v1/me', { name: 'Rahul' }).expect(200);
    const e = (await as(ct).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: DAY, cityId, venueAddress: 'Lawn 2, Jhunsi' }).expect(201)).body;
    const id = (await as(ct).post('/v1/engine-bookings', { eventId: e.id, serviceId: svc, startsAt: at(DAY, '18:00'), endsAt: at(DAY, '23:00'), answers: { occasion: 'sangeet' } }).expect(201)).body.id;
    return { vt, ct, id };
  };

  it('works out the Indian financial year', () => {
    expect(financialYear(new Date('2027-03-31T18:00:00Z'))).toBe('2026-27'); // 1 April India time
    expect(financialYear(new Date('2027-03-31T18:29:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T18:31:00Z'))).toBe('2027-28');
  });

  it('issues a tax invoice in the vendor\'s name once confirmed, numbered once, and EventSeva\'s commission invoice', async () => {
    const { vt, ct, id } = await setup();
    expect((await as(ct).get(`/v1/bookings/${id}/invoice`).expect(409)).body.error.code).toBe('INVOICE_NOT_READY');
    await as(vt).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(ct).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    const inv = (await as(ct).get(`/v1/bookings/${id}/invoice`).expect(200)).body;
    expect(inv).toMatchObject({
      title: 'Tax invoice',
      seller: { name: 'Raj DJ', gstin: '09ABCDE1234F1Z5' },
      buyer: { name: 'Rahul', address: 'Lawn 2, Jhunsi' },
      taxablePaise: 2_000_000,
      cgstPaise: 180_000,
      sgstPaise: 180_000,
      totalPaise: 2_360_000,
      paidPaise: 590_000,
    });
    expect(inv.number).toMatch(new RegExp(`/${financialYear(new Date())}/000001$`));
    // Asking again returns the same invoice; the vendor sees the same one.
    expect((await as(ct).get(`/v1/bookings/${id}/invoice`).expect(200)).body.number).toBe(inv.number);
    expect((await as(vt).get(`/v1/partner/bookings/${id}/invoice`).expect(200)).body.number).toBe(inv.number);
    const html = await as(ct).get(`/v1/bookings/${id}/invoice.html`).expect(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('Tax invoice');
    expect(html.text).toContain('₹23,600.00');

    const comm = (await as(vt).get(`/v1/partner/bookings/${id}/commission-invoice`).expect(200)).body;
    expect(comm).toMatchObject({ seller: { name: 'EventSeva' }, buyer: { name: 'Raj DJ', gstin: '09ABCDE1234F1Z5' }, taxablePaise: 200_000 });
    expect(comm.number).toMatch(/^ES\//);
    // Strangers get nothing.
    const other = (await t.login('9844444444')).body.accessToken;
    await as(other).get(`/v1/bookings/${id}/invoice`).expect(404);
    const admin = await t.adminLogin('finance');
    expect((await as(admin).get(`/v1/admin/bookings/${id}/invoices`).expect(200)).body.customer.number).toBe(inv.number);
  });

  it('a vendor without a GST number issues a bill of supply', async () => {
    const { vt, ct, id } = await setup(null);
    await as(vt).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(ct).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    const inv = (await as(ct).get(`/v1/bookings/${id}/invoice`).expect(200)).body;
    expect(inv).toMatchObject({ title: 'Bill of supply', cgstPaise: 0, totalPaise: 2_000_000 });
  });

  it('refund webhooks: processed is recorded; failed alerts the team, who can send it again once', async () => {
    const { vt, ct, id } = await setup();
    await as(vt).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(ct).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    await as(vt).post(`/v1/partner/bookings/${id}/cancel`, { reason: 'Unwell' }).expect(200);
    const r = await t.db.one(t.db, `SELECT id, razorpay_refund_id FROM refunds WHERE booking_id = $1`, [id]);
    await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: r.razorpay_refund_id, status: 'processed' } } } });
    expect((await t.db.one(t.db, 'SELECT status FROM refunds WHERE id = $1', [r.id])).status).toBe('processed');

    await webhook({ event: 'refund.failed', payload: { refund: { entity: { id: r.razorpay_refund_id, status: 'failed', error_description: 'Card closed' } } } });
    expect((await t.db.one(t.db, 'SELECT status FROM refunds WHERE id = $1', [r.id])).status).toBe('failed');
    expect((await t.db.query(`SELECT 1 FROM system_alerts WHERE kind = 'refund_failed'`)).rowCount).toBe(1);
    // Unknown refunds are ignored without error.
    await webhook({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_unknown' } } } });

    const finance = await t.adminLogin('finance');
    expect((await as(finance).get('/v1/admin/refunds?status=failed').expect(200)).body.items).toHaveLength(1);
    const support = await t.adminLogin('support');
    await as(support).post(`/v1/admin/refunds/${r.id}/retry`).expect(403);
    const again = (await as(finance).post(`/v1/admin/refunds/${r.id}/retry`).expect(200)).body;
    expect(again.status).toBe('sent');
    expect(gateway.refunds).toHaveLength(2);
    await as(finance).post(`/v1/admin/refunds/${r.id}/retry`).expect(404);
  });

  it('summary report and disputes list for admins', async () => {
    const { vt, ct, id } = await setup();
    await as(vt).post(`/v1/partner/bookings/${id}/accept`).expect(200);
    await as(ct).post(`/v1/bookings/${id}/pay/dev`).expect(200);
    const finance = await t.adminLogin('finance');
    const rep = (await as(finance).get(`/v1/admin/reports/summary?from=${inDays(0)}&to=${inDays(30)}`).expect(200)).body;
    expect(rep.money).toMatchObject({ bookedValuePaise: '2360000', advancesPaise: '590000' });
    expect(rep.byStatus).toEqual([{ status: 'confirmed', bookingType: 'time_window', bookings: 1, amountPaise: '2360000' }]);
    expect(rep.byCategory[0]).toMatchObject({ slug: 'dj', bookings: 1 });
    const verifier = await t.adminLogin('verifier');
    await as(verifier).get('/v1/admin/reports/summary').expect(403);
    expect((await as(finance).get('/v1/admin/disputes').expect(200)).body).toEqual({ charges: [], inspections: [] });
  });
});
