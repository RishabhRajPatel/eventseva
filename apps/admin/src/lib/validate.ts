// Form checks that match the API's validation, so mistakes show before a request is sent.

/** Reason lengths per API route (class-validator @Length on the backend). */
export const REASON_LIMITS = {
  /** Vendor reject / hold: shown to the vendor. */
  vendor: { min: 5, max: 300 },
  /** Media reject, user block, payout hold, review hide. */
  standard: { min: 3, max: 300 },
} as const;

export const REFERENCE_LIMITS = { min: 3, max: 100 } as const;
export const RESOLUTION_LIMITS = { min: 3, max: 2000 } as const;

/** null when the text is fine, otherwise the message to show. */
export function checkLength(value: string, limits: { min: number; max: number }, what = 'Reason'): string | null {
  const length = value.trim().length;
  if (length === 0) return `${what} is required.`;
  if (length < limits.min) return `${what} must be at least ${limits.min} characters.`;
  if (length > limits.max) return `${what} must be at most ${limits.max} characters.`;
  return null;
}

/** Keeps only digits, at most 6: what the 2FA field shows while typing or pasting. */
export const cleanTotp = (value: string): string => value.replace(/\D/g, '').slice(0, 6);

export const isTotp = (value: string): boolean => /^\d{6}$/.test(value);

export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export interface LoginInput {
  email: string;
  password: string;
  totp: string;
  /** Lost phone: one of the one-time recovery codes instead of the 6-digit code. */
  recoveryCode?: string;
  useRecovery?: boolean;
}

/** "abcde fghjk" → "ABCDE-FGHJK"; null when it is not 10 recovery-code characters. */
export function cleanRecoveryCode(value: string): string | null {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : null;
}

export type LoginErrors = Partial<Record<keyof LoginInput, string>>;

export function checkLogin(input: LoginInput): LoginErrors {
  const errors: LoginErrors = {};
  if (!isEmail(input.email)) errors.email = 'Enter your work email.';
  if (!input.password) errors.password = 'Enter your password.';
  if (input.useRecovery) {
    if (!cleanRecoveryCode(input.recoveryCode ?? '')) errors.recoveryCode = 'Enter one of your recovery codes, like ABCDE-FGHJK.';
  } else if (!isTotp(input.totp)) errors.totp = 'Enter the 6-digit code from your authenticator app.';
  return errors;
}

/**
 * Where to go after login: only same-site paths, so a crafted ?next= link cannot send the
 * admin to another site.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/api/')) return fallback;
  return next;
}
