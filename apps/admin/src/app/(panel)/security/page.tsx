import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { SecurityView } from './SecurityView';

export const metadata: Metadata = { title: 'My security' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function SecurityPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SecurityView />
    </Suspense>
  );
}
