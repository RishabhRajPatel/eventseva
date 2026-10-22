import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { VendorDetailView } from './VendorDetailView';

export const metadata: Metadata = { title: 'Vendor' };

// Rendered only in the browser (see ../../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function VendorPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <VendorDetailView />
    </Suspense>
  );
}
