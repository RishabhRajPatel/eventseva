/** The 10 digits of an Indian mobile from what the user typed, or null. */
export function tenDigits(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** "+91 98XXX XXX10": enough to recognise the number without showing it all. */
export function maskedPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return digits;
  return `+91 ${d.slice(0, 2)}XXX XXX${d.slice(8)}`;
}
