import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { VendorsView } from './VendorsView';

export const metadata: Metadata = { title: 'Vendors' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function VendorsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <VendorsView />
    </Suspense>
  );
}
