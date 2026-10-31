import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import { SettingsView } from './SettingsView';

export const metadata: Metadata = { title: 'Settings' };

// Rendered only in the browser (see ../layout.tsx), so not validated for instant navigation.
export const instant = false;

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SettingsView />
    </Suspense>
  );
}
