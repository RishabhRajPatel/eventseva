import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRange, exportUrl, filenameFromDisposition } from './csv.ts';

test('file name from Content-Disposition', () => {
  assert.equal(filenameFromDisposition('attachment; filename="eventseva-bookings-from-2026-10-01.csv"', 'x.csv'), 'eventseva-bookings-from-2026-10-01.csv');
  assert.equal(filenameFromDisposition('attachment; filename=plain.csv', 'x.csv'), 'plain.csv');
  assert.equal(filenameFromDisposition(`attachment; filename="a.csv"; filename*=UTF-8''b%20c.csv`, 'x.csv'), 'b c.csv');
  assert.equal(filenameFromDisposition('attachment; filename="../../etc/passwd"', 'x.csv'), 'passwd');
  assert.equal(filenameFromDisposition('attachment', 'x.csv'), 'x.csv');
  assert.equal(filenameFromDisposition(null, 'x.csv'), 'x.csv');
  assert.equal(filenameFromDisposition('attachment; filename=""', 'x.csv'), 'x.csv');
});

test('export url and date range', () => {
  assert.equal(exportUrl('payouts'), '/api/v1/admin/export/payouts');
  assert.equal(exportUrl('bookings', '2026-10-01', ''), '/api/v1/admin/export/bookings?from=2026-10-01');
  assert.equal(exportUrl('users', '2026-10-01', '2026-10-31'), '/api/v1/admin/export/users?from=2026-10-01&to=2026-10-31');
  assert.equal(checkRange('2026-10-01', '2026-10-31'), null);
  assert.equal(checkRange('', '2026-10-31'), null);
  assert.ok(checkRange('2026-11-01', '2026-10-31'));
});
