import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closedBookingsMessage } from './closed-bookings.ts';

test('says what pausing a vendor did to its bookings', () => {
  assert.equal(closedBookingsMessage('Vendor put on hold.', { closedBookings: 0, confirmedBookings: 0 }), 'Vendor put on hold.');
  assert.equal(
    closedBookingsMessage('Vendor put on hold.', { closedBookings: 2, confirmedBookings: 1 }),
    'Vendor put on hold. 2 waiting requests were closed and the customers told. 1 confirmed booking still needs a call to the customer.',
  );
  assert.equal(closedBookingsMessage('Done.', undefined), 'Done.');
});
