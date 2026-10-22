// Bank details checks, the same rules the API applies, so mistakes show before saving.

export interface BankForm {
  holderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  upiId: string;
}

export type BankErrors = Partial<Record<keyof BankForm, 'required' | 'account' | 'mismatch' | 'ifsc' | 'upi'>>;

export const cleanDigits = (s: string) => s.replace(/\D/g, '');

export function validateBank(f: BankForm): BankErrors {
  const e: BankErrors = {};
  if (f.holderName.trim().length < 2) e.holderName = 'required';
  if (!/^\d{9,18}$/.test(f.accountNumber)) e.accountNumber = 'account';
  else if (f.confirmAccountNumber !== f.accountNumber) e.confirmAccountNumber = 'mismatch';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.trim().toUpperCase())) e.ifsc = 'ifsc';
  if (f.upiId.trim() && !/^[\w.-]{2,64}@[A-Za-z]{2,64}$/.test(f.upiId.trim())) e.upiId = 'upi';
  return e;
}

/** "XXXX XXXX 9012" — the app only ever knows the last 4 digits. */
export const maskAccount = (last4: string) => `XXXX XXXX ${last4}`;
