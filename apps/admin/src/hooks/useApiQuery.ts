'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

type Query = Record<string, string | number | boolean | undefined | null>;

interface Result {
  key: string;
  nonce: number;
  receivedAt: number;
  data?: unknown;
  error?: unknown;
}

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first response for these arguments arrives. */
  loading: boolean;
  /** True while reloading data that is already shown (after a mutation). */
  refreshing: boolean;
  /** When the shown data arrived (epoch ms), e.g. to know if a signed link is still valid. */
  receivedAt: number | undefined;
  reload: () => void;
}

/**
 * GET with loading / error state. Pass null as the path to skip the request.
 * Effects re-run when Activity shows a hidden page again, so revisiting a page refreshes it.
 */
export function useApiQuery<T>(path: string | null, query: Query = {}, auth = true): QueryState<T> {
  const key = path === null ? null : JSON.stringify({ path, query, auth });
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (key === null) return;
    const args = JSON.parse(key) as { path: string; query: Query; auth: boolean };
    let cancelled = false;
    api.get<unknown>(args.path, args.query, { auth: args.auth }).then(
      (data) => !cancelled && setResult({ key, nonce, receivedAt: Date.now(), data }),
      (error: unknown) => !cancelled && setResult({ key, nonce, receivedAt: Date.now(), error }),
    );
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = result !== null && result.key === key ? result : null;
  // Same object while nothing changed, so memoised children and context consumers skip re-renders.
  return useMemo(
    () => ({
      data: current?.data as T | undefined,
      error: current?.error,
      loading: key !== null && current === null,
      refreshing: current !== null && current.nonce !== nonce,
      receivedAt: current?.receivedAt,
      reload,
    }),
    [current, key, nonce, reload],
  );
}
