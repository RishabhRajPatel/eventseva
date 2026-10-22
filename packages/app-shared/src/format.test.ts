import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardImage, imageWidth, wideImage } from './cloudinary.ts';
import { addDays, formatDay, formatPhone, rupees, timeLeft, todayIst } from './format.ts';

test('rupees use Indian grouping', () => {
  assert.equal(rupees(13_500_000), '₹1,35,000');
  assert.equal(rupees(149_999), '₹1,499.99');
});

test('days never shift with the time zone', () => {
  assert.equal(formatDay('2027-02-12'), '12 Feb 2027');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(todayIst(new Date('2026-10-21T20:00:00Z')), '2026-10-22');
});

test('phone and countdown', () => {
  assert.equal(formatPhone('+919876543210'), '+91 98765 43210');
  assert.equal(timeLeft(new Date(Date.now() + 5 * 3600_000 + 20 * 60_000 + 500).toISOString()), '5h 20m');
  assert.equal(timeLeft(new Date(Date.now() - 1000).toISOString()), null);
});

test('cloudinary sizes: rounded steps, padded cards, no upscaling', () => {
  assert.equal(imageWidth(180, 2), 400);
  assert.equal(imageWidth(180, 3.5), 600);
  assert.equal(cardImage('demo', 'v/a', 180, 120, 2), 'https://res.cloudinary.com/demo/image/upload/w_400,h_267,c_pad,b_blurred:400:15,f_auto,q_auto:good/v/a');
  assert.match(wideImage('demo', 'v/a', 390, 3), /w_1200,c_limit/);
});
