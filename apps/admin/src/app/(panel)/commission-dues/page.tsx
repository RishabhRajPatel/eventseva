import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { CommissionDuesView } from './CommissionDuesView';

export const metadata: Metadata = { title: 'Commission dues' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function CommissionDuesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CommissionDuesView />
    </Suspense>
  );
}
