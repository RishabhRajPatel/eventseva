'use client';
import { createContext, useContext } from 'react';
import type { Dashboard } from '@/lib/admin-types';
import type { AdminSession } from '@/lib/session';
import type { useToast } from './Toast';

export interface ShellValue {
  session: AdminSession;
  toast: ReturnType<typeof useToast>;
  /** Dashboard numbers for the nav badges; undefined while loading. */
  counts: Dashboard | undefined;
  refreshCounts: () => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

/** The logged-in admin and shell services. Only inside the admin pages. */
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside AdminShell');
  return value;
}
