import { Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { APPS, type AppName } from '@eventseva/core';
import { AppError } from '../common/errors';
import { Db } from '../db/db.service';
import { Auth, AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { AuthContext, TokenService } from './token.service';

class SendOtpDto {
  @IsString() @MaxLength(20) phone: string;
}

class VerifyOtpDto {
  @IsString() @MaxLength(20) phone: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'code must be 6 digits' }) code: string;
  @IsIn(APPS) app: AppName;
  @IsOptional() @IsString() @Length(1, 80) deviceName?: string;
}

class RefreshDto {
  @IsString() @MaxLength(200) refreshToken: string;
}

// Stricter rate limit on login routes; the exact number comes from AUTH_RATE_LIMIT_PER_MIN.
@Throttle({ default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MIN || 10), ttl: 60_000 } })
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly db: Db,
  ) {}

  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  async send(@Body() body: SendOtpDto, @Ip() ip: string) {
    const { expiresInSec, resendAfterSec } = await this.otp.send(body.phone, ip);
    return { sent: true, expiresInSec, resendAfterSec };
  }

  /** Login and sign-up are the same step: a new phone number creates the user. */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() body: VerifyOtpDto) {
    const phone = await this.otp.verify(body.phone, body.code);
    return this.db.tx(async (client) => {
      const inserted = await this.db.one<{ id: string }>(
        client,
        'INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO NOTHING RETURNING id',
        [phone],
      );
      const user = await this.db.one<{ id: string; name: string | null; language: string; is_blocked: boolean }>(
        client,
        'SELECT id, name, language, is_blocked FROM users WHERE phone = $1',
        [phone],
      );
      if (!user || user.is_blocked) {
        throw new AppError('USER_BLOCKED', 'This account is blocked. Contact EventSeva support.', HttpStatus.FORBIDDEN);
      }
      const vendor = await this.db.one<{ id: string; status: string }>(
        client,
        'SELECT id, status FROM vendors WHERE user_id = $1',
        [user.id],
      );
      const pair = await this.tokens.issue(client, user.id, body.app, body.deviceName);
      return {
        ...pair,
        isNewUser: !!inserted,
        user: { id: user.id, phone, name: user.name, language: user.language },
        // Partner app uses this to decide: onboarding, "awaiting approval" or dashboard.
        vendor: vendor ? { id: vendor.id, status: vendor.status } : null,
      };
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto) {
    return this.tokens.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logout(@Auth() auth: AuthContext) {
    await this.tokens.revoke(auth.sessionId);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logoutAll(@Auth() auth: AuthContext) {
    await this.tokens.revokeAll(auth.userId);
  }
}
