import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { DisputesView } from './DisputesView';

export const metadata: Metadata = { title: 'Disputes' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function DisputesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DisputesView />
    </Suspense>
  );
}
