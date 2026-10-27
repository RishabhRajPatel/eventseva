import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { ReportsView } from './ReportsView';

export const metadata: Metadata = { title: 'Reports' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReportsView />
    </Suspense>
  );
}
