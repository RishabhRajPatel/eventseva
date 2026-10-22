import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityFormErrors, grantFormErrors, planFormErrors } from './places.ts';

test('city, plan and free-days forms', () => {
  assert.deepEqual(cityFormErrors({ name: 'Varanasi', nameHi: 'वाराणसी', state: 'Uttar Pradesh' }), {});
  assert.deepEqual(Object.keys(cityFormErrors({ name: 'V', nameHi: '', state: ' ' })).sort(), ['name', 'nameHi', 'state']);
  assert.deepEqual(planFormErrors({ nameEn: '7 days', nameHi: '7 दिन', days: '7', price: '499' }, true), {});
  assert.ok(planFormErrors({ nameEn: '7 days', nameHi: '7 दिन', days: '400', price: '499' }, true).days);
  assert.deepEqual(planFormErrors({ nameEn: '7 days', nameHi: '7 दिन', days: '', price: '499' }, false), {}, 'days are fixed after creation');
  assert.ok(planFormErrors({ nameEn: '7 days', nameHi: '7 दिन', days: '7', price: '0.5' }, true).price);
  assert.deepEqual(grantFormErrors({ days: '3', reason: 'Launch offer' }), {});
  assert.ok(grantFormErrors({ days: '0', reason: 'ok' }).days);
  assert.ok(grantFormErrors({ days: '3', reason: 'ok' }).reason);
});
