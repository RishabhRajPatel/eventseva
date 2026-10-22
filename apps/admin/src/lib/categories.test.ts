import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryFormErrors, moveId } from './categories.ts';
import { canView, navFor } from './roles.ts';

test('category form needs both names, Hindi in Devanagari', () => {
  assert.deepEqual(categoryFormErrors({ nameEn: 'Mehendi Artist', nameHi: 'मेहंदी आर्टिस्ट', icon: 'makeup', defaultUnit: 'per_person' }), {});
  const e = categoryFormErrors({ nameEn: 'M', nameHi: 'Mehendi', icon: 'makeup', defaultUnit: 'per_person' });
  assert.ok(e.nameEn);
  assert.match(e.nameHi ?? '', /Devanagari/);
});

test('moving a category swaps it with its neighbour and stops at the ends', () => {
  assert.deepEqual(moveId([1, 2, 3], 2, -1), [2, 1, 3]);
  assert.deepEqual(moveId([1, 2, 3], 2, 1), [1, 3, 2]);
  assert.deepEqual(moveId([1, 2, 3], 1, -1), [1, 2, 3]);
  assert.deepEqual(moveId([1, 2, 3], 9, 1), [1, 2, 3]);
});

test('only super admins see Categories', () => {
  assert.equal(canView('super', 'categories'), true);
  for (const role of ['verifier', 'support', 'finance'] as const) {
    assert.equal(canView(role, 'categories'), false);
    assert.ok(!navFor(role).some((n) => n.section === 'categories'));
  }
});
