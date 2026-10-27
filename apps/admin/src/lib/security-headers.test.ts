import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECURITY_HEADERS } from '../../next.config.ts';

const header = (k: string) => SECURITY_HEADERS.find((h) => h.key === k)?.value ?? '';

test('the panel cannot be framed, leaks no URLs, and loads code only from itself', () => {
  assert.equal(header('X-Frame-Options'), 'DENY');
  assert.equal(header('Referrer-Policy'), 'no-referrer');
  const csp = header('Content-Security-Policy');
  for (const rule of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "connect-src 'self'"]) {
    assert.ok(csp.includes(rule), rule);
  }
  assert.match(csp, /img-src 'self' data: blob: https:\/\/res\.cloudinary\.com/);
});
