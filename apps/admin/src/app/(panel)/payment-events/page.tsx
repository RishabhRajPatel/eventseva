import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { PaymentEventsView } from './PaymentEventsView';

export const metadata: Metadata = { title: 'Payment events' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function PaymentEventsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PaymentEventsView />
    </Suspense>
  );
}
