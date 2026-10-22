import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { BookingDetailView } from './BookingDetailView';

export const metadata: Metadata = { title: 'Booking' };

// Rendered only in the browser (see ../../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function BookingPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BookingDetailView />
    </Suspense>
  );
}
