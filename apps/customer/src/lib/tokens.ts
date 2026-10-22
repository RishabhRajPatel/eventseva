// Login tokens and the cached profile live in the phone's secure storage (Keystore / Keychain).
import * as SecureStore from 'expo-secure-store';
import type { Me, TokenStore } from '@eventseva/app-shared';

const TOKENS_KEY = 'eventseva.tokens';
const ME_KEY = 'eventseva.me';

type Tokens = Awaited<ReturnType<TokenStore['get']>>;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, JSON.stringify(value));
}

/** Kept in memory too, so each API call does not hit secure storage. */
let cached: Tokens | undefined;

export const secureTokens: TokenStore = {
  async get() {
    if (cached === undefined) cached = await readJson<NonNullable<Tokens>>(TOKENS_KEY);
    return cached;
  },
  async set(tokens) {
    cached = tokens;
    await writeJson(TOKENS_KEY, tokens);
  },
};

/** The last profile we saw, so the app can open offline. */
export const cachedMe = {
  get: () => readJson<Me>(ME_KEY),
  set: (me: Me | null) => writeJson(ME_KEY, me),
};
