import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { OTP_SENDER, OtpSender } from './otp-sender';

// Rules from the Security Plan.
export const OTP_RULES = {
  ttlSec: 5 * 60,
  resendAfterSec: 30,
  maxAttempts: 5,
  lockMin: 15,
  maxPerPhonePerHour: 5,
  maxPerIpPerHour: 10,
} as const;

/** Accepts "9876543210", "+91 98765 43210" or "919876543210"; returns "+919876543210". Only Indian mobiles. */
export function normalizePhone(input: string): string {
  const digits = String(input ?? '').replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    throw new AppError('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number.');
  }
  return `+91${digits}`;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.otpPepper).update(`${phone}:${code}`).digest('hex');
  }

  private isReviewPhone(phone: string): boolean {
    return !!this.config.reviewPhone && !!this.config.reviewOtp && phone === normalizePhone(this.config.reviewPhone);
  }

  async send(rawPhone: string, ip: string | undefined, language: 'en' | 'hi' = 'en') {
    const phone = normalizePhone(rawPhone);

    const stats = await this.db.one<{ last_at: Date | null; last_hour: number; locked: boolean }>(
      this.db,
      `SELECT max(created_at) AS last_at,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS last_hour,
              bool_or(attempts >= $2 AND created_at > now() - make_interval(mins => $3)) AS locked
         FROM otp_requests WHERE phone = $1`,
      [phone, OTP_RULES.maxAttempts, OTP_RULES.lockMin],
    );
    if (stats?.locked) {
      throw new AppError('OTP_LOCKED', 'Too many wrong attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (stats?.last_at) {
      const waited = (Date.now() - new Date(stats.last_at).getTime()) / 1000;
      if (waited < OTP_RULES.resendAfterSec) {
        throw new AppError('OTP_TOO_SOON', 'Please wait before requesting a new code.', HttpStatus.TOO_MANY_REQUESTS, {
          retryAfterSec: Math.ceil(OTP_RULES.resendAfterSec - waited),
        });
      }
    }
    if ((stats?.last_hour ?? 0) >= OTP_RULES.maxPerPhonePerHour) {
      throw new AppError('OTP_LIMIT', 'Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (ip) {
      const perIp = await this.db.one<{ n: number }>(
        this.db,
        `SELECT count(*)::int AS n FROM otp_requests WHERE ip = $1 AND created_at > now() - interval '1 hour'`,
        [ip],
      );
      if ((perIp?.n ?? 0) >= OTP_RULES.maxPerIpPerHour) {
        throw new AppError('OTP_LIMIT', 'Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const review = this.isReviewPhone(phone);
    const code = review ? this.config.reviewOtp! : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.query(
      `INSERT INTO otp_requests (phone, code_hash, ip, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [phone, this.hash(phone, code), ip ?? null, OTP_RULES.ttlSec],
    );
    if (!review) await this.sender.send(phone, code, language);

    return { phone, expiresInSec: OTP_RULES.ttlSec, resendAfterSec: OTP_RULES.resendAfterSec };
  }

  /** Checks the latest code for this phone. Returns the normalized phone if it matches. */
  async verify(rawPhone: string, code: string): Promise<string> {
    const phone = normalizePhone(rawPhone);
    const result = await this.db.tx(async (client) => {
      // FOR UPDATE: two parallel guesses can't both use the same attempt.
      const otp = await this.db.one<{ id: string; code_hash: string; attempts: number; expired: boolean; used: boolean }>(
        client,
        `SELECT id, code_hash, attempts, expires_at < now() AS expired, used_at IS NOT NULL AS used
           FROM otp_requests WHERE phone = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [phone],
      );
      if (!otp || otp.used || otp.expired) return { error: 'expired' as const };
      if (otp.attempts >= OTP_RULES.maxAttempts) return { error: 'locked' as const };

      const expected = Buffer.from(otp.code_hash, 'hex');
      const given = Buffer.from(this.hash(phone, String(code ?? '')), 'hex');
      if (!timingSafeEqual(expected, given)) {
        const attempts = otp.attempts + 1;
        await client.query('UPDATE otp_requests SET attempts = $2 WHERE id = $1', [otp.id, attempts]);
        return attempts >= OTP_RULES.maxAttempts
          ? { error: 'locked' as const }
          : { error: 'invalid' as const, attemptsLeft: OTP_RULES.maxAttempts - attempts };
      }
      await client.query('UPDATE otp_requests SET used_at = now() WHERE id = $1', [otp.id]);
      return { ok: true as const };
    });

    if ('ok' in result) return phone;
    if (result.error === 'expired') throw new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
    if (result.error === 'locked') {
      throw new AppError('OTP_LOCKED', 'Too many wrong attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new AppError('OTP_INVALID', 'Wrong code. Please check and try again.', HttpStatus.BAD_REQUEST, {
      attemptsLeft: result.attemptsLeft,
    });
  }
}
