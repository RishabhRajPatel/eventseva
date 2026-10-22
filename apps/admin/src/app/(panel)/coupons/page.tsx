import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { CouponsView } from './CouponsView';

export const metadata: Metadata = { title: 'Coupons' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function CouponsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CouponsView />
    </Suspense>
  );
}
