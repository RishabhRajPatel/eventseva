import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import RootLayout from '../app/_layout';
import TabsLayout from '../app/(tabs)/_layout';
import type { SessionState } from '../lib/session';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
// Push setup needs a phone; routing is what these tests check.
jest.mock('../lib/push', () => ({ usePush: jest.fn(), unregisterPush: jest.fn() }));
let mockState: SessionState = { status: 'signedOut' };
jest.mock('../lib/session', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({ state: mockState, retry: jest.fn() }),
}));

const page = (label: string) => () => <Text>{label}</Text>;
const routes = {
  _layout: RootLayout,
  login: page('LOGIN'),
  otp: page('OTP'),
  welcome: page('WELCOME'),
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': page('HOME'),
  '(tabs)/bookings': page('EVENTS'),
  '(tabs)/chat': page('CHATS'),
  '(tabs)/profile': page('PROFILE'),
  '(tabs)/search': page('SEARCH'),
  ...Object.fromEntries(
    ['vendor/[id]/index', 'vendor/[id]/photos', 'vendor/[id]/book', 'booking/[id]', 'pay/[id]', 'chat/[id]', 'event/new', 'notifications', 'saved', 'help', 'language', 'edit-profile'].map(
      (r) => [r, page(r)],
    ),
  ),
};
const me = { id: 'u1', phone: '+919876543210', language: 'en' as const, cityId: 1 };

test('signed out: the app opens on the login screen', async () => {
  mockState = { status: 'signedOut' };
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('LOGIN')).toBeOnTheScreen();
});

test('new user without a name: the name screen', async () => {
  mockState = { status: 'signedIn', me: { ...me, name: null } };
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('WELCOME')).toBeOnTheScreen();
});

test('signed in: Home with the four tabs from the board', async () => {
  mockState = { status: 'signedIn', me: { ...me, name: 'Rahul' } };
  await renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('HOME')).toBeOnTheScreen();
  for (const tab of ['Home', 'My Events', 'Chat', 'Profile']) expect(screen.getByRole('tab', { name: tab })).toBeOnTheScreen();
  expect(screen.queryByRole('tab', { name: /search/i })).not.toBeOnTheScreen();
});

test('signed in users cannot open the login screen', async () => {
  mockState = { status: 'signedIn', me: { ...me, name: 'Rahul' } };
  await renderRouter(routes, { initialUrl: '/login' });
  expect(await screen.findByText('HOME')).toBeOnTheScreen();
  expect(screen.queryByText('LOGIN')).not.toBeOnTheScreen();
});
