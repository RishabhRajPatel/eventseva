/** What pausing or blocking a vendor did to its bookings (POST …/hold and …/block return these counts). */
export interface ClosedBookings {
  closedBookings?: number;
  confirmedBookings?: number;
}

/** "Vendor put on hold. 2 waiting requests were closed. 1 confirmed booking still needs a call to the customer." */
export function closedBookingsMessage(done: string, result: unknown): string {
  const r = (result ?? {}) as ClosedBookings;
  const parts = [done];
  if (r.closedBookings) {
    parts.push(`${r.closedBookings} waiting ${r.closedBookings === 1 ? 'request was' : 'requests were'} closed and the customers told.`);
  }
  if (r.confirmedBookings) {
    parts.push(`${r.confirmedBookings} confirmed ${r.confirmedBookings === 1 ? 'booking still needs' : 'bookings still need'} a call to the customer.`);
  }
  return parts.join(' ');
}
