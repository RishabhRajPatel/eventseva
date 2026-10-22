import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { CategoriesView } from './CategoriesView';

export const metadata: Metadata = { title: 'Categories' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function CategoriesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CategoriesView />
    </Suspense>
  );
}
