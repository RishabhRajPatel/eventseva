'use client';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The current time, updated every `stepMs` (rounded down to the step, so renders in between see the
 * same value). For live text such as "5 min ago" or a countdown (UX.md §5).
 */
export function useNow(stepMs: number): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const timer = window.setInterval(onChange, stepMs);
      return () => window.clearInterval(timer);
    },
    [stepMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / stepMs) * stepMs,
    () => 0,
  );
}
