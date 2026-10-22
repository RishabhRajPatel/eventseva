import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOOKING_STATUS,
  canHoldPayout,
  canMarkPaid,
  chartScale,
  humanize,
  pageFrom,
  shortId,
  statusLabel,
  toQueryString,
  vendorDecisions,
  waitingFor,
} from './labels.ts';

test('status labels, with a fallback for new statuses', () => {
  assert.deepEqual(statusLabel(BOOKING_STATUS, 'accepted'), { label: 'Payment pending', tone: 'warning' });
  assert.deepEqual(statusLabel(BOOKING_STATUS, 'on_the_way'), { label: 'On the way', tone: 'neutral' });
  assert.equal(humanize('cancelled_by_vendor'), 'Cancelled by vendor');
});

test('vendor decisions match the API rules', () => {
  assert.deepEqual(vendorDecisions('pending'), ['approve', 'reject', 'hold']);
  assert.deepEqual(vendorDecisions('approved'), ['hold']);
  assert.deepEqual(vendorDecisions('on_hold'), ['approve']);
  assert.deepEqual(vendorDecisions('rejected'), []);
  assert.deepEqual(vendorDecisions('draft'), []);
});

test('payout actions match the API rules', () => {
  assert.equal(canMarkPaid('held'), true);
  assert.equal(canMarkPaid('paid'), false);
  assert.equal(canHoldPayout('scheduled'), true);
  assert.equal(canHoldPayout('held'), false);
});

test('display helpers', () => {
  assert.equal(shortId('1a2b3c4d-0000-4000-8000-000000000000'), '1A2B3C4D');
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(waitingFor('2026-10-22T11:59:40Z', now), 'just now');
  assert.equal(waitingFor('2026-10-22T11:15:00Z', now), '45 min');
  assert.equal(waitingFor('2026-10-22T07:00:00Z', now), '5 hours');
  assert.equal(waitingFor('2026-10-20T12:00:00Z', now), '2 days');
});

test('query strings and paging from the URL', () => {
  assert.equal(toQueryString({ status: 'paid', due: false, q: '', page: 1 }), '?status=paid');
  assert.equal(toQueryString({ q: '', page: 1 }), '');
  assert.equal(toQueryString({ status: 'held', due: true, page: 3 }), '?status=held&due=true&page=3');
  assert.equal(pageFrom('2'), 2);
  assert.equal(pageFrom('-1'), 1);
  assert.equal(pageFrom('abc'), 1);
  assert.equal(pageFrom(null), 1);
});

test('chart scale rounds up to readable ticks', () => {
  assert.deepEqual(chartScale([0, 0]), { max: 4, ticks: [0, 2, 4] });
  assert.deepEqual(chartScale([1, 3]), { max: 3, ticks: [0, 1, 2, 3] });
  assert.deepEqual(chartScale([7, 2]), { max: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(chartScale([37]), { max: 40, ticks: [0, 10, 20, 30, 40] });
});

test('documents: Aadhaar is masked, links refresh before they expire', async () => {
  const { docNumber, isLinkStale, historyLabel } = await import('./labels.ts');
  assert.equal(docNumber('aadhaar', '4821'), 'XXXX XXXX 4821');
  assert.equal(docNumber('pan', '123F'), 'ending 123F');
  assert.equal(docNumber('gst', null), null);
  const t = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(isLinkStale(t, t + 8 * 60_000), false);
  assert.equal(isLinkStale(t, t + 9 * 60_000 + 1), true);
  assert.equal(historyLabel('vendor.hold'), 'Put on hold');
  assert.equal(historyLabel('document.reject'), 'Document rejected');
  assert.equal(historyLabel('vendor.feature'), 'Vendor feature');
});
