import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { ChecksView } from './ChecksView';

export const metadata: Metadata = { title: 'Car checks' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function ChecksPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ChecksView />
    </Suspense>
  );
}
