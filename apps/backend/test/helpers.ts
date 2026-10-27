import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { useTestEnv } from './env';

useTestEnv();

// Imported after the env is set, because config is read when the module is created.
import { AppModule, configureApp } from '../src/app.module';
import { OTP_SENDER, OtpSender } from '../src/auth/otp-sender';
import { Db } from '../src/db/db.service';
import { hashPassword } from '../src/admin/password';
import { newTotpSecret, totpAt } from '../src/admin/totp';
import { CloudinaryService } from '../src/media/cloudinary.service';
import { loadConfig } from '../src/config';
import { PUSH_SENDER, type PushMessage, type PushResult, type PushSender } from '../src/push/push-sender';

/** Records pushes; tokens listed in `invalid` behave like uninstalled apps. */
export class FakePushSender implements PushSender {
  readonly sent: { token: string; message: PushMessage }[] = [];
  readonly invalid = new Set<string>();
  async send(token: string, message: PushMessage): Promise<PushResult> {
    if (this.invalid.has(token)) return 'invalid_token';
    this.sent.push({ token, message });
    return 'ok';
  }
}

/** Records deletes instead of calling Cloudinary. */
export class FakeCloudinary extends CloudinaryService {
  readonly destroyed: string[] = [];
  async destroy(publicId: string) {
    this.destroyed.push(publicId);
  }
}

/** Captures codes instead of sending SMS, so tests can log in. */
export class FakeOtpSender implements OtpSender {
  readonly sent: { phone: string; code: string }[] = [];
  async send(phone: string, code: string) {
    this.sent.push({ phone, code });
  }
  lastCode(phone: string) {
    return [...this.sent].reverse().find((s) => s.phone === phone)?.code;
  }
}

export interface TestApp {
  app: INestApplication;
  db: Db;
  sms: FakeOtpSender;
  cloudinary: FakeCloudinary;
  push: FakePushSender;
  http: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
  /** Full send → verify; fails the test unless verify returns `status`. */
  login: (phone: string, app?: 'customer' | 'partner', status?: number) => Promise<request.Response>;
  /**
   * Creates an admin and returns a logged-in token. The admin counts as having just re-entered a 2FA
   * code (sensitive actions work) unless `stepUp` is false; url-security / admin-2fa specs test that part.
   */
  adminLogin: (role?: string, email?: string, stepUp?: boolean) => Promise<string>;
}

export async function createTestApp(): Promise<TestApp> {
  const sms = new FakeOtpSender();
  const cloudinary = new FakeCloudinary(loadConfig());
  const push = new FakePushSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue(sms)
    .overrideProvider(CloudinaryService)
    .useValue(cloudinary)
    .overrideProvider(PUSH_SENDER)
    .useValue(push)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false, rawBody: true }));
  await app.init();
  const db = app.get(Db);
  const http = () => request(app.getHttpServer());

  return {
    app,
    db,
    sms,
    cloudinary,
    push,
    http,
    reset: async () => {
      sms.sent.length = 0;
      await db.query('TRUNCATE otp_requests, sessions, users, admin_users CASCADE');
    },
    login: async (phone, appName = 'customer', status = 200) => {
      // Each login from its own IP, so tests with many users do not hit the per-IP limit.
      const sent = await http().post('/v1/auth/otp/send').set('X-Forwarded-For', `10.${phone.slice(-6, -4)}.${phone.slice(-4, -2)}.${phone.slice(-2)}`).send({ phone });
      if (sent.status !== 200) throw new Error(`otp/send ${sent.status}: ${JSON.stringify(sent.body)}`);
      return http()
        .post('/v1/auth/otp/verify')
        .send({ phone, code: sms.lastCode(`+91${phone.slice(-10)}`), app: appName })
        .expect(status);
    },
    adminLogin: async (role = 'verifier', email = `${role}@eventseva.test`, stepUp = true) => {
      const secret = newTotpSecret();
      await db.query('INSERT INTO admin_users (email, password_hash, totp_secret, role) VALUES ($1, $2, $3, $4)', [
        email,
        await hashPassword('correct horse battery'),
        secret,
        role,
      ]);
      const res = await http()
        .post('/v1/admin/login')
        .send({ email, password: 'correct horse battery', totp: totpAt(secret) })
        .expect(200);
      if (stepUp) {
        const { ims } = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString());
        await db.query(`UPDATE admin_users SET step_up_until = now() + interval '1 day', step_up_session = $2 WHERE email = $1`, [email, ims]);
      }
      return res.body.accessToken;
    },
  };
}
