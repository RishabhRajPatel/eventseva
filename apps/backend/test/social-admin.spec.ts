import { todayIst } from '../src/bookings/booking.rules';
import { BookingsService } from '../src/bookings/bookings.service';
import { maskPhones } from '../src/chat/chat.controller';
import { FakeGateway } from '../src/payments/gateway';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('reviews, chat, notifications, partner home and admin operations', () => {
  let t: TestApp;
  let sweep: () => Promise<unknown>;
  let cityId: number;
  let vendorToken: string;
  let vendorId: string;
  let serviceId: string;
  let customer: string;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
    const service = t.app.get(BookingsService);
    sweep = () => service.sweep();
    cityId = (await t.db.one(t.db, `SELECT id FROM cities WHERE name = 'Prayagraj'`)).id;
  });
  afterAll(() => t.app.close());

  const as = (token: string) => ({
    get: (url: string) => t.http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string) => t.http().put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string, body: object = {}) => t.http().delete(url).set('Authorization', `Bearer ${token}`).send(body),
  });

  beforeEach(async () => {
    await t.reset();
    vendorToken = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    vendorId = (await as(vendorToken).post('/v1/partner/vendor', { businessName: 'Raj DJ Sound', categoryId: dj, cityId, area: 'Civil Lines' }).expect(201)).body.id;
    serviceId = (await as(vendorToken).post('/v1/partner/services', { title: 'Wedding DJ', pricePaise: 1_500_000, unit: 'per_event' }).expect(201)).body.id;
    await t.db.query(`UPDATE vendors SET status = 'approved', approved_at = now()`);
    customer = (await t.login('9822222222')).body.accessToken;
    admin = await t.adminLogin('super');
  });

  /** Request → accept → pay; optionally move the event into the past and run the sweeper. */
  async function booking(opts: { complete?: boolean } = {}) {
    const event = (await as(customer).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(10), cityId }).expect(201)).body;
    const b = (await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot: 'night' }).expect(201)).body;
    await as(vendorToken).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    const order = (await as(customer).post(`/v1/bookings/${b.id}/pay`).expect(200)).body;
    await as(customer)
      .post(`/v1/bookings/${b.id}/pay/verify`, { razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_1', razorpaySignature: FakeGateway.sign(order.orderId, 'pay_1') })
      .expect(200);
    if (opts.complete) {
      await t.db.query(`UPDATE bookings SET day = $1 WHERE id = $2`, [inDays(-1), b.id]);
      await sweep();
    }
    return b.id as string;
  }

  describe('reviews', () => {
    it('only after the event, once; updates the rating; vendor can reply; admin can hide', async () => {
      const early = await booking();
      expect((await as(customer).post(`/v1/bookings/${early}/review`, { rating: 5 }).expect(409)).body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await t.db.query(`UPDATE bookings SET day = $1`, [inDays(-1)]);
      await sweep();

      await as(customer).post(`/v1/bookings/${early}/review`, { rating: 6 }).expect(400);
      expect((await as(customer).get(`/v1/bookings/${early}`)).body).toMatchObject({ reviewed: false, vendor: { categorySlug: 'dj' } });
      const r = (await as(customer).post(`/v1/bookings/${early}/review`, { rating: 4, comment: 'Great sound, came on time' }).expect(201)).body;
      expect((await as(customer).get(`/v1/bookings/${early}`)).body.reviewed).toBe(true);
      expect((await as(customer).post(`/v1/bookings/${early}/review`, { rating: 5 }).expect(409)).body.error.code).toBe('REVIEW_EXISTS');

      const v = (await t.http().get(`/v1/vendors/${vendorId}`).expect(200)).body;
      expect(v.rating).toEqual({ avg: 4, count: 1 });

      await as(vendorToken).post(`/v1/partner/reviews/${r.id}/reply`, { reply: 'Thank you!' }).expect(201);
      const pub = (await t.http().get(`/v1/vendors/${vendorId}/reviews`).expect(200)).body.items;
      expect(pub).toEqual([expect.objectContaining({ rating: 4, vendorReply: 'Thank you!', customerName: 'Customer', eventType: 'wedding' })]);

      await as(admin).post(`/v1/admin/reviews/${r.id}/hide`, { reason: 'Fake review' }).expect(200);
      expect((await t.http().get(`/v1/vendors/${vendorId}/reviews`)).body.items).toEqual([]);
      expect((await t.http().get(`/v1/vendors/${vendorId}`)).body.rating).toEqual({ avg: 0, count: 0 });
    });
  });

  describe('shortlist', () => {
    it('save, list, remove', async () => {
      await as(customer).put(`/v1/shortlist/${vendorId}`).expect(204);
      await as(customer).put(`/v1/shortlist/${vendorId}`).expect(204);
      const items = (await as(customer).get('/v1/shortlist').expect(200)).body.items;
      expect(items).toEqual([expect.objectContaining({ id: vendorId, businessName: 'Raj DJ Sound', cover: null })]);
      await as(customer).delete(`/v1/shortlist/${vendorId}`).expect(204);
      expect((await as(customer).get('/v1/shortlist')).body.items).toEqual([]);
      await as(customer).put('/v1/shortlist/00000000-0000-0000-0000-000000000000').expect(404);
    });
  });

  describe('chat', () => {
    it('masks phone numbers until a booking is confirmed', () => {
      expect(maskPhones('Call me on 98765 43210 or +91-9876543210')).toBe('Call me on •••••••••• or ••••••••••');
      expect(maskPhones('Budget 1500000 for 300 guests')).toBe('Budget 1500000 for 300 guests');
    });

    it('customer starts, vendor replies, unread counts and read receipts, phones hidden before booking', async () => {
      const conv = (await as(customer).post('/v1/conversations', { vendorId }).expect(201)).body;
      expect((await as(customer).post('/v1/conversations', { vendorId }).expect(201)).body.id).toBe(conv.id);
      // The Partner app opens chats from a booking only.
      await as(vendorToken).post('/v1/conversations', { vendorId }).expect(400);

      const sent = (await as(customer).post(`/v1/conversations/${conv.id}/messages`, { body: 'Is 12 Feb free? My number 9822222222' }).expect(201)).body;
      expect(sent).toMatchObject({ mine: true, body: 'Is 12 Feb free? My number ••••••••••' });

      const list = (await as(vendorToken).get('/v1/conversations').expect(200)).body.items;
      expect(list).toEqual([expect.objectContaining({ id: conv.id, unreadCount: 1, customerName: 'Customer', hasBooking: false })]);
      const msgs = (await as(vendorToken).get(`/v1/conversations/${conv.id}/messages`).expect(200)).body;
      expect(msgs).toMatchObject({ phoneShared: false, items: [{ mine: false, body: 'Is 12 Feb free? My number ••••••••••' }] });
      expect((await as(vendorToken).get('/v1/conversations')).body.items[0].unreadCount).toBe(0);

      await as(vendorToken).post(`/v1/conversations/${conv.id}/messages`, { body: 'Yes, free.' }).expect(201);
      expect((await as(customer).get('/v1/conversations')).body.items[0]).toMatchObject({ unreadCount: 1, lastMessage: 'Yes, free.' });

      // Strangers cannot read it.
      const other = (await t.login('9833333333')).body.accessToken;
      await as(other).get(`/v1/conversations/${conv.id}/messages`).expect(404);

      // After a confirmed booking, numbers are shown.
      await booking();
      const after = (await as(customer).get(`/v1/conversations/${conv.id}/messages`)).body;
      expect(after.phoneShared).toBe(true);
      expect(after.items.at(-1).body).toBe('Is 12 Feb free? My number 9822222222');
    });
  });

  it('vendor can open the chat from a booking; booking shows guests and venue (venue after payment)', async () => {
    const event = (await as(customer).post('/v1/events', { title: 'Shaadi', eventType: 'wedding', eventDate: inDays(9), cityId, guestCount: 300, venueAddress: 'Civil Lines, Prayagraj' }).expect(201)).body;
    const b = (await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot: 'night' }).expect(201)).body;
    const req = (await as(vendorToken).get(`/v1/partner/bookings/${b.id}`).expect(200)).body;
    expect(req.event).toMatchObject({ guestCount: 300, venueAddress: null });
    // The request itself opens the chat (with a "Booking requested" line), so both sides land in the same one.
    expect(req.conversationId).toBeTruthy();

    const conv = (await as(vendorToken).post('/v1/conversations', { bookingId: b.id }).expect(201)).body;
    expect(conv.id).toBe(req.conversationId);
    expect((await as(customer).post('/v1/conversations', { vendorId }).expect(201)).body.id).toBe(conv.id);
    expect((await as(customer).get(`/v1/bookings/${b.id}`)).body.event.venueAddress).toBe('Civil Lines, Prayagraj');

    const stranger = (await t.login('9844444444', 'partner')).body.accessToken;
    await as(stranger).post('/v1/conversations', { bookingId: b.id }).expect(404);
  });

  describe('notifications and devices', () => {
    it('lists newest first with an unread count; read one or all', async () => {
      await booking(); // creates several notifications for both sides
      const list = (await as(customer).get('/v1/notifications').expect(200)).body;
      expect(list.unreadCount).toBe(2);
      expect(list.items.map((n: { kind: string }) => n.kind)).toEqual(['booking_confirmed', 'booking_accepted']);
      await as(customer).post('/v1/notifications/read', { ids: [list.items[0].id] }).expect(204);
      expect((await as(customer).get('/v1/notifications')).body.unreadCount).toBe(1);
      await as(customer).post('/v1/notifications/read', {}).expect(204);
      expect((await as(customer).get('/v1/notifications')).body.unreadCount).toBe(0);
    });

    it('a push token belongs to the last user who logged in on that phone', async () => {
      const token = 'fcm-token-abcdefghijk';
      await as(customer).post('/v1/devices', { fcmToken: token, platform: 'android' }).expect(204);
      await as(vendorToken).post('/v1/devices', { fcmToken: token, platform: 'android' }).expect(204);
      const { rows } = await t.db.query('SELECT u.phone FROM device_tokens d JOIN users u ON u.id = d.user_id');
      expect(rows).toEqual([{ phone: '+919811111111' }]);
      await as(vendorToken).delete('/v1/devices', { fcmToken: token }).expect(204);
      expect((await t.db.query('SELECT 1 FROM device_tokens')).rows).toEqual([]);
    });
  });

  describe('partner home', () => {
    it('dashboard and earnings', async () => {
      const event = (await as(customer).post('/v1/events', { title: 'Party', eventType: 'birthday', eventDate: inDays(5), cityId }).expect(201)).body;
      await as(customer).post('/v1/bookings', { eventId: event.id, vendorId, serviceId, slot: 'day' }).expect(201);
      const dash = (await as(vendorToken).get('/v1/partner/dashboard').expect(200)).body;
      expect(dash).toMatchObject({ status: 'approved', newRequests: 1, awaitingPayment: 0, upcoming: [] });

      const id = await booking({ complete: true });
      const day = inDays(-1);
      const earn = (await as(vendorToken).get(`/v1/partner/earnings?month=${day.slice(0, 7)}`).expect(200)).body;
      expect(earn).toMatchObject({ bookings: 1, grossPaise: 1_500_000, commissionPaise: 150_000, payoutPaise: 225_000, collectAtEventPaise: 1_125_000 });
      expect(earn.payouts).toEqual([expect.objectContaining({ bookingId: id, amountPaise: 225_000, status: 'scheduled', eventTitle: 'Shaadi' })]);
      await as(customer).get('/v1/partner/dashboard').expect(403);
    });
  });

  describe('complaints', () => {
    it('raised by a customer, resolved by support with a notification', async () => {
      const bookingId = await booking();
      const c = (await as(customer).post('/v1/complaints', { bookingId, subject: 'DJ late', details: 'The DJ came two hours late.' }).expect(201)).body;
      const stranger = (await t.login('9833333333')).body.accessToken;
      await as(stranger).post('/v1/complaints', { bookingId, subject: 'x y z', details: 'Not my booking at all' }).expect(404);

      const support = await t.adminLogin('support');
      const queue = (await as(support).get('/v1/admin/complaints?status=open').expect(200)).body.items;
      expect(queue).toEqual([expect.objectContaining({ id: c.id, raisedByPhone: '+919822222222', raisedByVendor: false })]);
      await as(support).post(`/v1/admin/complaints/${c.id}`, { status: 'resolved' }).expect(400);
      await as(support).post(`/v1/admin/complaints/${c.id}`, { status: 'resolved', resolution: '₹500 refunded as goodwill' }).expect(200);
      expect((await as(customer).get('/v1/complaints')).body.items[0]).toMatchObject({ status: 'resolved', resolution: '₹500 refunded as goodwill' });
      const n = (await as(customer).get('/v1/notifications')).body.items[0];
      expect(n).toMatchObject({ kind: 'complaint_resolved', title: 'Your complaint is resolved' });
    });
  });

  describe('admin operations', () => {
    it('dashboard numbers', async () => {
      await booking();
      const d = (await as(admin).get('/v1/admin/dashboard').expect(200)).body;
      expect(d).toMatchObject({ liveVendors: 1, pendingVendors: 0, users: 2, bookingsToday: 1, openComplaints: 0 });
      expect(d.last14Days).toHaveLength(14);
      expect(d.last14Days.at(-1)).toEqual({ day: todayIst(), bookings: 1 });
      expect(d.bookingsByStatus).toEqual({ confirmed: 1 });
    });

    it('bookings list, search and detail with payments', async () => {
      const id = await booking();
      const list = (await as(admin).get('/v1/admin/bookings?q=Raj').expect(200)).body.items;
      expect(list).toEqual([expect.objectContaining({ id, vendorName: 'Raj DJ Sound', status: 'confirmed' })]);
      expect((await as(admin).get('/v1/admin/bookings?q=nomatch')).body.items).toEqual([]);
      const detail = (await as(admin).get(`/v1/admin/bookings/${id}`).expect(200)).body;
      expect(detail.payments).toEqual([expect.objectContaining({ type: 'advance', status: 'paid', amountPaise: 375_000 })]);
      expect(detail.customer.phone).toBe('+919822222222');
    });

    it('payouts: finance marks a due payout paid; the vendor is told', async () => {
      const id = await booking({ complete: true });
      const finance = await t.adminLogin('finance');
      const support = await t.adminLogin('support');
      await as(support).get('/v1/admin/payouts').expect(403);
      const payouts = (await as(finance).get('/v1/admin/payouts?status=scheduled').expect(200)).body.items;
      expect(payouts).toEqual([expect.objectContaining({ bookingId: id, amountPaise: 225_000, bankStatus: null })]);
      await as(finance).post(`/v1/admin/payouts/${payouts[0].id}/mark-paid`, { reference: 'UTR123456789' }).expect(200);
      expect((await as(finance).post(`/v1/admin/payouts/${payouts[0].id}/mark-paid`, { reference: 'UTR123456789' }).expect(409)).body.error.code).toBe('PAYOUT_BAD_STATUS');
      const earn = (await as(vendorToken).get(`/v1/partner/earnings?month=${inDays(-1).slice(0, 7)}`)).body;
      expect(earn.payouts[0].status).toBe('paid');
    });

    it('blocking a user logs them out at once', async () => {
      const users = (await as(admin).get('/v1/admin/users?q=9822222222').expect(200)).body.items;
      expect(users).toHaveLength(1);
      await as(admin).post(`/v1/admin/users/${users[0].id}/block`, { reason: 'Fraud' }).expect(200);
      await as(customer).get('/v1/me').expect(401);
      await as(admin).post(`/v1/admin/users/${users[0].id}/unblock`).expect(200);
    });

    it('media moderation', async () => {
      const m = await t.db.one(
        t.db,
        `INSERT INTO media (vendor_id, type, public_id, width, height, bytes, file_hash, status)
         VALUES ($1, 'photo', 'eventseva/v1/abc', 1600, 1200, 300000, 'hash1', 'pending') RETURNING id`,
        [vendorId],
      );
      expect((await t.http().get(`/v1/vendors/${vendorId}`)).body.media).toEqual([]);
      const owner = (await as(vendorToken).get('/v1/partner/vendor')).body.media;
      expect(owner).toEqual([expect.objectContaining({ publicId: 'eventseva/v1/abc', status: 'pending' })]);

      const verifier = await t.adminLogin('verifier');
      expect((await as(verifier).get('/v1/admin/media').expect(200)).body.items).toHaveLength(1);
      await as(verifier).post(`/v1/admin/media/${m.id}/approve`).expect(200);
      const pub = (await t.http().get(`/v1/vendors/${vendorId}`)).body.media;
      expect(pub).toEqual([expect.objectContaining({ publicId: 'eventseva/v1/abc', width: 1600 })]);
      expect(pub[0].status).toBeUndefined();
      expect((await t.http().get('/v1/vendors')).body.items[0].cover).toMatchObject({ publicId: 'eventseva/v1/abc' });
    });
  });
});
