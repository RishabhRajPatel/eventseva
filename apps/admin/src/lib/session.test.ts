import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionStore, SESSION_KEY, type KeyValueStorage } from './session.ts';

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const login = { accessToken: 'tok-1', expiresInSec: 8 * 3600, admin: { id: 'a1', email: 'admin@eventseva.in', role: 'super' } };

test('saves, reads and clears the session', async () => {
  const storage = memoryStorage();
  let now = 1_000_000;
  const store = createSessionStore(() => storage, () => now);
  assert.equal(store.read(), null);

  const saved = store.save(login);
  assert.equal(saved.expiresAt, now + 8 * 3600_000);
  assert.deepEqual(store.read()?.admin, { id: 'a1', email: 'admin@eventseva.in', role: 'super' });
  // Same object while nothing changed (needed by useSyncExternalStore).
  assert.equal(store.read(), store.read());
  assert.deepEqual(await store.tokens.get(), { accessToken: 'tok-1', refreshToken: '' });

  now += 8 * 3600_000; // token expired
  assert.equal(store.read(), null);
  assert.equal(await store.tokens.get(), null);

  now -= 1000;
  store.clear();
  assert.equal(store.read(), null);
  assert.equal(storage.data.has(SESSION_KEY), false);
});

test('the API client ending the session clears it, and listeners hear about it', async () => {
  const storage = memoryStorage();
  const store = createSessionStore(() => storage);
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.save(login);
  await store.tokens.set({ accessToken: 'ignored', refreshToken: 'ignored' }); // never stores app-style tokens
  assert.equal(store.read()?.token, 'tok-1');
  await store.tokens.set(null);
  assert.equal(store.read(), null);
  assert.equal(calls, 2);
  unsubscribe();
  store.save(login);
  assert.equal(calls, 2);
});

test('ignores broken or tampered storage', () => {
  const storage = memoryStorage();
  const store = createSessionStore(() => storage);
  storage.setItem(SESSION_KEY, '{not json');
  assert.equal(store.read(), null);
  storage.setItem(SESSION_KEY, JSON.stringify({ token: 't', expiresAt: Date.now() + 1000, admin: { id: 'a', email: 'e', role: 'god' } }));
  assert.equal(store.read(), null);
  assert.throws(() => store.save({ ...login, admin: { ...login.admin, role: 'god' } }));
});

test('updates the admin from /v1/admin/me and survives blocked storage', () => {
  const storage = memoryStorage();
  const store = createSessionStore(() => storage);
  store.save(login);
  store.updateAdmin({ id: 'a1', email: 'admin@eventseva.in', role: 'finance' });
  assert.equal(store.read()?.admin.role, 'finance');
  assert.equal(store.read()?.token, 'tok-1');

  const blocked = createSessionStore(() => {
    throw new Error('SecurityError');
  });
  assert.equal(blocked.read(), null);
  blocked.clear();
});
