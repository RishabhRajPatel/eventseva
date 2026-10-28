import type { Booking, CashKind, CashSummary } from '@eventseva/app-shared';

export const cashKey = (bookingId: string) => ['cash', bookingId] as const;

/** Which cash entries make sense now: take money while the booking runs, give back any time after. */
export function cashKinds(booking: Pick<Booking, 'status'>, cash: Pick<CashSummary, 'depositPaise' | 'depositHeldPaise' | 'receivedPaise' | 'amountPaise'>): CashKind[] {
  const kinds: CashKind[] = [];
  const running = ['confirmed', 'completed'].includes(booking.status);
  if (running && cash.receivedPaise < cash.amountPaise) kinds.push(cash.receivedPaise === 0 ? 'advance' : 'balance');
  if (booking.status === 'confirmed' && cash.depositPaise > cash.depositHeldPaise) kinds.push('deposit');
  if (cash.depositHeldPaise > 0) kinds.push('deposit_return');
  if (cash.receivedPaise > 0) kinds.push('refund');
  return kinds;
}
