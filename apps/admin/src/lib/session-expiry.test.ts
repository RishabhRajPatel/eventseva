import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expiryPhase, formatClock, formatRemaining, msUntilWarning, SESSION_WARN_MS } from './session-expiry.ts';

const HOUR = 3600_000;
const MIN = 60_000;

test('warns 5 minutes before the 8-hour token ends', () => {
  assert.equal(SESSION_WARN_MS, 5 * MIN);
  const login = 1_000_000;
  const expiresAt = login + 8 * HOUR;
  assert.equal(expiryPhase(expiresAt, login), 'active');
  assert.equal(expiryPhase(expiresAt, expiresAt - 5 * MIN - 1), 'active');
  assert.equal(expiryPhase(expiresAt, expiresAt - 5 * MIN), 'warning');
  assert.equal(expiryPhase(expiresAt, expiresAt - 1), 'warning');
  assert.equal(expiryPhase(expiresAt, expiresAt), 'expired');
  assert.equal(expiryPhase(expiresAt, expiresAt + MIN), 'expired');
});

test('the warning timer fires 7 h 55 min after login, or at once when already late', () => {
  const login = 1_000_000;
  const expiresAt = login + 8 * HOUR;
  assert.equal(msUntilWarning(expiresAt, login), 7 * HOUR + 55 * MIN);
  assert.equal(msUntilWarning(expiresAt, expiresAt - 2 * MIN), 0);
  assert.equal(msUntilWarning(expiresAt, expiresAt + MIN), 0);
  // A custom warning window.
  assert.equal(expiryPhase(expiresAt, expiresAt - 9 * MIN, 10 * MIN), 'warning');
});

test('countdown text', () => {
  assert.equal(formatRemaining(5 * MIN), '5 min 00 s');
  assert.equal(formatRemaining(4 * MIN + 5_000), '4 min 05 s');
  assert.equal(formatRemaining(4 * MIN + 4_001), '4 min 05 s', 'rounds up, never shows 0 while time is left');
  assert.equal(formatRemaining(45_000), '45 s');
  assert.equal(formatRemaining(0), '0 s');
  assert.equal(formatRemaining(-5_000), '0 s');
});

test('end time in India time', () => {
  assert.match(formatClock(Date.parse('2026-10-26T13:12:00Z')), /^6:42\s?pm$/i);
});
