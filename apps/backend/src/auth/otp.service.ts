import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { OTP_SENDER, OtpSender } from './otp-sender';

// Rules from the Security Plan.
export const OTP_RULES = {
  ttlSec: 5 * 60,
  maxAttempts: 5,
  lockMin: 15,
} as const;

/**
 * Each new code for the same number waits longer: 30 s, 1 min, 2 min, 5 min, then 10 min. The ladder
 * counts unused codes from the last hour, so a successful login starts it again at 30 s.
 */
export const RESEND_STEPS_SEC = [30, 60, 120, 300, 600] as const;
export const resendWaitAfter = (codesSent: number) =>
  codesSent <= 0 ? 0 : RESEND_STEPS_SEC[Math.min(codesSent, RESEND_STEPS_SEC.length) - 1];

/** Past this share of the budget, codes stop for everyone (a runaway attack, not normal growth). */
const HARD_STOP_PERCENT = 150;

/**
 * All limits are rolling windows ("the last 24 hours"), never calendar days, so waiting for midnight
 * does not reset anything: 5 codes at 11:59 pm still block 12:01 am.
 */
const WINDOWS = { hour: 3600, day: 24 * 3600 } as const;

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
  private readonly logger = new Logger('OTP');

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

    const review = this.isReviewPhone(phone);
    const code = review ? this.config.reviewOtp! : String(randomInt(0, 1_000_000)).padStart(6, '0');

    const resendAfterSec = await this.db.tx(async (client) => {
      // One request per phone at a time, so two parallel taps cannot both slip under a limit.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phone]);
      const stats = await this.db.one<{ last_at: Date | null; locked: boolean; recent: number }>(
        client,
        `SELECT max(created_at) AS last_at,
                bool_or(attempts >= $2 AND created_at > now() - make_interval(mins => $3)) AS locked,
                -- Unused codes in the last hour since the last successful login: the resend ladder step.
                count(*) FILTER (WHERE created_at > now() - interval '1 hour' AND used_at IS NULL
                                   AND created_at > COALESCE((SELECT max(used_at) FROM otp_requests WHERE phone = $1), '-infinity'))::int AS recent
           FROM otp_requests WHERE phone = $1`,
        [phone, OTP_RULES.maxAttempts, OTP_RULES.lockMin],
      );
      if (stats?.locked) {
        throw new AppError('OTP_LOCKED', 'Too many wrong attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
      }
      const wait = resendWaitAfter(stats?.recent ?? 0);
      if (stats?.last_at && wait > 0) {
        const waited = (Date.now() - new Date(stats.last_at).getTime()) / 1000;
        if (waited < wait) {
          throw new AppError('OTP_TOO_SOON', 'Please wait before requesting a new code.', HttpStatus.TOO_MANY_REQUESTS, {
            retryAfterSec: Math.ceil(wait - waited),
          });
        }
      }
      const max = this.config.otpLimits;
      await this.limit(client, 'phone', phone, WINDOWS.hour, max.phonePerHour);
      await this.limit(client, 'phone', phone, WINDOWS.day, max.phonePerDay);
      if (ip) {
        await this.limit(client, 'ip', ip, WINDOWS.hour, max.ipPerHour);
        await this.limit(client, 'ip', ip, WINDOWS.day, max.ipPerDay);
      }
      if (!review) await this.checkBudget(client, phone);
      await client.query(
        `INSERT INTO otp_requests (phone, code_hash, ip, expires_at, sms_sent)
         VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)`,
        [phone, this.hash(phone, code), ip ?? null, OTP_RULES.ttlSec, !review],
      );
      // The wait before the *next* code, so the app's countdown is right.
      return resendWaitAfter((stats?.recent ?? 0) + 1);
    });
    if (!review) await this.sender.send(phone, code, language);

    return { phone, expiresInSec: OTP_RULES.ttlSec, resendAfterSec };
  }

  /**
   * Daily SMS budget (whole app, any 24 hours). Over 100% only registered users still get codes,
   * because SMS-pumping fraud texts new, random numbers; over 150% codes stop for everyone. The team
   * is alerted on the admin dashboard on the way up.
   */
  private async checkBudget(q: Queryable, phone: string) {
    const { perDay, alertPercent } = this.config.smsBudget;
    const used = (await this.db.one<{ n: number }>(
      q,
      `SELECT count(*)::int AS n FROM otp_requests WHERE sms_sent AND created_at > now() - interval '24 hours'`,
    ))!.n;
    const percent = (used * 100) / perDay;
    if (percent >= HARD_STOP_PERCENT) {
      await this.alert('sms_budget_hard_stop', `OTP SMS stopped for everyone: ${used} sent in 24 hours (budget ${perDay}).`, { used, perDay });
      throw new AppError('OTP_SERVICE_BUSY', 'Login codes are paused for a short while. Please try again later.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (percent >= 100) {
      const known = await this.db.one(q, 'SELECT 1 FROM users WHERE phone = $1 AND deleted_at IS NULL AND NOT is_blocked', [phone]);
      await this.alert('sms_budget_reached', `Daily SMS budget used up (${used}/${perDay}). New sign-ups are paused; existing users can still log in.`, {
        used,
        perDay,
      });
      if (!known) {
        throw new AppError('OTP_SERVICE_BUSY', 'New sign-ups are paused for a short while. Please try again later.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      return;
    }
    if (percent + 100 / perDay >= alertPercent) {
      await this.alert('sms_budget_warning', `${alertPercent}% of the daily SMS budget used (${used + 1}/${perDay}).`, { used: used + 1, perDay });
    }
  }

  /**
   * One alert of each kind per 24 hours, so a busy day does not flood the dashboard. Written on its own
   * connection, outside the request's transaction: the request may fail right after, and the alert
   * must survive that rollback.
   */
  private async alert(kind: string, message: string, data: object) {
    const res = await this.db.query(
      `INSERT INTO system_alerts (kind, message, data)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM system_alerts WHERE kind = $1 AND created_at > now() - interval '24 hours')`,
      [kind, message, data],
    );
    if (res.rowCount) this.logger.warn(`${kind}: ${message}`);
  }

  /**
   * Refuses when `max` codes were already sent for this phone or IP in the last `windowSec` seconds,
   * and says when the next one is allowed: when the oldest of those codes leaves the window.
   */
  private async limit(q: Queryable, by: 'phone' | 'ip', value: string, windowSec: number, max: number) {
    const r = await this.db.one<{ n: number; retry_at: Date | null }>(
      q,
      `SELECT count(*)::int AS n,
              (SELECT created_at FROM otp_requests WHERE ${by} = $1 AND created_at > now() - make_interval(secs => $2)
                ORDER BY created_at DESC OFFSET $3 - 1 LIMIT 1) + make_interval(secs => $2) AS retry_at
         FROM otp_requests WHERE ${by} = $1 AND created_at > now() - make_interval(secs => $2)`,
      [value, windowSec, max],
    );
    if (r!.n < max) return;
    const retryAfterSec = Math.max(1, Math.ceil((new Date(r!.retry_at!).getTime() - Date.now()) / 1000));
    throw new AppError('OTP_LIMIT', 'Too many codes requested. Please try again later.', HttpStatus.TOO_MANY_REQUESTS, {
      retryAfterSec,
      retryAt: r!.retry_at,
    });
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
