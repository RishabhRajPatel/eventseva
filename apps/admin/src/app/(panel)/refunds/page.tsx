import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { RefundsView } from './RefundsView';

export const metadata: Metadata = { title: 'Refunds' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function RefundsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RefundsView />
    </Suspense>
  );
}
