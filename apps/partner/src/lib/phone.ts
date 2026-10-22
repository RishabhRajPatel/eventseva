/** Indian mobile numbers: 10 digits starting with 6–9. */
export const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

/** "+91 98XXX XXX10" for the OTP screen. */
export function maskPhone(e164: string): string {
  const m = /^\+91(\d{2})\d{6}(\d{2})$/.exec(e164);
  return m ? `+91 ${m[1]}XXX XXX${m[2]}` : e164;
}
