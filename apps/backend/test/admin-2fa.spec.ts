import { hashPassword } from '../src/admin/password';
import { newTotpSecret, totpAt } from '../src/admin/totp';
import { createTestApp, TestApp } from './helpers';

describe('admin two-factor authentication', () => {
  let t: TestApp;
  const email = 'support@eventseva.test';
  const password = 'correct horse battery';
  let secret: string;
  let userId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());

  beforeEach(async () => {
    await t.reset();
    secret = newTotpSecret();
    await t.db.query('INSERT INTO admin_users (email, password_hash, totp_secret, role) VALUES ($1, $2, $3, $4)', [
      email,
      await hashPassword(password),
      secret,
      'support',
    ]);
    await t.login('9822222222');
    userId = (await t.db.one<{ id: string }>(t.db, `SELECT id FROM users WHERE phone = '+919822222222'`))!.id;
  });

  const login = (body: object) => t.http().post('/v1/admin/login').send({ email, password, ...body });
  /** Pretend 60 s have passed, so the authenticator shows a newer code than the last one used. */
  const nextCode = async () => {
    await t.db.query('UPDATE admin_users SET totp_last_step = totp_last_step - 2 WHERE email = $1', [email]);
    return totpAt(secret);
  };
  const block = (token: string, code?: string) => {
    const r = t.http().post(`/v1/admin/users/${userId}/block`).set('Authorization', `Bearer ${token}`);
    return (code ? r.set('X-Admin-2FA', code) : r).send({ reason: 'Fraud reports' });
  };
  const unblock = (token: string, code?: string) => {
    const r = t.http().post(`/v1/admin/users/${userId}/unblock`).set('Authorization', `Bearer ${token}`);
    return (code ? r.set('X-Admin-2FA', code) : r).send({});
  };

  it('the 2FA secret is stored encrypted after the first login, and logins keep working', async () => {
    const code = totpAt(secret);
    await login({ totp: code }).expect(200);
    const stored = (await t.db.one<{ totp_secret: string }>(t.db, 'SELECT totp_secret FROM admin_users WHERE email = $1', [email]))!.totp_secret;
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(secret);
    await login({ totp: code }).expect(401); // the same code never works twice
    await login({ totp: await nextCode() }).expect(200);
  });

  it('money and blocking need a fresh 2FA code; then 5 minutes without asking again', async () => {
    const loginCode = totpAt(secret);
    const token = (await login({ totp: loginCode }).expect(200)).body.accessToken;

    expect((await block(token).expect(403)).body.error).toMatchObject({ code: 'ADMIN_2FA_REQUIRED', windowMinutes: 5 });
    expect((await block(token, '000000').expect(403)).body.error.code).toBe('ADMIN_2FA_INVALID');
    // The code used to log in cannot be reused for an action either.
    expect((await block(token, loginCode).expect(403)).body.error.code).toBe('ADMIN_2FA_INVALID');
    expect((await t.db.one(t.db, 'SELECT is_blocked FROM users WHERE id = $1', [userId]))!.is_blocked).toBe(false);

    await block(token, await nextCode()).expect(200);
    await unblock(token).expect(200); // inside the window: no new code
    const me = (await t.http().get('/v1/admin/me').set('Authorization', `Bearer ${token}`).expect(200)).body;
    expect(new Date(me.stepUpUntil).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    await t.db.query(`UPDATE admin_users SET step_up_until = now() - interval '1 second' WHERE email = $1`, [email]);
    expect((await block(token).expect(403)).body.error.code).toBe('ADMIN_2FA_REQUIRED');
    // Reading the dashboard never needs one.
    await t.http().get('/v1/admin/dashboard').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('wrong codes for actions lock the account like wrong logins', async () => {
    const token = (await login({ totp: totpAt(secret) }).expect(200)).body.accessToken;
    for (let i = 0; i < 5; i++) await block(token, '123456').expect(403);
    expect((await block(token, await nextCode()).expect(429)).body.error.code).toBe('ADMIN_LOCKED');
  });

  it('recovery codes: made with a fresh code, shown once, stored hashed, each works once', async () => {
    const token = (await login({ totp: totpAt(secret) }).expect(200)).body.accessToken;
    const post = () => t.http().post('/v1/admin/me/recovery-codes').set('Authorization', `Bearer ${token}`);
    expect((await post().expect(403)).body.error.code).toBe('ADMIN_2FA_REQUIRED');
    const { codes } = (await post().set('X-Admin-2FA', await nextCode()).expect(200)).body;
    expect(codes).toHaveLength(8);
    expect(codes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const stored = (await t.db.one<{ recovery_codes: string[] }>(t.db, 'SELECT recovery_codes FROM admin_users WHERE email = $1', [email]))!;
    expect(stored.recovery_codes.join()).not.toContain(codes[0]);

    // Lost phone: log in with a recovery code instead of the 6-digit code (any case, dash optional).
    const res = (await login({ recoveryCode: codes[0].toLowerCase().replace('-', '') }).expect(200)).body;
    expect(res).toMatchObject({ recoveryCodesLeft: 7, usedRecoveryCode: true });
    await login({ recoveryCode: codes[0] }).expect(401);
    await login({ recoveryCode: 'AAAAA-BBBBB' }).expect(401);
    // A wrong password with a valid recovery code still fails and does not use the code up.
    await t.http().post('/v1/admin/login').send({ email, password: 'wrong password!!', recoveryCode: codes[1] }).expect(401);
    await login({ recoveryCode: codes[1] }).expect(200);
    const audit = await t.db.query(`SELECT action FROM admin_audit_log ORDER BY created_at`);
    expect(audit.rows.map((r) => r.action)).toEqual(['admin.recovery_codes_reset', 'admin.recovery_code_used', 'admin.recovery_code_used']);
    // A recovery code is for logging in only, never for confirming an action.
    expect((await block(res.accessToken, codes[2]).expect(403)).body.error.code).toBe('ADMIN_2FA_REQUIRED');
  });

  it('a login needs either the 6-digit code or a recovery code', async () => {
    await login({}).expect(400);
    await login({ totp: '12345' }).expect(400);
  });
});
