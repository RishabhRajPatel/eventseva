// The heart: optimistic, with "Saved" / "Removed · Undo" toasts, rolled back if the server says no.
import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError, type VendorCard } from '@eventseva/app-shared';
import SearchScreen from '../app/(tabs)/search';
import { api } from '../lib/api';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
const mockedApi = api as unknown as Record<string, jest.Mock>;

const dj: VendorCard = {
  id: 'v9',
  businessName: 'Beat Box DJ',
  area: 'Naini',
  category: { slug: 'dj', name: 'DJ & Sound', icon: 'dj' },
  ratingAvg: 4.5,
  ratingCount: 8,
  isFeatured: false,
  startingPricePaise: 1_500_000,
  cover: null,
};
const savedDj = { ...dj, savedAt: '2026-10-20T10:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.categories.mockResolvedValue({ items: [] });
  mockedApi.vendors.mockResolvedValue({ items: [dj], page: 1, hasMore: false });
});

test('saving fills the heart at once and rolls back with a clear message when it fails', async () => {
  mockedApi.shortlist.mockResolvedValue({ items: [] });
  let fail!: (e: unknown) => void;
  mockedApi.save.mockReturnValue(new Promise((_, reject) => (fail = reject)));
  const user = userEvent.setup();
  await renderApp({ search: SearchScreen }, '/search');
  await user.press(await screen.findByRole('button', { name: 'Save vendor' }));

  // Optimistic: selected before the server answers, with a toast.
  expect(await screen.findByRole('button', { name: 'Remove from saved' })).toBeSelected();
  expect(screen.getByText('Saved. Find it in Profile → Saved vendors.')).toBeOnTheScreen();
  expect(mockedApi.save).toHaveBeenCalledWith('v9');

  await act(async () => fail(new ApiError(500, 'INTERNAL', 'boom')));
  // Rolled back, and the error says what happened and what to do.
  expect(await screen.findByRole('button', { name: 'Save vendor' })).not.toBeSelected();
  expect(screen.getByText('Our server had a problem. Please try again in a minute.')).toBeOnTheScreen();
});

test('removing shows "Removed" with Undo, and Undo saves the vendor again', async () => {
  mockedApi.shortlist.mockResolvedValue({ items: [savedDj] });
  mockedApi.unsave.mockResolvedValue(undefined);
  mockedApi.save.mockResolvedValue(undefined);
  const user = userEvent.setup();
  await renderApp({ search: SearchScreen }, '/search');
  const heart = await screen.findByRole('button', { name: 'Remove from saved' });
  expect(heart).toBeSelected();

  mockedApi.shortlist.mockResolvedValue({ items: [] });
  await user.press(heart);
  expect(await screen.findByRole('button', { name: 'Save vendor' })).not.toBeSelected();
  expect(mockedApi.unsave).toHaveBeenCalledWith('v9');
  expect(screen.getByText('Removed from saved vendors')).toBeOnTheScreen();

  mockedApi.shortlist.mockResolvedValue({ items: [savedDj] });
  await user.press(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(mockedApi.save).toHaveBeenCalledWith('v9'));
  expect(await screen.findByRole('button', { name: 'Remove from saved' })).toBeSelected();
});
