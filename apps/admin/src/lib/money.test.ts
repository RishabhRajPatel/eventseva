import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maxDeductionPaise, maxRefundablePaise, paiseToRupeesInput, refundFormErrors, rupeesToPaise } from './money.ts';

test('rupee input becomes paise', () => {
  assert.equal(rupeesToPaise('500'), 50_000);
  assert.equal(rupeesToPaise(' ₹1,500.5 '), 150_050);
  assert.equal(rupeesToPaise('499.99'), 49_999);
  assert.equal(rupeesToPaise('0.1'), 10);
  assert.equal(rupeesToPaise('1.005'), null);
  assert.equal(rupeesToPaise('-5'), null);
  assert.equal(rupeesToPaise('abc'), null);
  assert.equal(rupeesToPaise(''), null);
  assert.equal(paiseToRupeesInput(150_050), '1500.5');
});

const booking = (refundPaise: number, payments: Array<{ type: string; status: string; amountPaise: number }>) => ({ refundPaise, payments });

test('max refundable is the paid advance minus refunds', () => {
  assert.equal(maxRefundablePaise(booking(0, [{ type: 'advance', status: 'paid', amountPaise: 250_000 }])), 250_000);
  assert.equal(
    maxRefundablePaise(
      booking(100_000, [
        { type: 'advance', status: 'created', amountPaise: 250_000 },
        { type: 'advance', status: 'paid', amountPaise: 250_000 },
        { type: 'refund', status: 'refunded', amountPaise: 100_000 },
      ]),
    ),
    150_000,
  );
  // Nothing paid yet, or fully refunded.
  assert.equal(maxRefundablePaise(booking(0, [{ type: 'advance', status: 'created', amountPaise: 250_000 }])), 0);
  assert.equal(maxRefundablePaise(booking(300_000, [{ type: 'advance', status: 'paid', amountPaise: 250_000 }])), 0);
});

test('refund form checks amount and reason', () => {
  assert.deepEqual(refundFormErrors({ amount: '500', reason: 'Vendor came late' }, 150_000), {});
  assert.match(refundFormErrors({ amount: '1501', reason: 'Vendor came late' }, 150_000).amount ?? '', /At most ₹1500/);
  assert.ok(refundFormErrors({ amount: '0.5', reason: 'Vendor came late' }, 150_000).amount);
  assert.ok(refundFormErrors({ amount: 'x', reason: 'Vendor came late' }, 150_000).amount);
  assert.ok(refundFormErrors({ amount: '100', reason: 'late' }, 150_000).reason);
});

test('the vendor payout can give at most its share minus earlier deductions', () => {
  assert.equal(maxDeductionPaise({ advancePaise: 375_000, commissionPaise: 150_000, payoutDeductionPaise: 0 }), 225_000);
  assert.equal(maxDeductionPaise({ advancePaise: 375_000, commissionPaise: 150_000, payoutDeductionPaise: 50_000 }), 175_000);
  assert.equal(maxDeductionPaise({ advancePaise: 375_000, commissionPaise: 150_000, payoutDeductionPaise: 999_999 }), 0);
});
