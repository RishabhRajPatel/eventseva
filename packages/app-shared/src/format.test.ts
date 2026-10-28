import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardImage, imageWidth, wideImage } from './cloudinary.ts';
import { addDays, formatDay, formatPhone, invoiceText, rupees, timeLeft, todayIst } from './format.ts';

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

test('invoice text for the share sheet', () => {
  const text = invoiceText({
    title: 'Tax invoice', number: 'V1A2B3C/2026-27/0001', issuedAt: '2026-11-08T06:30:00Z',
    seller: { name: 'Raj Cars', address: 'Civil Lines', gstin: '09ABCDE1234F1Z5' }, buyer: { name: 'Rahul', address: null, gstin: null },
    booking: { id: 'abcdef12-0000-0000-0000-000000000000', service: 'Wedding car', from: null, until: null, day: '2026-11-07' },
    lines: [{ description: 'Wedding car (up to 8 h, 80 km)', qty: 1, amountPaise: 500_000 }, { description: 'Extra km', qty: 20, amountPaise: 40_000 }],
    taxablePaise: 540_000, cgstPaise: 13_500, sgstPaise: 13_500, totalPaise: 567_000, paidPaise: 567_000, note: 'Issued through EventSeva.',
  });
  assert.match(text, /^Tax invoice V1A2B3C\/2026-27\/0001/);
  assert.match(text, /GSTIN 09ABCDE1234F1Z5/);
  assert.match(text, /Booking ABCDEF12: Wedding car/);
  assert.match(text, /Extra km × 20: ₹400/);
  assert.match(text, /CGST: ₹135/);
  assert.match(text, /Total: ₹5,670/);
  assert.doesNotMatch(text, /Refunded/);
  const pro = invoiceText({ ...JSON.parse(JSON.stringify({ title: 'Proforma invoice', number: 'PROFORMA', issuedAt: '2026-11-08T06:30:00Z', seller: { name: 'A', address: null, gstin: null }, buyer: { name: 'B', address: null, gstin: null }, booking: { id: 'abcdef12', service: 'S', from: null, until: null, day: '2026-11-07' }, lines: [], taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, totalPaise: 0, note: '' })) });
  assert.match(pro, /^Proforma invoice\n/);
});
