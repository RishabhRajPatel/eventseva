import { createTestApp, TestApp } from './helpers';

const PHONE = '9876543210';
const E164 = '+919876543210';

describe('auth (phone + OTP)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const send = (phone = PHONE) => t.http().post('/v1/auth/otp/send').send({ phone });
  const verify = (code: string, phone = PHONE, app = 'customer') =>
    t.http().post('/v1/auth/otp/verify').send({ phone, code, app });
  /** Pretends the last code was sent long ago, to step past the 30-second resend wait. */
  const ageLastOtp = (seconds: number) =>
    t.db.query(
      `UPDATE otp_requests SET created_at = created_at - make_interval(secs => $1) WHERE phone = $2`,
      [seconds, E164],
    );

  it('rejects a number that is not an Indian mobile', async () => {
    const res = await send('12345').expect(400);
    expect(res.body.error.code).toBe('INVALID_PHONE');
  });

  it('accepts +91 and spaces, and only the hash of the code is stored', async () => {
    const res = await send('+91 98765 43210').expect(200);
    expect(res.body).toEqual({ sent: true, expiresInSec: 300, resendAfterSec: 30 });
    const code = t.sms.lastCode(E164)!;
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await t.db.query('SELECT code_hash FROM otp_requests WHERE phone = $1', [E164]);
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('logs in a new user, then the same user again', async () => {
    const first = await t.login(PHONE);
    expect(first.body).toMatchObject({
      isNewUser: true,
      accessExpiresInSec: 900,
      user: { phone: E164, name: null, language: 'en' },
      vendor: null,
    });
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.refreshToken).toBeTruthy();

    await ageLastOtp(60);
    const second = await t.login(PHONE);
    expect(second.body.isNewUser).toBe(false);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('validates the body', async () => {
    const res = await verify('12ab', PHONE).expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
    const extra = await t.http().post('/v1/auth/otp/send').send({ phone: PHONE, admin: true }).expect(400);
    expect(extra.body.error.code).toBe('VALIDATION');
  });

  it('counts wrong codes and locks after 5', async () => {
    await send().expect(200);
    const right = t.sms.lastCode(E164)!;
    const wrong = right === '000000' ? '111111' : '000000';

    for (let left = 4; left >= 1; left--) {
      const res = await verify(wrong).expect(400);
      expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: left });
    }
    const fifth = await verify(wrong).expect(429);
    expect(fifth.body.error.code).toBe('OTP_LOCKED');
    // Even the right code no longer works, and no new code can be requested.
    expect((await verify(right).expect(429)).body.error.code).toBe('OTP_LOCKED');
    await ageLastOtp(60);
    expect((await send().expect(429)).body.error.code).toBe('OTP_LOCKED');
    // After 15 minutes the lock is gone.
    await ageLastOtp(15 * 60);
    await send().expect(200);
  });

  it('asks to wait 30 seconds between codes', async () => {
    await send().expect(200);
    const res = await send().expect(429);
    expect(res.body.error.code).toBe('OTP_TOO_SOON');
    expect(res.body.error.retryAfterSec).toBeGreaterThan(0);
    expect(res.body.error.retryAfterSec).toBeLessThanOrEqual(30);
  });

  it('allows at most 5 codes per phone per hour', async () => {
    for (let i = 0; i < 5; i++) {
      await send().expect(200);
      await ageLastOtp(31);
    }
    expect((await send().expect(429)).body.error.code).toBe('OTP_LIMIT');
  });

  it('daily limits are rolling 24 hours, so midnight resets nothing (5 at 11:59 pm still block 12:01 am)', async () => {
    // Five codes sent "at 11:59 pm": 2 minutes ago, spaced so the 30-second wait never applies.
    for (let i = 0; i < 5; i++) {
      await t.db.query(
        `INSERT INTO otp_requests (phone, code_hash, expires_at, created_at)
         VALUES ($1, 'x', now(), now() - make_interval(secs => $2))`,
        [E164, 120 + i * 40],
      );
    }
    // "12:01 am": the hourly limit blocks first, and says when to come back.
    let res = await send().expect(429);
    expect(res.body.error.code).toBe('OTP_LIMIT');

    // Two hours later the hourly window is clear, but the 24-hour one is not.
    await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '2 hours'`);
    res = await send().expect(429);
    expect(res.body.error.code).toBe('OTP_LIMIT');
    // Free again ~22 hours from now, when the oldest of the five is 24 hours old.
    expect(res.body.error.retryAfterSec).toBeGreaterThan(21.5 * 3600);
    expect(res.body.error.retryAfterSec).toBeLessThan(22 * 3600);

    // A full day after the oldest one, a slot opens.
    await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '22 hours'`);
    await send().expect(200);
  });

  it('two requests at the same moment cannot both slip under the limit', async () => {
    for (let i = 0; i < 4; i++) {
      await t.db.query(
        `INSERT INTO otp_requests (phone, code_hash, expires_at, created_at) VALUES ($1, 'x', now(), now() - make_interval(mins => $2))`,
        [E164, 10 + i],
      );
    }
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
  });

  it('allows at most 5 codes per IP in a day, counting the real IP behind the proxy', async () => {
    const fromIp = (phone: string, ip: string) => t.http().post('/v1/auth/otp/send').set('X-Forwarded-For', ip).send({ phone });
    for (let i = 0; i < 5; i++) await fromIp(`98765432${String(i).padStart(2, '0')}`, '203.0.113.7').expect(200);
    const blocked = await fromIp('9123456789', '203.0.113.7').expect(429);
    expect(blocked.body.error).toMatchObject({ code: 'OTP_LIMIT', retryAfterSec: expect.any(Number) });
    // Another user behind the same load balancer has their own IP and is not blocked.
    await fromIp('9123456789', '198.51.100.20').expect(200);
    const { rows } = await t.db.query(`SELECT DISTINCT host(ip) AS ip FROM otp_requests ORDER BY 1`);
    expect(rows.map((r) => r.ip)).toEqual(['198.51.100.20', '203.0.113.7']);
  });

  it('rejects an expired code', async () => {
    await send().expect(200);
    await t.db.query(`UPDATE otp_requests SET expires_at = now() - interval '1 second' WHERE phone = $1`, [E164]);
    const res = await verify(t.sms.lastCode(E164)!).expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('a code works only once', async () => {
    await send().expect(200);
    const code = t.sms.lastCode(E164)!;
    await verify(code).expect(200);
    expect((await verify(code).expect(400)).body.error.code).toBe('OTP_EXPIRED');
  });

  it('Play Store reviewer number uses the fixed code and sends no SMS', async () => {
    await send('9000000001').expect(200);
    expect(t.sms.sent).toHaveLength(0);
    await verify('123456', '9000000001').expect(200);
  });

  it('blocked users cannot log in', async () => {
    await t.login(PHONE);
    await t.db.query('UPDATE users SET is_blocked = true WHERE phone = $1', [E164]);
    await ageLastOtp(60);
    expect((await t.login(PHONE, 'customer', 403)).body.error.code).toBe('USER_BLOCKED');
  });

  it('records which app the session belongs to', async () => {
    await t.login(PHONE, 'partner');
    const { rows } = await t.db.query('SELECT app FROM sessions');
    expect(rows).toEqual([{ app: 'partner' }]);
  });
});

describe('auth (tokens)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(() => t.reset());

  const me = (token?: string) => {
    const req = t.http().get('/v1/me');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const refresh = (refreshToken: string) => t.http().post('/v1/auth/refresh').send({ refreshToken });

  it('requires a valid access token', async () => {
    expect((await me().expect(401)).body.error.code).toBe('UNAUTHORIZED');
    await me('not-a-jwt').expect(401);
  });

  it('refresh rotates the token; reusing the old one closes every session', async () => {
    const login = (await t.login(PHONE)).body;

    const next = (await refresh(login.refreshToken).expect(200)).body;
    expect(next.refreshToken).not.toBe(login.refreshToken);
    await me(next.accessToken).expect(200);

    const reused = await refresh(login.refreshToken).expect(401);
    expect(reused.body.error.code).toBe('REFRESH_REUSED');
    // The thief's copy and the real one are both closed now.
    await me(next.accessToken).expect(401);
    expect((await refresh(next.refreshToken).expect(401)).body.error.code).toBe('REFRESH_REUSED');
  });

  it('rejects an unknown or expired refresh token', async () => {
    expect((await refresh('nope').expect(401)).body.error.code).toBe('REFRESH_INVALID');
    const login = (await t.login(PHONE)).body;
    await t.db.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect((await refresh(login.refreshToken).expect(401)).body.error.code).toBe('REFRESH_INVALID');
  });

  it('logout closes the session at once', async () => {
    const { accessToken } = (await t.login(PHONE)).body;
    await me(accessToken).expect(200);
    await t.http().post('/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).expect(204);
    await me(accessToken).expect(401);
  });

  it('logout-all closes every device', async () => {
    const a = (await t.login(PHONE)).body;
    await t.db.query(`UPDATE otp_requests SET created_at = created_at - interval '1 minute'`);
    const b = (await t.login(PHONE, 'partner')).body;
    await t.http().post('/v1/auth/logout-all').set('Authorization', `Bearer ${a.accessToken}`).expect(204);
    await me(a.accessToken).expect(401);
    await me(b.accessToken).expect(401);
  });
});
