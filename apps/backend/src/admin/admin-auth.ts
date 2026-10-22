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

export const ADMIN_ROLES = ['super', 'support', 'verifier', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** One working shift; admins log in again after that. */
export const ADMIN_TTL_SEC = 8 * 60 * 60;
/** Admin tokens carry this audience so an app token can never open the admin panel, or the reverse. */
export const ADMIN_AUDIENCE = 'admin';

export interface AdminContext {
  adminId: string;
  role: AdminRole;
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
    const admin = await this.db.one<{ role: AdminRole }>(
      this.db,
      `SELECT role FROM admin_users
        WHERE id = $1 AND is_active AND (tokens_valid_after IS NULL OR $2::bigint > extract(epoch FROM tokens_valid_after) * 1000)`,
      [adminId, issuedAt ?? 0],
    );
    if (!admin) throw new AppError('UNAUTHORIZED', 'Please log in.', HttpStatus.UNAUTHORIZED);

    const allowed = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed && admin.role !== 'super' && !allowed.includes(admin.role)) {
      throw new AppError('FORBIDDEN', 'Your admin role cannot do this.', HttpStatus.FORBIDDEN);
    }
    req.admin = { adminId, role: admin.role };
    return true;
  }
}

export const Admin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  return ctx.switchToHttp().getRequest<AdminRequest>().admin!;
});
