import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALERT_GUIDES, alertGuide, openAlerts, smsBudget, timeAgo, type SystemAlert } from './alerts.ts';

test('SMS budget bar: royal below 80%, peach from 80%, red from 100%', () => {
  assert.deepEqual(
    [0, 1599, 1600, 1999, 2000, 2999, 3000].map((used) => {
      const b = smsBudget(used, 2000);
      return [b.level, b.colour];
    }),
    [
      ['ok', 'royal'],
      ['ok', 'royal'],
      ['warning', 'peach'],
      ['warning', 'peach'],
      ['full', 'red'],
      ['full', 'red'],
      ['stopped', 'red'],
    ],
  );
});

test('SMS budget text, percent and bar width', () => {
  const b = smsBudget(1240, 2000);
  assert.equal(b.text, '1,240 / 2,000');
  assert.equal(b.percent, 62);
  assert.equal(b.fill, 62);
  // 99.95% is not shown as "100%" before the budget is really used up.
  assert.equal(smsBudget(1999, 2000).percent, 99);
  // Over budget: the bar stops at full width, the percent keeps counting.
  const over = smsBudget(2600, 2000);
  assert.equal(over.fill, 100);
  assert.equal(over.percent, 130);
  assert.match(over.status, /New sign-ups are paused/);
  assert.match(smsBudget(3000, 2000).status, /No login codes/);
  // Indian digit grouping, like the rest of the panel.
  assert.equal(smsBudget(150000, 200000).text, '1,50,000 / 2,00,000');
});

test('SMS budget copes with missing or odd numbers', () => {
  assert.deepEqual(
    { ...smsBudget(5, 0), status: '' },
    { used: 5, perDay: 0, percent: 0, fill: 0, level: 'ok', colour: 'royal', text: '5 / 0', status: '' },
  );
  assert.equal(smsBudget(-3, 10).used, 0);
  assert.equal(smsBudget(Number.NaN, 10).level, 'ok');
});

test('each alert kind has a "what to do" line pointing at Users and the .env budget', () => {
  for (const kind of ['sms_budget_warning', 'sms_budget_reached', 'sms_budget_hard_stop']) {
    const g = alertGuide(kind);
    assert.equal(g, ALERT_GUIDES[kind]);
    assert.match(g.whatToDo, /Admin → Users/);
    assert.match(g.whatToDo, /OTP_DAILY_SMS_BUDGET/);
    assert.match(g.whatToDo, /\.env/);
  }
  assert.equal(alertGuide('sms_budget_warning').severity, 'warning');
  assert.equal(alertGuide('sms_budget_reached').severity, 'danger');
  assert.match(alertGuide('sms_budget_reached').whatToDo, /Existing users can still log in/);
  assert.equal(alertGuide('sms_budget_hard_stop').severity, 'danger');
  assert.match(alertGuide('sms_budget_hard_stop').whatToDo, /Nobody can log in/);
});

test('an unknown alert kind still gets a title and an action', () => {
  const g = alertGuide('disk_almost_full');
  assert.equal(g.title, 'Disk almost full');
  assert.equal(g.severity, 'warning');
  assert.match(g.whatToDo, /mark it resolved/);
});

test('timeAgo', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(timeAgo('2026-10-26T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-10-26T11:55:00Z', now), '5 min ago');
  assert.equal(timeAgo('2026-10-26T10:00:00Z', now), '2 hours ago');
  assert.equal(timeAgo('2026-10-25T12:00:00Z', now), '1 day ago');
});

test('openAlerts drops resolved ones and puts the serious ones first', () => {
  const a = (id: number, kind: string, createdAt: string, resolvedAt: string | null = null): SystemAlert => ({
    id,
    kind,
    message: '',
    data: null,
    createdAt,
    resolvedAt,
    resolvedBy: null,
  });
  const list = [
    a(1, 'sms_budget_warning', '2026-10-26T09:00:00Z'),
    a(2, 'sms_budget_reached', '2026-10-26T08:00:00Z'),
    a(3, 'sms_budget_hard_stop', '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z'),
    a(4, 'sms_budget_hard_stop', '2026-10-26T10:30:00Z'),
  ];
  assert.deepEqual(
    openAlerts(list).map((x) => x.id),
    [4, 2, 1],
  );
});
