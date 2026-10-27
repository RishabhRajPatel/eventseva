import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeError, ERROR_MESSAGES, isStaleError } from './errors.ts';

const err = (status: number, code: string, message = '', details: Record<string, unknown> = {}) => ({ status, code, message, details });

test('every mapped code gives a full sentence with a next step, never the raw code', () => {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    const text = describeError(err(400, code, 'Server text.'));
    assert.match(text, /^[A-Z“].*[.!]$/, code);
    assert.ok(!text.includes(code), `${code} leaks the code`);
    // At least two sentences: what happened, then what to do.
    assert.ok(/[.!?] +[A-Z“]/.test(text), `${code}: "${text}" should say what to do next`);
  }
});

test('codes from docs/API.md for the admin routes are all covered', () => {
  const documented = [
    'VALIDATION',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'RATE_LIMITED',
    'ADMIN_LOGIN_FAILED',
    'ADMIN_LOCKED',
    'VENDOR_BAD_STATUS',
    'REFUND_TOO_HIGH',
    'PAYOUT_ALREADY_PAID',
    'CATEGORY_EXISTS',
    'LAST_CITY',
    'OTP_SERVICE_BUSY',
  ];
  for (const code of documented) assert.ok(ERROR_MESSAGES[code], code);
});

test('server details are kept where they matter', () => {
  assert.equal(
    describeError(err(400, 'REFUND_TOO_HIGH', 'At most ₹1,200 can still be refunded.', { maxPaise: 120000 })),
    'At most ₹1,200 can still be refunded. Lower the amount and try again.',
  );
  assert.equal(
    describeError(err(409, 'VENDOR_BAD_STATUS', 'This vendor is on hold, so this cannot be done')),
    'This vendor is on hold, so this cannot be done. Another admin may have decided already; the page has been refreshed.',
  );
});

test('unknown codes use the API message; server outages and non-API errors get a plain sentence', () => {
  assert.equal(describeError(err(409, 'SOMETHING_NEW', 'This needs a different date')), 'This needs a different date.');
  assert.match(describeError(err(502, 'HTTP_502', 'Something went wrong. Please try again.')), /server is not responding/);
  assert.match(describeError(err(0, 'NETWORK', 'x')), /internet connection/);
  assert.equal(describeError(new Error('boom')), 'Something went wrong. Please try again.');
  assert.equal(describeError(null), 'Something went wrong. Please try again.');
});

test('stale codes close the dialog and reload', () => {
  assert.equal(isStaleError(err(409, 'PAYOUT_BAD_STATUS')), true);
  assert.equal(isStaleError(err(404, 'NOT_FOUND')), true);
  assert.equal(isStaleError(err(400, 'VALIDATION')), false);
  assert.equal(isStaleError(new Error('x')), false);
});
