import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { PhotosView } from './PhotosView';

export const metadata: Metadata = { title: 'Photos' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function PhotosPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PhotosView />
    </Suspense>
  );
}
