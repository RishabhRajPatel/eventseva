import { Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export interface PushMessage {
  title: string;
  body: string;
  /** FCM data values must be strings. The apps read kind, bookingId and conversationId to open a screen. */
  data: Record<string, string>;
  /** Android notification channel created by the apps. */
  channel: 'bookings' | 'chat';
}

/** 'invalid_token': the app was uninstalled or the token rotated; the caller deletes it. */
export type PushResult = 'ok' | 'invalid_token' | 'error';

export interface PushSender {
  send(token: string, message: PushMessage): Promise<PushResult>;
}

/** Development: prints pushes to the log instead of sending them. */
@Injectable()
export class ConsolePushSender implements PushSender {
  private readonly logger = new Logger('Push');

  async send(token: string, m: PushMessage): Promise<PushResult> {
    this.logger.log(`push → …${token.slice(-6)}: ${m.title} — ${m.body}`);
    return 'ok';
  }
}

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** FIREBASE_SERVICE_ACCOUNT holds the downloaded JSON key, base64-encoded (it has newlines and quotes). */
export function parseServiceAccount(value?: string): ServiceAccount | undefined {
  if (!value) return undefined;
  let json: Partial<ServiceAccount>;
  try {
    json = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must be the service-account JSON file, base64-encoded');
  }
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key');
  }
  return json as ServiceAccount;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Firebase Cloud Messaging HTTP v1 API, authenticated with a service account (no SDK needed). */
export class FcmPushSender implements PushSender {
  private readonly logger = new Logger('FCM');
  private access?: { token: string; expiresAt: number };

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** OAuth access token, reused until a minute before it expires (they last an hour). */
  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      { iss: this.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
      this.account.private_key,
      { algorithm: 'RS256' },
    );
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Google token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.access = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.access.token;
  }

  async send(token: string, m: PushMessage): Promise<PushResult> {
    try {
      const res = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: m.title, body: m.body },
            data: m.data,
            android: { priority: 'high', notification: { channel_id: m.channel, sound: 'default' } },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return 'ok';
      const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
      const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
      if (res.status === 404 || code === 'UNREGISTERED' || code === 'NOT_FOUND') return 'invalid_token';
      this.logger.warn(`send failed: ${res.status} ${code ?? ''}`);
      return 'error';
    } catch (e) {
      this.logger.warn(`send failed: ${(e as Error).message}`);
      return 'error';
    }
  }
}
