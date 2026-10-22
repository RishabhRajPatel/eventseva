import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLength, checkLogin, cleanTotp, isEmail, REASON_LIMITS, safeNextPath } from './validate.ts';

test('reason length follows the API limits', () => {
  assert.equal(checkLength('   ', REASON_LIMITS.vendor), 'Reason is required.');
  assert.equal(checkLength('blur', REASON_LIMITS.vendor), 'Reason must be at least 5 characters.');
  assert.equal(checkLength('blur', REASON_LIMITS.standard), null);
  assert.equal(checkLength('x'.repeat(301), REASON_LIMITS.standard), 'Reason must be at most 300 characters.');
  assert.equal(checkLength('ab', { min: 3, max: 100 }, 'Reference'), 'Reference must be at least 3 characters.');
});

test('login form checks', () => {
  assert.equal(cleanTotp(' 12-34 567 '), '123456');
  assert.equal(isEmail('admin@eventseva.in'), true);
  assert.equal(isEmail('admin@'), false);
  assert.deepEqual(checkLogin({ email: 'admin@eventseva.in', password: 'x', totp: '123456' }), {});
  assert.deepEqual(Object.keys(checkLogin({ email: '', password: '', totp: '12' })), ['email', 'password', 'totp']);
});

test('only same-site paths are allowed after login', () => {
  assert.equal(safeNextPath('/vendors/abc?x=1'), '/vendors/abc?x=1');
  assert.equal(safeNextPath(null), '/dashboard');
  assert.equal(safeNextPath('https://evil.example'), '/dashboard');
  assert.equal(safeNextPath('//evil.example'), '/dashboard');
  assert.equal(safeNextPath('/\\evil.example'), '/dashboard');
  assert.equal(safeNextPath('/login?next=/x'), '/dashboard');
});
