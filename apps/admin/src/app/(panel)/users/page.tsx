import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { UsersView } from './UsersView';

export const metadata: Metadata = { title: 'Users' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function UsersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <UsersView />
    </Suspense>
  );
}
