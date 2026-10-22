'use client';
import { useSyncExternalStore, type ReactNode } from 'react';

const noSubscribe = () => () => {};

/**
 * Renders its children only in the browser, and the fallback on the server and during hydration.
 * The admin session is in sessionStorage, which the server cannot read, so there is nothing
 * useful to prerender below this point.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const inBrowser = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  return inBrowser ? children : fallback;
}
