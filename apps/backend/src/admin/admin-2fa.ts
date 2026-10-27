import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SetMetadata } from '@nestjs/common';
import { decrypt, encrypt } from '../common/crypto';
import { base32Encode } from './totp';

/** After a fresh 2FA code, other sensitive actions need no new code for this long. */
export const STEP_UP_MIN = 5;
export const RECOVERY_CODE_COUNT = 8;
/** Header carrying the fresh 2FA code for a sensitive action. */
export const STEP_UP_HEADER = 'x-admin-2fa';

export const STEP_UP_KEY = 'adminStepUp';
/**
 * Money, bulk personal data and blocking: the admin must have entered a fresh 2FA code in the last
 * few minutes, so a stolen session token alone cannot move money or export customers.
 */
export const StepUp = () => SetMetadata(STEP_UP_KEY, true);

/** The 2FA secret is stored encrypted; rows written before this change are still plain base32. */
export const sealSecret = (secret: string, key: Buffer) => encrypt(secret, key);
export const isSealed = (stored: string) => stored.startsWith('v1:');
export const openSecret = (stored: string, key: Buffer) => (isSealed(stored) ? decrypt(stored, key) : stored);

/** "abcde fghjk" / "ABCDEFGHJK" → "ABCDE-FGHJK". */
export const normalizeRecoveryCode = (code: string) => {
  const clean = code.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : null;
};

/** Keyed hash: a stolen database alone is not enough to try codes offline. */
export const hashRecoveryCode = (code: string, key: Buffer) => createHmac('sha256', key).update(`recovery:${code}`).digest('base64url');

export function newRecoveryCodes(key: Buffer): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => hashRecoveryCode(c, key)) };
}

/** Index of the matching stored hash, or -1. Compares every entry in constant time. */
export function findRecoveryCode(code: string, hashes: string[], key: Buffer): number {
  const normal = normalizeRecoveryCode(code);
  if (!normal) return -1;
  const want = Buffer.from(hashRecoveryCode(normal, key));
  let found = -1;
  hashes.forEach((h, i) => {
    const have = Buffer.from(h);
    if (have.length === want.length && timingSafeEqual(have, want) && found === -1) found = i;
  });
  return found;
}
