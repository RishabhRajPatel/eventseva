import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { AuditView } from './AuditView';

export const metadata: Metadata = { title: 'Audit log' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuditView />
    </Suspense>
  );
}
