'use client';
import { useCallback, useRef, useState } from 'react';

/**
 * Busy state plus a double-submit guard. `run(fn)` does nothing while a previous run is still going,
 * even when two clicks (or Enter presses) land before React re-renders.
 */
export function useBusy(): [busy: boolean, run: (fn: () => Promise<void>) => Promise<void>] {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
