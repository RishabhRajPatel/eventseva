// "Enter a fresh 2FA code" for money and personal-data actions. The API client calls
// askSecondFactor(); the dialog mounted in the shell shows the question and answers it.

export interface SecondFactorRequest {
  /** New for every question, so the dialog starts empty each time. */
  id: number;
  /** The last code was refused (wrong, or already used). */
  wrong: boolean;
  answer: (code: string | null) => void;
}

type Listener = (request: SecondFactorRequest | null) => void;
let listener: Listener | null = null;
let pending: SecondFactorRequest | null = null;
let nextId = 1;

/** The dialog registers here; returns the unregister function. */
export function onSecondFactorRequest(l: Listener): () => void {
  listener = l;
  l(pending);
  return () => {
    if (listener === l) listener = null;
  };
}

/** Resolves with the 6-digit code, or null when cancelled (or when no dialog is mounted, e.g. on /login). */
export function askSecondFactor(wrong: boolean): Promise<string | null> {
  if (!listener) return Promise.resolve(null);
  pending?.answer(null);
  return new Promise((resolve) => {
    const request: SecondFactorRequest = {
      id: nextId++,
      wrong,
      answer: (code) => {
        if (pending === request) pending = null;
        listener?.(null);
        resolve(code);
      },
    };
    pending = request;
    listener?.(request);
  });
}

/** "123 456" / " 123456 " → "123456", or null if it is not 6 digits. */
export const cleanCode = (value: string) => {
  const digits = value.replace(/\s/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
};
