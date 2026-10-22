// Who is logged in. The root layout shows login, the name screen or the app from this state.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type LoginResult, type Me } from '@eventseva/app-shared';
import { setLanguage } from '../i18n';
import { api, onSessionEnded } from './api';
import { unregisterPush } from './push';
import { queryClient } from './queryClient';
import { cachedMe, secureTokens } from './tokens';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** Logged in, but the profile could not be loaded (offline on first start). */
  | { status: 'unreachable' }
  | { status: 'signedIn'; me: Me };

interface SessionApi {
  state: SessionState;
  me: Me | null;
  signIn(result: LoginResult): Promise<void>;
  setMe(me: Me): void;
  signOut(everywhere?: boolean): Promise<void>;
  retry(): void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const setMe = useCallback((me: Me) => {
    setState({ status: 'signedIn', me });
    void cachedMe.set(me);
    void setLanguage(me.language);
  }, []);

  /** Logged out (by the user, or because the server ended the session). Login is English only. */
  const clear = useCallback(async () => {
    setState({ status: 'signedOut' });
    queryClient.clear();
    await cachedMe.set(null).catch(() => undefined);
    await setLanguage('en');
  }, []);

  useEffect(() => {
    onSessionEnded(() => void clear());
  }, [clear]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokens = await secureTokens.get();
      if (!tokens) return alive && setState({ status: 'signedOut' });
      const saved = await cachedMe.get();
      if (saved) setMe(saved);
      try {
        const me = await api.me();
        if (alive) setMe(me);
      } catch (e) {
        // A 401 has already ended the session through onSessionEnded.
        if (!alive || (e instanceof ApiError && e.status === 401)) return;
        if (!saved) setState({ status: 'unreachable' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt, setMe]);

  const value = useMemo<SessionApi>(
    () => ({
      state,
      me: state.status === 'signedIn' ? state.me : null,
      async signIn(result) {
        setMe({ ...result.user, cityId: null });
      },
      setMe,
      async signOut(everywhere) {
        await unregisterPush();
        await (everywhere ? api.logoutAll() : api.logout());
        await clear();
      },
      retry: () => {
        setState({ status: 'loading' });
        setAttempt((n) => n + 1);
      },
    }),
    [state, setMe, clear],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}

const NOBODY: Me = { id: '', phone: '', name: null, language: 'en', cityId: null };

/** For screens that only render when logged in (an empty profile while logging out). */
export function useMe(): Me {
  return useSession().me ?? NOBODY;
}
