'use client';
import { createContext, useContext } from 'react';
import type { QueryState } from '@/hooks/useApiQuery';
import type { Dashboard } from '@/lib/admin-types';
import type { AdminSession } from '@/lib/session';
import type { useToast } from './Toast';

export interface ShellValue {
  session: AdminSession;
  toast: ReturnType<typeof useToast>;
  /** Dashboard numbers for the nav badges; undefined while loading. */
  counts: Dashboard | undefined;
  /** The same GET /v1/admin/dashboard, with loading and error state: the dashboard page reuses it. */
  countsState: QueryState<Dashboard>;
  refreshCounts: () => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

/** The logged-in admin and shell services. Only inside the admin pages. */
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside AdminShell');
  return value;
}
