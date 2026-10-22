import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { CitiesView } from './CitiesView';

export const metadata: Metadata = { title: 'Cities' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function CitiesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CitiesView />
    </Suspense>
  );
}
