// One HTTP client for all three front ends. It adds the access token and the app language,
// turns error bodies into ApiError, and renews the access token once when it expires.
import type { ApiErrorBody, AppName, Language, LoginResult, TokenPair } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Where tokens live: SecureStore on phones, memory/sessionStorage in the admin panel. */
export interface TokenStore {
  get(): Promise<Pick<TokenPair, 'accessToken' | 'refreshToken'> | null>;
  set(tokens: Pick<TokenPair, 'accessToken' | 'refreshToken'> | null): Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  /** Sent as Accept-Language, so category names and similar text come back in that language. */
  getLanguage?: () => Language;
  /** Called when the login is gone for good (refresh failed, account blocked): show the login screen. */
  onSessionEnded?: () => void;
  /** false for the admin panel, whose tokens are not renewed. */
  canRefresh?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** false for public routes (no token sent). */
  auth?: boolean;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const canRefresh = opts.canRefresh ?? true;
  let refreshing: Promise<boolean> | null = null;

  function url(path: string, query?: Query) {
    const qs = Object.entries(query ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${opts.baseUrl.replace(/\/$/, '')}${path}${qs ? `?${qs}` : ''}`;
  }

  async function send(method: string, path: string, o: RequestOptions, accessToken?: string) {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': opts.getLanguage?.() ?? 'en' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
    try {
      return await doFetch(url(path, o.query), {
        method,
        headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'No internet connection. Please check and try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as unknown;
    if (res.ok) return json as T;
    const err = (json as ApiErrorBody | null)?.error;
    if (!err) throw new ApiError(res.status, 'HTTP_' + res.status, 'Something went wrong. Please try again.');
    const { code, message, ...details } = err;
    throw new ApiError(res.status, code, message, details);
  }

  /** Renews the token pair; parallel callers share one refresh call. */
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const current = await opts.tokens.get();
        if (!current?.refreshToken) return false;
        const res = await send('POST', '/v1/auth/refresh', { body: { refreshToken: current.refreshToken } });
        if (!res.ok) {
          // Only a definite "no" logs the user out; a network blip keeps the tokens.
          if (res.status === 401) await endSession();
          return false;
        }
        const pair = (await res.json()) as TokenPair;
        await opts.tokens.set({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function endSession() {
    await opts.tokens.set(null);
    opts.onSessionEnded?.();
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const auth = o.auth ?? true;
    const tokens = auth ? await opts.tokens.get() : null;
    let res = await send(method, path, o, tokens?.accessToken);
    if (res.status === 401 && auth && tokens) {
      if (!canRefresh) {
        await endSession();
      } else if (await refresh()) {
        res = await send(method, path, o, (await opts.tokens.get())?.accessToken);
        // Refused even with a fresh token: the session was closed (logout everywhere, blocked).
        if (res.status === 401) await endSession();
      }
      // A failed refresh has already ended the session if the server said no; after a
      // network error the tokens are kept and the 401 below reaches the caller.
    }
    return parse<T>(res);
  }

  return {
    request,
    get: <T>(path: string, query?: Query, o: Omit<RequestOptions, 'query'> = {}) => request<T>('GET', path, { ...o, query }),
    post: <T>(path: string, body?: unknown, o: Omit<RequestOptions, 'body'> = {}) => request<T>('POST', path, { ...o, body: body ?? {} }),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
    delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),

    // ---- phone login (customer + Partner app) ----
    sendOtp: (phone: string) =>
      request<{ sent: true; expiresInSec: number; resendAfterSec: number }>('POST', '/v1/auth/otp/send', { body: { phone }, auth: false }),
    async verifyOtp(phone: string, code: string, app: AppName, deviceName?: string): Promise<LoginResult> {
      const result = await request<LoginResult>('POST', '/v1/auth/otp/verify', { body: { phone, code, app, deviceName }, auth: false });
      await opts.tokens.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      return result;
    },
    async logout() {
      await request('POST', '/v1/auth/logout').catch(() => undefined);
      await opts.tokens.set(null);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** For forms: the message to show for an error from any call. */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
