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
  http: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
  /** Full send → verify; fails the test unless verify returns `status`. */
  login: (phone: string, app?: 'customer' | 'partner', status?: number) => Promise<request.Response>;
  /** Creates an admin and returns a logged-in token. */
  adminLogin: (role?: string, email?: string) => Promise<string>;
}

export async function createTestApp(): Promise<TestApp> {
  const sms = new FakeOtpSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_SENDER)
    .useValue(sms)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false, rawBody: true }));
  await app.init();
  const db = app.get(Db);
  const http = () => request(app.getHttpServer());

  return {
    app,
    db,
    sms,
    http,
    reset: async () => {
      sms.sent.length = 0;
      await db.query('TRUNCATE otp_requests, sessions, users, admin_users CASCADE');
    },
    login: async (phone, appName = 'customer', status = 200) => {
      await http().post('/v1/auth/otp/send').send({ phone }).expect(200);
      return http()
        .post('/v1/auth/otp/verify')
        .send({ phone, code: sms.lastCode(`+91${phone.slice(-10)}`), app: appName })
        .expect(status);
    },
    adminLogin: async (role = 'verifier', email = `${role}@eventseva.test`) => {
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
      return res.body.accessToken;
    },
  };
}
