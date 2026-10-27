import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRetryRefund, chargeKind, decisionErrors } from './disputes.ts';

test('a decision can lower or waive a charge, never raise it', () => {
  assert.deepEqual(decisionErrors({ amount: '300', note: 'Only one chair broke' }, 60_000), {});
  assert.deepEqual(decisionErrors({ amount: '0', note: 'Waived' }, 60_000), {});
  assert.match(decisionErrors({ amount: '601', note: 'ok ok' }, 60_000).amount ?? '', /at most ₹600/);
  assert.ok(decisionErrors({ amount: 'abc', note: 'ok ok' }, 60_000).amount);
  assert.ok(decisionErrors({ amount: '100', note: ' a ' }, 60_000).note);
});

test('labels and retry rule', () => {
  assert.equal(chargeKind('extra_km'), 'Extra km');
  assert.equal(chargeKind('broken_glass'), 'broken glass');
  assert.equal(canRetryRefund({ status: 'failed', reason: 'Booking cancelled' }), true);
  assert.equal(canRetryRefund({ status: 'failed', reason: 'Booking cancelled:retried' }), false);
  assert.equal(canRetryRefund({ status: 'sent', reason: 'x' }), false);
});
