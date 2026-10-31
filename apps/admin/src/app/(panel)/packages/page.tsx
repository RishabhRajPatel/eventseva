import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { PackagesView } from './PackagesView';

export const metadata: Metadata = { title: 'Packages' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function PackagesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PackagesView />
    </Suspense>
  );
}
