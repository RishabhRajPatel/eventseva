import { Injectable, Logger } from '@nestjs/common';

export const OTP_SENDER = Symbol('OTP_SENDER');

/**
 * The SMS provider is not decided yet (MSG91 / 2Factor / Firebase / Twilio). Each one is a
 * small class implementing this interface; switching providers changes only that class.
 */
export interface OtpSender {
  send(phone: string, code: string, language: 'en' | 'hi'): Promise<void>;
}

/** Development only: prints the code to the server log instead of sending an SMS. */
@Injectable()
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  async send(phone: string, code: string) {
    this.logger.log(`OTP for ${phone.slice(0, 5)}XXXXX${phone.slice(-2)}: ${code}`);
  }
}
