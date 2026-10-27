import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn, docLabel, missingRequired, statusTotals, validRange } from './checks.ts';

test('papers a vehicle or driver still needs', () => {
  assert.deepEqual(missingRequired({ kind: 'vehicle', documents: [{ id: 'd1', docType: 'vehicle_rc', status: 'pending', rejectReason: null }] }), ['vehicle_insurance']);
  assert.deepEqual(missingRequired({ kind: 'driver', documents: [{ id: 'd1', docType: 'driver_licence', status: 'rejected', rejectReason: 'Blurry' }] }), ['driver_licence']);
  assert.equal(docLabel('vehicle_puc'), 'PUC certificate');
});

test('age from the date of birth', () => {
  assert.equal(ageOn('2005-11-28', '2026-11-27'), 20);
  assert.equal(ageOn('2005-11-27', '2026-11-27'), 21);
});

test('report rows and date range', () => {
  assert.deepEqual(
    statusTotals([
      { status: 'confirmed', bookingType: 'slot', bookings: 2, amountPaise: '100000' },
      { status: 'confirmed', bookingType: 'transport', bookings: 1, amountPaise: '500000' },
      { status: 'requested', bookingType: 'slot', bookings: 4, amountPaise: '40000' },
    ]),
    [
      { status: 'requested', bookings: 4, amountPaise: 40_000 },
      { status: 'confirmed', bookings: 3, amountPaise: 600_000 },
    ],
  );
  assert.equal(validRange('2026-11-01', '2026-11-30'), null);
  assert.ok(validRange('2026-12-01', '2026-11-30'));
  assert.ok(validRange('1/11/2026', ''));
});
