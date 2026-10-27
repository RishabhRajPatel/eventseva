import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError, rupees, type VendorCard } from '@eventseva/app-shared';
import HomeScreen from '../app/(tabs)/index';
import SearchScreen from '../app/(tabs)/search';
import ChatThreadScreen from '../app/chat/[id]';
import { setLanguage } from '../i18n';
import { api } from '../lib/api';
import { renderApp } from './render';
import { setWindowSize } from './setup';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/session', () => ({
  useMe: () => ({ id: 'u1', phone: '+919876543210', name: 'Rahul Verma', language: 'en', cityId: 1 }),
  useSession: () => ({}),
}));

const mockedApi = api as unknown as Record<string, jest.Mock>;
const Stub = () => null;

const categories = [
  { id: 1, slug: 'hall', name: 'Marriage hall', icon: 'hall', defaultUnit: 'per_shift' },
  { id: 2, slug: 'dj', name: 'DJ & sound', icon: 'dj', defaultUnit: 'per_event' },
];
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

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.categories.mockResolvedValue({ items: categories });
  mockedApi.vendors.mockResolvedValue({ items: [dj], page: 1, hasMore: false });
  mockedApi.notifications.mockResolvedValue({ items: [], hasMore: false, unreadCount: 2 });
  mockedApi.shortlist.mockResolvedValue({ items: [] });
});

afterEach(() => setLanguage('en'));

test('home shows the greeting, services, top vendors and the unread bell', async () => {
  await renderApp({ index: HomeScreen, search: Stub, notifications: Stub }, '/');
  expect(await screen.findByText('Hello, Rahul')).toBeOnTheScreen();
  expect(await screen.findByRole('button', { name: 'Hall' })).toBeOnTheScreen();
  expect(await screen.findByText('Beat Box DJ')).toBeOnTheScreen();
  expect(screen.getByText('DJ & Sound · Naini · ★ 4.5')).toBeOnTheScreen();
  expect(screen.getByText(rupees(1_500_000))).toBeOnTheScreen();
  expect(await screen.findByText('2')).toBeOnTheScreen();
});

test('home in Hindi', async () => {
  await setLanguage('hi');
  await renderApp({ index: HomeScreen, search: Stub, notifications: Stub }, '/');
  expect(await screen.findByText('नमस्ते, Rahul')).toBeOnTheScreen();
  expect(screen.getByText('सेवाएँ')).toBeOnTheScreen();
  expect(await screen.findByRole('button', { name: 'हॉल' })).toBeOnTheScreen();
});

test('home shows the offline board when there is no internet', async () => {
  const offline = new ApiError(0, 'NETWORK', 'No internet');
  mockedApi.categories.mockRejectedValue(offline);
  mockedApi.vendors.mockRejectedValue(offline);
  await renderApp({ index: HomeScreen, search: Stub, bookings: Stub }, '/');
  expect(await screen.findByText('No internet', {}, { timeout: 4000 })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
});

test('search: typing a service name picks its category; empty results offer to clear filters', async () => {
  const user = userEvent.setup();
  await renderApp({ search: SearchScreen }, '/search');
  expect(await screen.findByText('Beat Box DJ')).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Search'), 'dj');
  expect(mockedApi.vendors).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'dj' }));

  // Filters are checkboxes and categories are radios, each showing its selected state.
  await user.press(screen.getByRole('checkbox', { name: '★ 4+' }));
  expect(screen.getByRole('checkbox', { name: '★ 4+' })).toBeChecked();
  mockedApi.vendors.mockResolvedValue({ items: [{ ...dj, ratingAvg: 3.2 }], page: 1, hasMore: false });
  await user.press(screen.getByRole('radio', { name: 'Marriage hall' }));
  expect(screen.getByRole('radio', { name: 'Marriage hall' })).toBeSelected();
  expect(await screen.findByText('No vendors found')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Clear all filters' }));
  expect(await screen.findByText('Beat Box DJ')).toBeOnTheScreen();
});

test('chat thread: phone hint until confirmed, polls every 4 s, sends messages', async () => {
  mockedApi.conversations.mockResolvedValue({
    items: [{ id: 'c1', vendorId: 'v9', vendorName: 'Beat Box DJ', customerName: 'Rahul', lastMessage: null, lastMessageAt: null, unreadCount: 0, hasBooking: false }],
  });
  mockedApi.messages.mockResolvedValue({
    items: [{ id: 1, senderId: 'x', body: 'Yes, lights are included.', readAt: null, createdAt: '2026-10-20T10:00:00Z', mine: false }],
    hasMore: false,
    phoneShared: false,
  });
  mockedApi.sendMessage.mockResolvedValue({ id: 2, senderId: 'u1', body: 'Can you come by 7?', readAt: null, createdAt: '2026-10-20T10:01:00Z', mine: true });
  const user = userEvent.setup();
  await renderApp({ 'chat/[id]': ChatThreadScreen }, '/chat/c1?name=Beat%20Box%20DJ');

  expect(await screen.findByText('Yes, lights are included.')).toBeOnTheScreen();
  expect(screen.getByText('Phone number is shared after booking is confirmed. Until then, chat in the app.')).toBeOnTheScreen();
  // Polling: another fetch within ~4 s while the thread is open.
  const calls = mockedApi.messages.mock.calls.length;
  await waitFor(() => expect(mockedApi.messages.mock.calls.length).toBeGreaterThan(calls), { timeout: 6_000 });

  await user.type(screen.getByLabelText('Message'), 'Can you come by 7?');
  await user.press(screen.getByRole('button', { name: 'Send' }));
  expect(mockedApi.sendMessage).toHaveBeenCalledWith('c1', 'Can you come by 7?');
  expect(await screen.findByText('Can you come by 7?')).toBeOnTheScreen();
}, 15_000);

test('tablet home uses the card grid (TabletHome board)', async () => {
  setWindowSize(1194, 834);
  try {
    await renderApp({ index: HomeScreen, search: Stub, notifications: Stub }, '/');
    expect(await screen.findByText(`From ${rupees(1_500_000)}`)).toBeOnTheScreen();
    expect(screen.getByText('★ 4.5 · Naini')).toBeOnTheScreen();
  } finally {
    setWindowSize(390, 844);
  }
});
