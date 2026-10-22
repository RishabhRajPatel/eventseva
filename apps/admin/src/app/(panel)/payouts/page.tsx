import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { PayoutsView } from './PayoutsView';

export const metadata: Metadata = { title: 'Payouts' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function PayoutsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PayoutsView />
    </Suspense>
  );
}
