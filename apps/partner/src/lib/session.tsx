import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Language, LoginResult, Me } from '@eventseva/app-shared';
import { api, onSessionEnded } from './api';
import { clearItemUploads, mediaUploads } from './uploadQueue';
import { unregisterPush } from './push';
import { isOffline } from './errors';
import { keys } from './queries';
import { languageStore, secureTokenStore } from './tokens';
import { applyLanguage } from '../i18n';

export type SessionState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; me: Me };

interface SessionApi {
  state: SessionState;
  me: Me | null;
  signIn(result: LoginResult): Promise<void>;
  signOut(): Promise<void>;
  updateMe(me: Me): void;
  retry(): void;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const setLanguage = useCallback(async (lang: Language) => {
    await applyLanguage(lang);
    await languageStore.set(lang);
  }, []);

  // On start: open in the last language, then check the saved login with the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedLang = await languageStore.get();
      if (savedLang === 'hi' || savedLang === 'en') await applyLanguage(savedLang);
      const tokens = await secureTokenStore.get();
      if (!tokens) {
        if (!cancelled) setState({ status: 'signedOut' });
        return;
      }
      try {
        const me = await api.get<Me>('/v1/me');
        await setLanguage(me.language);
        if (!cancelled) setState({ status: 'signedIn', me });
      } catch (e) {
        if (cancelled) return;
        if (isOffline(e)) setState({ status: 'offline' });
        else setState((await secureTokenStore.get()) ? { status: 'offline' } : { status: 'signedOut' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, setLanguage]);

  // Refresh failed for good or the account was blocked: back to login.
  useEffect(
    () =>
      onSessionEnded(() => {
        queryClient.clear();
        void applyLanguage('en');
        setState({ status: 'signedOut' });
      }),
    [queryClient],
  );

  const signIn = useCallback(
    async (result: LoginResult) => {
      queryClient.clear();
      // No business profile yet: the gate can go straight to onboarding without asking again.
      if (result.vendor === null) queryClient.setQueryData(keys.vendor, null);
      await setLanguage(result.user.language);
      setState({ status: 'signedIn', me: { ...result.user, cityId: null } });
    },
    [queryClient, setLanguage],
  );

  const signOut = useCallback(async () => {
    // Stop any uploads still going to Cloudinary for this vendor.
    mediaUploads.clear();
    clearItemUploads();
    await unregisterPush();
    await api.logout();
    queryClient.clear();
    await setLanguage('en');
    setState({ status: 'signedOut' });
  }, [queryClient, setLanguage]);

  const updateMe = useCallback((me: Me) => setState({ status: 'signedIn', me }), []);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<SessionApi>(
    () => ({ state, me: state.status === 'signedIn' ? state.me : null, signIn, signOut, updateMe, retry }),
    [state, signIn, signOut, updateMe, retry],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
