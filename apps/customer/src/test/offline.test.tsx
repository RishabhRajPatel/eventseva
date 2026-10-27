// The offline banner is driven by the real API client: a fetch that fails turns it on, the next
// answer from the server turns it off (manual Retry or the automatic re-check).
import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import { api } from '../lib/api';
import { setOnline } from '../lib/network';
import { OFFLINE_RETRY_MS, OfflineBanner } from '../components/OfflineBanner';
import { ToastProvider } from '../components/Toast';
import { makeTestClient } from './render';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const realFetch = globalThis.fetch;
const offline = (): Promise<Response> => Promise.reject(new TypeError('Network request failed'));
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

function renderBanner() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={makeTestClient()}>
        <ToastProvider>
          <OfflineBanner />
        </ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

afterEach(async () => {
  globalThis.fetch = realFetch;
  jest.useRealTimers();
  await act(async () => {
    setOnline(true);
  });
});

test('a NETWORK error from the API shows the banner; Retry hides it once the server answers', async () => {
  const fetchMock = jest.fn(offline);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const user = userEvent.setup();
  await renderBanner();
  expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen();

  await act(async () => {
    await expect(api.categories()).rejects.toMatchObject({ code: 'NETWORK' });
  });
  expect(screen.getByText('No internet. Showing saved data.')).toBeOnTheScreen();

  // Still offline: Retry says so and keeps the banner.
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Still no internet. We will keep trying on our own.')).toBeOnTheScreen();
  expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();

  fetchMock.mockImplementation(() => ok({ items: [] }));
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen());
  expect(screen.getByText('You are back online. Updating…')).toBeOnTheScreen();
});

test('while offline it checks again on its own and hides when back online', async () => {
  const fetchMock = jest.fn(offline);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await renderBanner();
  await act(async () => {
    await api.categories().catch(() => undefined);
  });
  expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
  // Fake timers only now, so the retry interval set while offline is controlled by the test.
  jest.useFakeTimers();
  await act(async () => {
    setOnline(true);
  });
  await act(async () => {
    setOnline(false);
  });
  const calls = fetchMock.mock.calls.length;

  fetchMock.mockImplementation(() => ok({ items: [] }));
  await act(async () => {
    jest.advanceTimersByTime(OFFLINE_RETRY_MS + 10);
  });
  expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  await waitFor(() => expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen());
});
