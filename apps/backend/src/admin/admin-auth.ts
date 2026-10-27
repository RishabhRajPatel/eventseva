import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { openSecret, STEP_UP_HEADER, STEP_UP_KEY, STEP_UP_MIN } from './admin-2fa';
import { totpStep } from './totp';

/** Wrong 2FA codes (at login or for a sensitive action) before the account locks for 15 minutes. */
export const ADMIN_MAX_FAILED_LOGINS = 5;
export const ADMIN_LOCK_MIN = 15;

export const ADMIN_ROLES = ['super', 'support', 'verifier', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** One working shift; admins log in again after that. */
export const ADMIN_TTL_SEC = 8 * 60 * 60;
/** Admin tokens carry this audience so an app token can never open the admin panel, or the reverse. */
export const ADMIN_AUDIENCE = 'admin';

export interface AdminContext {
  adminId: string;
  role: AdminRole;
  /** Which login this is (token issue time, ms): a 2FA re-check counts for this login only. */
  session: number;
}

type AdminRequest = Request & { admin?: AdminContext };

const ROLES_KEY = 'adminRoles';
/** Limits a route to these roles. `super` can always pass. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

export const signAdminToken = (config: AppConfig, adminId: string) =>
  // ims: issue time in milliseconds, so a logout also ends tokens issued earlier in the same second.
  jwt.sign({ sub: adminId, ims: Date.now() }, config.jwtSecret, { algorithm: 'HS256', audience: ADMIN_AUDIENCE, expiresIn: ADMIN_TTL_SEC });

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly db: Db,
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    let adminId: string;
    let issuedAt: number;
    try {
      if (scheme !== 'Bearer' || !token) throw new Error('missing');
      ({ sub: adminId, ims: issuedAt } = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'], audience: ADMIN_AUDIENCE }) as {
        sub: string;
        ims: number;
      });
    } catch {
      throw new AppError('UNAUTHORIZED', 'Please log in.', HttpStatus.UNAUTHORIZED);
    }
    // Checked on every request, so deactivating an admin locks them out at once.
    // Tokens issued before the admin's last logout stop working at once.
    const admin = await this.db.one<{ role: AdminRole; totp_secret: string; stepped: boolean; locked: boolean }>(
      this.db,
      `SELECT role, totp_secret, COALESCE(step_up_until > now() AND step_up_session = $2::bigint, false) AS stepped, COALESCE(locked_until > now(), false) AS locked
         FROM admin_users
        WHERE id = $1 AND is_active AND (tokens_valid_after IS NULL OR $2::bigint > extract(epoch FROM tokens_valid_after) * 1000)`,
      [adminId, issuedAt ?? 0],
    );
    if (!admin) throw new AppError('UNAUTHORIZED', 'Please log in.', HttpStatus.UNAUTHORIZED);

    const allowed = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed && admin.role !== 'super' && !allowed.includes(admin.role)) {
      throw new AppError('FORBIDDEN', 'Your admin role cannot do this.', HttpStatus.FORBIDDEN);
    }
    if (this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [ctx.getHandler(), ctx.getClass()]) && !admin.stepped) {
      await this.stepUp(adminId, issuedAt ?? 0, admin, req.headers[STEP_UP_HEADER]);
    }
    req.admin = { adminId, role: admin.role, session: issuedAt ?? 0 };
    return true;
  }

  /**
   * A sensitive action needs a fresh, unused 2FA code (sent in the X-Admin-2FA header). It then opens
   * a short window in which other sensitive actions need no new code. Wrong codes count towards the
   * same lock as wrong logins.
   */
  private async stepUp(adminId: string, session: number, admin: { totp_secret: string; locked: boolean }, header: string | string[] | undefined) {
    if (admin.locked) throw new AppError('ADMIN_LOCKED', 'Too many wrong attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const code = typeof header === 'string' ? header.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      throw new AppError('ADMIN_2FA_REQUIRED', 'Enter a fresh code from your authenticator app to do this.', HttpStatus.FORBIDDEN, {
        windowMinutes: STEP_UP_MIN,
      });
    }
    const step = totpStep(openSecret(admin.totp_secret, this.config.bankDetailsKey), code);
    const claimed =
      step !== null &&
      (
        await this.db.query(
          `UPDATE admin_users SET totp_last_step = $2, step_up_until = now() + make_interval(mins => $3), step_up_session = $4, failed_logins = 0
            WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
          [adminId, step, STEP_UP_MIN, session],
        )
      ).rowCount;
    if (!claimed) {
      await this.db.query(
        `UPDATE admin_users SET
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
           failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
         WHERE id = $1`,
        [adminId, ADMIN_MAX_FAILED_LOGINS, ADMIN_LOCK_MIN],
      );
      throw new AppError('ADMIN_2FA_INVALID', 'That code is wrong or was already used. Wait for the next code and try again.', HttpStatus.FORBIDDEN);
    }
  }
}

export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  return ctx.switchToHttp().getRequest<AdminRequest>().admin!;
});
