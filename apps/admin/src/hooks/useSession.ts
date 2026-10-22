'use client';
import { useSyncExternalStore } from 'react';
import { sessionStore } from '@/lib/api';
import type { AdminSession } from '@/lib/session';

/** The logged-in admin, or null. Only meaningful in the browser (see ClientOnly). */
export function useSession(): AdminSession | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.read, () => null);
}
