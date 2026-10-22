import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { ComplaintsView } from './ComplaintsView';

export const metadata: Metadata = { title: 'Complaints' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function ComplaintsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ComplaintsView />
    </Suspense>
  );
}
