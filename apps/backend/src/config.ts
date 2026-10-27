import { createHash } from 'node:crypto';
import { parseServiceAccount, type ServiceAccount } from './push/push-sender';

export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  otpPepper: string;
  otpProvider: string;
  reviewPhone?: string;
  reviewOtp?: string;
  rateLimitPerMin: number;
  authRateLimitPerMin: number;
  /** Share of the booking price the customer pays to confirm (the rest is paid after the event). */
  advancePercent: number;
  /** EventSeva's cut, taken out of the advance before the vendor payout. */
  commissionPercent: number;
  paymentProvider: 'fake' | 'razorpay';
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  /** How often expired requests and finished events are processed; 0 turns it off (tests). */
  bookingSweepSec: number;
  /** Postgres connections per API server (DB_POOL_MAX). */
  dbPoolMax: number;
  /** From CLOUDINARY_URL (cloudinary://key:secret@cloud); unset = uploads switched off. */
  cloudinary?: { cloudName: string; apiKey: string; apiSecret: string };
  /** 32-byte key for bank account numbers (BANK_DETAILS_KEY, base64). */
  bankDetailsKey: Buffer;
  /** FIREBASE_SERVICE_ACCOUNT; unset = pushes are only logged (development). */
  firebase?: ServiceAccount;
  /** Send pushes in the background (off in tests, which call the dispatcher directly). */
  pushDispatch: boolean;
  /** OTP send limits (rolling windows). Phone limits are the real protection; IP limits catch bots. */
  otpLimits: { phonePerHour: number; phonePerDay: number; ipPerHour: number; ipPerDay: number };
  /**
   * SMS budget for the whole app over any 24 hours. At `alertPercent` the admin dashboard warns; at 100%
   * only already-registered users still get codes; at 150% nobody does. Protects against SMS-pumping fraud.
   */
  smsBudget: { perDay: number; alertPercent: number };
  /**
   * How many proxies sit in front of the API (load balancer, Nginx …). Without it every request looks
   * like it comes from the proxy, and IP limits would count all users as one.
   */
  trustProxy: number;
  isProduction: boolean;
}

/** cloudinary://<api_key>:<api_secret>@<cloud_name> — the format Cloudinary's dashboard shows. */
function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Number settings in .env (OTP limits, SMS budget, DB_POOL_MAX) must be whole numbers of 1 or more (got "${value}")`);
  return n;
}

export function parseCloudinaryUrl(value?: string): AppConfig['cloudinary'] {
  if (!value) return undefined;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@([\w-]+)$/.exec(value.trim());
  if (!m) throw new Error('CLOUDINARY_URL must look like cloudinary://<api_key>:<api_secret>@<cloud_name>');
  return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
}

const DEV_SECRET = 'change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const jwtSecret = env.JWT_SECRET || DEV_SECRET;
  const otpPepper = env.OTP_PEPPER || DEV_SECRET;
  if (isProduction && (jwtSecret === DEV_SECRET || otpPepper === DEV_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET and OTP_PEPPER must be long random values in production');
  }
  const otpProvider = env.OTP_PROVIDER || 'console';
  if (isProduction && otpProvider === 'console') {
    throw new Error('OTP_PROVIDER=console is for development only');
  }

  const advancePercent = Number(env.ADVANCE_PERCENT || 25);
  const commissionPercent = Number(env.COMMISSION_PERCENT || 10);
  // The commission comes out of the advance, so the advance must be at least as big.
  if (!(advancePercent > 0 && advancePercent <= 100 && commissionPercent >= 0 && commissionPercent <= advancePercent)) {
    throw new Error('ADVANCE_PERCENT must be 1–100 and COMMISSION_PERCENT must be 0–ADVANCE_PERCENT');
  }
  const paymentProvider = env.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay' : 'fake';
  if (isProduction && paymentProvider === 'fake') {
    throw new Error('PAYMENT_PROVIDER=fake is for development only');
  }
  if (paymentProvider === 'razorpay' && !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)) {
    throw new Error('RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required');
  }

  let bankDetailsKey = env.BANK_DETAILS_KEY ? Buffer.from(env.BANK_DETAILS_KEY, 'base64') : undefined;
  if (bankDetailsKey && bankDetailsKey.length !== 32) throw new Error('BANK_DETAILS_KEY must be 32 bytes, base64 (openssl rand -base64 32)');
  if (!bankDetailsKey) {
    if (isProduction) throw new Error('BANK_DETAILS_KEY is required in production');
    bankDetailsKey = createHash('sha256').update('eventseva-dev-bank-key').digest();
  }

  return {
    port: Number(env.PORT || 3000),
    databaseUrl,
    jwtSecret,
    otpPepper,
    otpProvider,
    reviewPhone: env.REVIEW_PHONE || undefined,
    reviewOtp: env.REVIEW_OTP || undefined,
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN || 100),
    authRateLimitPerMin: Number(env.AUTH_RATE_LIMIT_PER_MIN || 10),
    advancePercent,
    commissionPercent,
    paymentProvider,
    razorpayKeyId: env.RAZORPAY_KEY_ID || undefined,
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || undefined,
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || undefined,
    bookingSweepSec: Number(env.BOOKING_SWEEP_SEC ?? 60),
    dbPoolMax: positiveInt(env.DB_POOL_MAX, 10),
    cloudinary: parseCloudinaryUrl(env.CLOUDINARY_URL),
    bankDetailsKey,
    firebase: parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT),
    pushDispatch: env.PUSH_DISPATCH !== 'off',
    otpLimits: {
      phonePerHour: positiveInt(env.OTP_MAX_PER_PHONE_PER_HOUR, 5),
      phonePerDay: positiveInt(env.OTP_MAX_PER_PHONE_PER_DAY, 5),
      ipPerHour: positiveInt(env.OTP_MAX_PER_IP_PER_HOUR, 5),
      ipPerDay: positiveInt(env.OTP_MAX_PER_IP_PER_DAY, 5),
    },
    smsBudget: {
      perDay: positiveInt(env.OTP_DAILY_SMS_BUDGET, 2000),
      alertPercent: Math.min(99, positiveInt(env.OTP_BUDGET_ALERT_PERCENT, 80)),
    },
    trustProxy: Number(env.TRUST_PROXY || 0),
    isProduction,
  };
}
