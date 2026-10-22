import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '@eventseva/app-shared';

const KEY = 'eventseva.partner.tokens';

/** Login tokens live in the phone's keystore, never in plain storage. */
export const secureTokenStore: TokenStore = {
  async get() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      return raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string }) : null;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    if (tokens) await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
    else await SecureStore.deleteItemAsync(KEY);
  },
};

const LANG_KEY = 'eventseva.partner.language';

/** The last chosen language, so the app opens in it before /v1/me answers. */
export const languageStore = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(LANG_KEY);
    } catch {
      return null;
    }
  },
  async set(lang: string) {
    try {
      await SecureStore.setItemAsync(LANG_KEY, lang);
    } catch {
      // Not critical: the server copy is applied after login anyway.
    }
  },
};
