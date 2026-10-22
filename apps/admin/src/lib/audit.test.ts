import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditDiff, auditTargetHref, changedKeys } from './audit.ts';

test('audit diff marks changed keys', () => {
  const before = { id: 3, name: 'Varanasi', isActive: false, tags: ['a'] };
  const after = { id: 3, name: 'Varanasi', isActive: true, tags: ['a', 'b'], reason: 'Launch' };
  assert.deepEqual(changedKeys(before, after), ['isActive', 'tags', 'reason']);
  const rows = auditDiff(before, after);
  assert.deepEqual(rows.map((r) => r.key), ['id', 'name', 'isActive', 'tags', 'reason']);
  assert.equal(rows[2].before, 'false');
  assert.equal(rows[2].after, 'true');
  assert.equal(rows[4].before, undefined);
  assert.equal(rows[3].after, '[\n  "a",\n  "b"\n]');
});

test('audit diff for creates, deletes and plain values', () => {
  assert.deepEqual(changedKeys(null, { days: 3 }), ['days']);
  assert.deepEqual(changedKeys({ days: 3 }, null), ['days']);
  assert.deepEqual(auditDiff(null, null), []);
  assert.deepEqual(auditDiff(1, 2), [{ key: 'value', before: '1', after: '2', changed: true }]);
  assert.deepEqual(changedKeys({ a: { b: 1 } }, { a: { b: 1 } }), []);
});

test('audit target links', () => {
  assert.equal(auditTargetHref('vendor', 'abc'), '/vendors/abc');
  assert.equal(auditTargetHref('booking', 'b1'), '/bookings/b1');
  assert.equal(auditTargetHref('coupon', '4'), null);
  assert.equal(auditTargetHref('vendor', null), null);
});
