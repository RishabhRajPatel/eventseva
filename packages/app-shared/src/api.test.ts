import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApiClient, type TokenStore } from './api.ts';

type Pair = { accessToken: string; refreshToken: string } | null;

function memoryStore(initial: Pair): TokenStore & { value: Pair } {
  const store = {
    value: initial,
    async get() {
      return store.value;
    },
    async set(v: Pair) {
      store.value = v;
    },
  };
  return store;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('sends token and language; turns error bodies into ApiError', async () => {
  const seen: Request[] = [];
  const api = createApiClient({
    baseUrl: 'http://api/',
    tokens: memoryStore({ accessToken: 'A1', refreshToken: 'R1' }),
    getLanguage: () => 'hi',
    fetchImpl: async (input, init) => {
      seen.push(new Request(input as string, init));
      return json(400, { error: { code: 'OTP_INVALID', message: 'Wrong code', attemptsLeft: 3 } });
    },
  });
  await assert.rejects(api.get('/v1/me', { a: 1, b: undefined }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, 'OTP_INVALID');
    assert.deepEqual(e.details, { attemptsLeft: 3 });
    return true;
  });
  assert.equal(seen[0].url, 'http://api/v1/me?a=1');
  assert.equal(seen[0].headers.get('authorization'), 'Bearer A1');
  assert.equal(seen[0].headers.get('accept-language'), 'hi');
});

test('renews an expired access token once, shared by parallel calls, then retries', async () => {
  const store = memoryStore({ accessToken: 'old', refreshToken: 'R1' });
  let refreshCalls = 0;
  const api = createApiClient({
    baseUrl: 'http://api',
    tokens: store,
    fetchImpl: async (input, init) => {
      const req = new Request(input as string, init);
      if (req.url.endsWith('/v1/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', refreshToken: 'R2', accessExpiresInSec: 900 });
      }
      return req.headers.get('authorization') === 'Bearer new' ? json(200, { ok: true }) : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    },
  });
  const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(store.value, { accessToken: 'new', refreshToken: 'R2' });
});

test('a refused refresh logs out; a network failure keeps the tokens', async () => {
  let ended = 0;
  const store = memoryStore({ accessToken: 'old', refreshToken: 'R1' });
  let offline = true;
  const api = createApiClient({
    baseUrl: 'http://api',
    tokens: store,
    onSessionEnded: () => ended++,
    fetchImpl: async (input) => {
      if (String(input).endsWith('/v1/auth/refresh')) {
        if (offline) throw new TypeError('network down');
        return json(401, { error: { code: 'REFRESH_REUSED', message: 'Please log in again.' } });
      }
      return json(401, { error: { code: 'UNAUTHORIZED', message: 'Please log in again.' } });
    },
  });
  await assert.rejects(api.get('/v1/me'));
  assert.equal(ended, 0);
  assert.ok(store.value);

  offline = false;
  await assert.rejects(api.get('/v1/me'));
  assert.equal(ended, 1);
  assert.equal(store.value, null);
});

test('network errors become a friendly NETWORK error', async () => {
  const api = createApiClient({
    baseUrl: 'http://api',
    tokens: memoryStore(null),
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(api.get('/v1/categories', undefined, { auth: false }), { code: 'NETWORK' });
});

test('verifyOtp stores the tokens; logout clears them', async () => {
  const store = memoryStore(null);
  const api = createApiClient({
    baseUrl: 'http://api',
    tokens: store,
    fetchImpl: async (input) =>
      String(input).endsWith('/verify')
        ? json(200, { accessToken: 'A', refreshToken: 'R', accessExpiresInSec: 900, isNewUser: true, user: {}, vendor: null })
        : json(204, null),
  });
  await api.verifyOtp('9876543210', '123456', 'customer');
  assert.deepEqual(store.value, { accessToken: 'A', refreshToken: 'R' });
  await api.logout();
  assert.equal(store.value, null);
});
