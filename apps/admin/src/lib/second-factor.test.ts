import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askSecondFactor, cleanCode, onSecondFactorRequest, type SecondFactorRequest } from './second-factor.ts';

test('codes are 6 digits, spaces allowed', () => {
  assert.equal(cleanCode('123 456'), '123456');
  assert.equal(cleanCode(' 654321 '), '654321');
  assert.equal(cleanCode('12345'), null);
  assert.equal(cleanCode('ABCDE-FGHJK'), null);
});

test('with no dialog mounted (login page) nothing is asked', async () => {
  assert.equal(await askSecondFactor(false), null);
});

test('the dialog answers the question; a newer question replaces an older one', async () => {
  const seen: (SecondFactorRequest | null)[] = [];
  const off = onSecondFactorRequest((r) => seen.push(r));
  const first = askSecondFactor(false);
  const second = askSecondFactor(true);
  assert.equal(await first, null);
  const current = seen.at(-1)!;
  assert.equal(current.wrong, true);
  current.answer('222222');
  assert.equal(await second, '222222');
  assert.equal(seen.at(-1), null);
  off();
});
