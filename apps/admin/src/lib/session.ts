// The admin login, kept in sessionStorage so closing the tab logs out. Admin tokens last 8 h
// and are never refreshed; an expired session reads as logged out.
import { isAdminRole, type AdminRole } from './roles.ts';

export interface AdminIdentity {
  id: string;
  email: string;
  role: AdminRole;
}

export interface AdminSession {
  token: string;
  admin: AdminIdentity;
  /** Epoch ms when the token stops working. */
  expiresAt: number;
}

/** What POST /v1/admin/login returns. */
export interface AdminLoginResult {
  accessToken: string;
  expiresInSec: number;
  admin: { id: string; email: string; role: string };
}

/** The part of the Web Storage API the store needs (sessionStorage in the browser). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_KEY = 'eventseva.admin.session';

function parseSession(raw: string | null): AdminSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AdminSession>;
    const admin = value.admin;
    if (
      typeof value.token !== 'string' ||
      !value.token ||
      typeof value.expiresAt !== 'number' ||
      !admin ||
      typeof admin.id !== 'string' ||
      typeof admin.email !== 'string' ||
      !isAdminRole(admin.role)
    ) {
      return null;
    }
    return { token: value.token, expiresAt: value.expiresAt, admin: { id: admin.id, email: admin.email, role: admin.role } };
  } catch {
    return null;
  }
}

export function createSessionStore(getStorage: () => KeyValueStorage | null, now: () => number = Date.now) {
  const listeners = new Set<() => void>();
  // read() must return the same object while nothing changed (useSyncExternalStore).
  let cachedRaw: string | null = null;
  let cached: AdminSession | null = null;

  function storage(): KeyValueStorage | null {
    try {
      return getStorage();
    } catch {
      return null; // storage blocked (privacy mode)
    }
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function read(): AdminSession | null {
    const raw = storage()?.getItem(SESSION_KEY) ?? null;
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parseSession(raw);
    }
    return cached && cached.expiresAt > now() ? cached : null;
  }

  function write(session: AdminSession | null) {
    const s = storage();
    if (!s) return;
    if (session) s.setItem(SESSION_KEY, JSON.stringify(session));
    else s.removeItem(SESSION_KEY);
    notify();
  }

  return {
    read,
    /** Saves a fresh login; throws if the server sent an unknown role. */
    save(login: AdminLoginResult): AdminSession {
      const { role } = login.admin;
      if (!isAdminRole(role)) throw new Error(`Unknown admin role: ${role}`);
      const session: AdminSession = {
        token: login.accessToken,
        expiresAt: now() + login.expiresInSec * 1000,
        admin: { id: login.admin.id, email: login.admin.email, role },
      };
      write(session);
      return session;
    },
    /** Keeps the token but updates who the admin is (GET /v1/admin/me), e.g. after a role change. */
    updateAdmin(admin: { id: string; email: string; role: string }) {
      const current = read();
      if (!current || !isAdminRole(admin.role)) return;
      const same = current.admin.email === admin.email && current.admin.role === admin.role && current.admin.id === admin.id;
      if (!same) write({ ...current, admin: { id: admin.id, email: admin.email, role: admin.role } });
    },
    clear() {
      write(null);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Adapter for createApiClient's TokenStore (admin tokens have no refresh token). */
    tokens: {
      get: async () => {
        const session = read();
        return session ? { accessToken: session.token, refreshToken: '' } : null;
      },
      set: async (tokens: { accessToken: string; refreshToken: string } | null) => {
        if (tokens === null) write(null);
      },
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
