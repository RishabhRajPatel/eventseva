import { Suspense, type ReactNode } from 'react';
import { AdminShell, ShellFallback } from '@/components/AdminShell';

// Admin pages render only in the browser (the session lives in sessionStorage), so on the
// server this shows the shell fallback; each page opts out of instant validation (`instant`).
export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
