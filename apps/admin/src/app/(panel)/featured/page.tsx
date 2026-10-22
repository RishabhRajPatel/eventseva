import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { FeaturedView } from './FeaturedView';

export const metadata: Metadata = { title: 'Featured' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function FeaturedPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <FeaturedView />
    </Suspense>
  );
}
