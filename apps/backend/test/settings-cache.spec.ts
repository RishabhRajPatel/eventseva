// The settings cache, with a database whose reads this test resolves by hand. No app and no real
// Postgres: the point here is the ordering of a read against a save, which a real database would
// only ever hit by luck.
import { SettingsService, SETTINGS_TTL_MS } from '../src/admin/settings.service';
import type { AppConfig } from '../src/config';
import type { Db } from '../src/db/db.service';

const CONFIG = {
  advancePercent: 25,
  commissionPercent: 10,
  cashDuesLimitPaise: 500_000,
  platform: { name: 'EventSeva', address: null, gstin: null },
} as AppConfig;

const row = (advancePercent: number) => ({
  advancePercent,
  commissionPercent: 10,
  cashDuesLimitPaise: 500_000,
  cancellation: { customer: [{ minDays: 0, percent: 0 }], vendorPercent: 100 },
  name: 'EventSeva',
  address: null,
  gstin: null,
});

/** A Db whose `one()` hands back a promise the test decides when to settle. */
function pausableDb() {
  const pending: ((value: unknown) => void)[] = [];
  let reads = 0;
  const db = {
    one: () => {
      reads++;
      return new Promise((resolve) => pending.push(resolve));
    },
  } as unknown as Db;
  return {
    db,
    get reads() {
      return reads;
    },
    /** Finish the oldest unfinished read with this row. */
    finish(value: unknown) {
      pending.shift()!(value);
    },
  };
}

describe('platform settings cache', () => {
  it('serves one read to everyone who asks at once', async () => {
    const fake = pausableDb();
    const settings = new SettingsService(fake.db, CONFIG);

    const [a, b, c] = [settings.get(), settings.get(), settings.get()];
    expect(fake.reads).toBe(1);
    fake.finish(row(25));
    expect((await a).advancePercent).toBe(25);
    expect((await b).advancePercent).toBe(25);
    expect((await c).advancePercent).toBe(25);
  });

  it('answers from the cache until the TTL passes', async () => {
    const fake = pausableDb();
    const settings = new SettingsService(fake.db, CONFIG);
    const first = settings.get();
    fake.finish(row(25));
    await first;

    await settings.get();
    expect(fake.reads).toBe(1); // still cached

    const later = settings.get(Date.now() + SETTINGS_TTL_MS + 1);
    expect(fake.reads).toBe(2); // the TTL has passed, so it asks again
    fake.finish(row(40));
    expect((await later).advancePercent).toBe(40);
  });

  it('a read already in flight when a save lands does not put the old values back', async () => {
    const fake = pausableDb();
    const settings = new SettingsService(fake.db, CONFIG);

    // A read starts, and the admin's save commits before it comes back.
    const stale = settings.get();
    expect(fake.reads).toBe(1);
    settings.invalidate();
    fake.finish(row(25)); // the pre-save values arrive late
    expect((await stale).advancePercent).toBe(25); // this caller still gets what it asked for

    // The next caller must not be served those stale values out of the cache.
    const after = settings.get();
    expect(fake.reads).toBe(2);
    fake.finish(row(40));
    expect((await after).advancePercent).toBe(40);
  });

  it('falls back to the environment when the row is missing, so a stale database still starts', async () => {
    const fake = pausableDb();
    const settings = new SettingsService(fake.db, CONFIG);
    const q = settings.get();
    fake.finish(undefined);
    expect((await q)).toMatchObject({ advancePercent: 25, commissionPercent: 10, platform: { name: 'EventSeva' } });
  });
});
