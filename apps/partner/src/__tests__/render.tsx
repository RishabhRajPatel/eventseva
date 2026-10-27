import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render } from '@testing-library/react-native';
import '../i18n';
import { ConfirmHost } from '../components/ConfirmDialog';
import { ToastHost } from '../components/Toast';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Renders a screen with a fresh query cache (no retries), safe-area insets, and the toast and confirm hosts. */
export function renderScreen(ui: ReactElement, client = testQueryClient()) {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        {ui}
        <ToastHost />
        <ConfirmHost />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

export const testQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
