import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { DashboardView } from './DashboardView';

export const metadata: Metadata = { title: 'Dashboard' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DashboardView />
    </Suspense>
  );
}
