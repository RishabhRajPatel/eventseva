import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { OverdueReturnsView } from './OverdueReturnsView';

export const metadata: Metadata = { title: 'Overdue returns' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function OverdueReturnsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <OverdueReturnsView />
    </Suspense>
  );
}
