import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AppName } from '@eventseva/core';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';

export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
/** Customer and Partner app tokens; admin tokens use a different audience. */
export const APP_AUDIENCE = 'app';

export interface AuthContext {
  userId: string;
  sessionId: string;
  app: AppName;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** New session: a short JWT plus a long random refresh token (only its hash is stored). */
  async issue(q: Queryable, userId: string, app: AppName, deviceName?: string): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await this.db.one<{ id: string }>(
      q,
      `INSERT INTO sessions (user_id, refresh_token_hash, app, device_name, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id`,
      [userId, sha256(refreshToken), app, deviceName ?? null, REFRESH_TTL_DAYS],
    );
    const accessToken = jwt.sign({ sub: userId, sid: session!.id, app }, this.config.jwtSecret, {
      algorithm: 'HS256',
      audience: APP_AUDIENCE,
      expiresIn: ACCESS_TTL_SEC,
    });
    return { accessToken, refreshToken, accessExpiresInSec: ACCESS_TTL_SEC };
  }

  /**
   * Rotation: every refresh revokes the old token and issues a new one. If a revoked token is
   * used again, someone copied it — every session of that user is closed.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const outcome = await this.db.tx(async (client) => {
      const s = await this.db.one<{ id: string; user_id: string; app: AppName; device_name: string | null; revoked: boolean; expired: boolean }>(
        client,
        `SELECT id, user_id, app, device_name, revoked_at IS NOT NULL AS revoked, expires_at < now() AS expired
           FROM sessions WHERE refresh_token_hash = $1 FOR UPDATE`,
        [sha256(String(refreshToken ?? ''))],
      );
      if (!s || s.expired) return { error: 'invalid' as const };
      if (s.revoked) {
        await client.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [s.user_id]);
        return { error: 'reused' as const };
      }
      await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [s.id]);
      return { pair: await this.issue(client, s.user_id, s.app, s.device_name ?? undefined) };
    });
    if ('pair' in outcome && outcome.pair) return outcome.pair;
    if (outcome.error === 'reused') {
      throw new AppError('REFRESH_REUSED', 'Please log in again.', HttpStatus.UNAUTHORIZED);
    }
    throw new AppError('REFRESH_INVALID', 'Please log in again.', HttpStatus.UNAUTHORIZED);
  }

  /** Checks the JWT and that its session is still open (so logout takes effect at once). */
  async verifyAccess(token: string): Promise<AuthContext> {
    let payload: { sub: string; sid: string; app: AppName };
    try {
      payload = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'], audience: APP_AUDIENCE }) as typeof payload;
    } catch {
      throw new AppError('UNAUTHORIZED', 'Please log in again.', HttpStatus.UNAUTHORIZED);
    }
    const open = await this.db.one(
      this.db,
      `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.revoked_at IS NULL AND u.is_blocked = false AND u.deleted_at IS NULL`,
      [payload.sid],
    );
    if (!open) throw new AppError('UNAUTHORIZED', 'Please log in again.', HttpStatus.UNAUTHORIZED);
    return { userId: payload.sub, sessionId: payload.sid, app: payload.app };
  }

  async revoke(sessionId: string) {
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
  }

  async revokeAll(userId: string) {
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  }
}
