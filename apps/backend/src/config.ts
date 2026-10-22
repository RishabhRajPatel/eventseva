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
  isProduction: boolean;
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
    isProduction,
  };
}
