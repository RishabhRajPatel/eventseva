import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { debounce, SEARCH_DEBOUNCE_MS } from './debounce.ts';

test('search waits 300 ms after the last keystroke', () => {
  assert.equal(SEARCH_DEBOUNCE_MS, 300);
});

test('calls once with the latest value after the quiet period', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls: string[] = [];
    const search = debounce((q: string) => calls.push(q), 300);
    search('r');
    mock.timers.tick(100);
    search('ra');
    mock.timers.tick(100);
    search('raj');
    mock.timers.tick(299);
    assert.deepEqual(calls, []);
    assert.equal(search.pending(), true);
    mock.timers.tick(1);
    assert.deepEqual(calls, ['raj']);
    assert.equal(search.pending(), false);
    // Nothing more fires later.
    mock.timers.tick(1000);
    assert.deepEqual(calls, ['raj']);
  } finally {
    mock.timers.reset();
  }
});

test('flush runs a pending call now (Enter); cancel drops it (unmount)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls: string[] = [];
    const search = debounce((q: string) => calls.push(q), 300);
    search('dj');
    search.flush();
    assert.deepEqual(calls, ['dj']);
    mock.timers.tick(300);
    assert.deepEqual(calls, ['dj'], 'not called a second time');
    search.flush(); // nothing pending: no call
    assert.deepEqual(calls, ['dj']);

    search('tent');
    search.cancel();
    mock.timers.tick(1000);
    assert.deepEqual(calls, ['dj']);
  } finally {
    mock.timers.reset();
  }
});

test('works with injected timers', () => {
  let scheduled: (() => void) | null = null;
  const timers = {
    setTimeout: (fn: () => void) => {
      scheduled = fn;
      return 1;
    },
    clearTimeout: () => {
      scheduled = null;
    },
  };
  const seen: number[] = [];
  const d = debounce((n: number) => seen.push(n), 300, timers);
  d(1);
  d(2);
  (scheduled as (() => void) | null)?.();
  assert.deepEqual(seen, [2]);
});
