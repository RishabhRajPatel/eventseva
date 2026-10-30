import { Injectable, Logger } from '@nestjs/common';
import type { OtpSender } from './otp-sender';

/**
 * MSG91 credentials. In India every transactional SMS goes out against a DLT-registered template,
 * and a template is approved per language — so Hindi needs its own id. Without `templateIdHi`,
 * Hindi users get the English template rather than no message at all.
 */
export interface Msg91Config {
  authKey: string;
  templateId: string;
  templateIdHi?: string;
  /** Seconds to wait for MSG91 before giving up; the caller turns this into "try again". */
  timeoutMs: number;
}

const ENDPOINT = 'https://control.msg91.com/api/v5/flow';

export function parseMsg91(env: NodeJS.ProcessEnv): Msg91Config {
  const authKey = env.MSG91_AUTH_KEY;
  const templateId = env.MSG91_TEMPLATE_ID;
  if (!authKey || !templateId) {
    throw new Error('OTP_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID (the DLT-approved template)');
  }
  return {
    authKey,
    templateId,
    templateIdHi: env.MSG91_TEMPLATE_ID_HI || undefined,
    timeoutMs: Number(env.MSG91_TIMEOUT_MS || 8000),
  };
}

/** MSG91 answers 200 with `{"type":"error"}` for a rejected request, so the body has to be read. */
interface Msg91Response {
  type?: string;
  message?: unknown;
}

/**
 * Sends the login code over MSG91. Throws when the code did not go out, so the caller does not tell
 * the user a message is on its way when it is not — and does not spend the SMS budget on it either.
 */
@Injectable()
export class Msg91OtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  constructor(private readonly config: Msg91Config) {}

  async send(phone: string, code: string, language: 'en' | 'hi'): Promise<void> {
    const template = language === 'hi' ? (this.config.templateIdHi ?? this.config.templateId) : this.config.templateId;
    // MSG91 wants the number with the country code and no '+'.
    const mobile = phone.replace(/^\+/, '');
    const body = JSON.stringify({ template_id: template, short_url: '0', recipients: [{ mobiles: mobile, OTP: code }] });

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: this.config.authKey, accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      // A timeout or a DNS failure. The code is never logged, so a retry simply sends a new one.
      throw new Error(`MSG91 unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    let parsed: Msg91Response = {};
    try {
      parsed = JSON.parse(text) as Msg91Response;
    } catch {
      // Left empty: a non-JSON body is reported through the status check below.
    }
    if (!res.ok || parsed.type === 'error') {
      const reason = typeof parsed.message === 'string' ? parsed.message : text.slice(0, 200);
      throw new Error(`MSG91 refused the message (${res.status}): ${reason}`);
    }
    // The code itself never reaches the log; only that one was sent, and to which masked number.
    this.logger.log(`sent to ${mobile.slice(0, 4)}XXXXX${mobile.slice(-2)} (${language})`);
  }
}
