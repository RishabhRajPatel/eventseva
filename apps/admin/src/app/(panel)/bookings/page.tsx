import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { BookingsView } from './BookingsView';

export const metadata: Metadata = { title: 'Bookings' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function BookingsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <BookingsView />
    </Suspense>
  );
}
