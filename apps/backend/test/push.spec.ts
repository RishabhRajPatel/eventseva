import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { todayIst } from '../src/bookings/booking.rules';
import { FcmPushSender, parseServiceAccount } from '../src/push/push-sender';
import { PushService } from '../src/push/push.service';
import { createTestApp, TestApp } from './helpers';

const inDays = (n: number) => {
  const d = new Date(`${todayIst()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('FCM HTTP v1 sender', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    project_id: 'eventseva-test',
    client_email: 'push@eventseva-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };

  it('reads the base64 service-account file', () => {
    expect(parseServiceAccount(Buffer.from(JSON.stringify(account)).toString('base64'))).toEqual(account);
    expect(() => parseServiceAccount('not-base64-json')).toThrow(/FIREBASE_SERVICE_ACCOUNT/);
    expect(() => parseServiceAccount(Buffer.from('{}').toString('base64'))).toThrow(/missing/);
  });

  it('signs a Google token request, reuses the token, and sends the message', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      if (String(init.body).includes('"token":"dead"')) {
        return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const sender = new FcmPushSender(account, fakeFetch);
    const msg = { title: 'New booking request', body: 'DJ on 12 Feb', channel: 'bookings' as const, data: { kind: 'booking_requested', bookingId: 'b1' } };

    expect(await sender.send('tok-1', msg)).toBe('ok');
    expect(await sender.send('tok-2', msg)).toBe('ok');
    expect(await sender.send('dead', msg)).toBe('invalid_token');

    const tokenCalls = calls.filter((c) => c.url.includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(String(tokenCalls[0].init.body)).get('assertion')!;
    const claims = jwt.verify(assertion, publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['RS256'] }) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: account.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });

    const send = calls.find((c) => c.url.includes('fcm.googleapis.com'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/eventseva-test/messages:send');
    expect((send.init.headers as Record<string, string>).Authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(String(send.init.body))).toEqual({
      message: {
        token: 'tok-1',
        notification: { title: 'New booking request', body: 'DJ on 12 Feb' },
        data: { kind: 'booking_requested', bookingId: 'b1' },
        android: { priority: 'high', notification: { channel_id: 'bookings', sound: 'default' } },
      },
    });
  });
});

describe('push dispatcher', () => {
  let t: TestApp;
  let push: PushService;
  let cityId: number;

  beforeAll(async () => {
    t = await createTestApp();
    push = t.app.get(PushService);
    cityId = (await t.db.one(t.db, `SELECT id FROM cities LIMIT 1`)).id;
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await t.reset();
    t.push.sent.length = 0;
    t.push.invalid.clear();
  });

  const as = (token: string) => ({
    post: (url: string, body: object = {}) => t.http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => t.http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const device = (token: string, fcmToken: string) => as(token).post('/v1/devices', { fcmToken, platform: 'android' }).expect(204);

  async function setup() {
    const vendor = (await t.login('9811111111', 'partner')).body.accessToken;
    const dj = (await t.db.one(t.db, `SELECT id FROM categories WHERE slug = 'dj'`)).id;
    const v = (await as(vendor).post('/v1/partner/vendor', { businessName: 'Raj DJ', categoryId: dj, cityId }).expect(201)).body;
    const s = (await as(vendor).post('/v1/partner/services', { title: 'DJ', pricePaise: 1_000_000, unit: 'per_event' }).expect(201)).body;
    await t.db.query(`UPDATE vendors SET status = 'approved'`);
    const customer = (await t.login('9822222222')).body.accessToken;
    const event = (await as(customer).post('/v1/events', { title: 'Party', eventType: 'birthday', eventDate: inDays(9), cityId }).expect(201)).body;
    return { vendor, customer, vendorId: v.id as string, serviceId: s.id as string, eventId: event.id as string };
  }

  it('sends each notification once, in the right language, only to the right app', async () => {
    const x = await setup();
    await device(x.vendor, 'vendor-partner-phone');
    // The same vendor also has the customer app on another phone: booking requests must not go there.
    await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '1 minute'`);
    const vendorAsCustomer = (await t.login('9811111111')).body.accessToken;
    await device(vendorAsCustomer, 'vendor-customer-app');
    await device(x.customer, 'customer-phone');
    await as(x.vendor).patch('/v1/me', { language: 'hi' }).expect(200);

    const b = (await as(x.customer).post('/v1/bookings', { eventId: x.eventId, vendorId: x.vendorId, serviceId: x.serviceId, slot: 'day' }).expect(201)).body;
    expect(await push.dispatchPending()).toBe(1);
    expect(t.push.sent).toEqual([
      {
        token: 'vendor-partner-phone',
        message: expect.objectContaining({
          title: 'नई बुकिंग रिक्वेस्ट',
          channel: 'bookings',
          data: expect.objectContaining({ kind: 'booking_requested', bookingId: b.id }),
        }),
      },
    ]);
    expect(await push.dispatchPending()).toBe(0); // never twice

    await as(x.vendor).post(`/v1/partner/bookings/${b.id}/accept`).expect(200);
    await push.dispatchPending();
    expect(t.push.sent.at(-1)).toMatchObject({ token: 'customer-phone', message: { title: 'Vendor accepted' } });
  });

  it('chat pushes use the chat channel; a rolled-back action sends nothing', async () => {
    const x = await setup();
    await device(x.customer, 'customer-phone');
    const conv = (await as(x.customer).post('/v1/conversations', { vendorId: x.vendorId }).expect(201)).body;
    await as(x.vendor).post(`/v1/conversations/${conv.id}/messages`, { body: 'Namaste!' }).expect(201);
    await push.dispatchPending();
    expect(t.push.sent).toEqual([
      { token: 'customer-phone', message: expect.objectContaining({ channel: 'chat', body: 'Namaste!', data: expect.objectContaining({ conversationId: conv.id }) }) },
    ]);

    // A failed booking request (slot blocked) creates no notification and no push.
    await as(x.vendor).post('/v1/partner/calendar/block', { day: inDays(9), slot: 'full' }).expect(204);
    await as(x.customer).post('/v1/bookings', { eventId: x.eventId, vendorId: x.vendorId, serviceId: x.serviceId, slot: 'day' }).expect(409);
    expect(await push.dispatchPending()).toBe(0);
  });

  it('removes tokens of uninstalled apps and skips old notifications', async () => {
    const x = await setup();
    await device(x.vendor, 'gone-token');
    t.push.invalid.add('gone-token');
    await as(x.customer).post('/v1/bookings', { eventId: x.eventId, vendorId: x.vendorId, serviceId: x.serviceId, slot: 'day' }).expect(201);
    await push.dispatchPending();
    expect((await t.db.query('SELECT 1 FROM device_tokens')).rows).toEqual([]);

    await device(x.vendor, 'new-token-1234');
    await t.db.query(`INSERT INTO notifications (user_id, kind, title, body, created_at)
                      SELECT id, 'test', 'Old', 'Old', now() - interval '2 hours' FROM users WHERE phone = '+919811111111'`);
    expect(await push.dispatchPending()).toBe(0);
  });

  it('wakes up on its own right after the transaction commits (LISTEN/NOTIFY)', async () => {
    const x = await setup();
    await device(x.vendor, 'vendor-phone');
    await push.listen();
    await as(x.customer).post('/v1/bookings', { eventId: x.eventId, vendorId: x.vendorId, serviceId: x.serviceId, slot: 'night' }).expect(201);
    for (let i = 0; i < 50 && !t.push.sent.length; i++) await new Promise((r) => setTimeout(r, 50));
    await push.idle();
    expect(t.push.sent.map((s) => s.token)).toEqual(['vendor-phone']);
  });
});
