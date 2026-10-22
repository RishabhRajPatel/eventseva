import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api';
import { registerForPush, routeForPush, unregisterPush } from '../lib/push';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(async () => undefined), patch: jest.fn(), put: jest.fn(), delete: jest.fn(async () => undefined) },
  onSessionEnded: jest.fn(),
}));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token-123' })),
  AndroidImportance: { HIGH: 5 },
}));

const n = Notifications as unknown as Record<string, jest.Mock>;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
});

test('tapping a notification opens the chat, the booking, or the list', () => {
  expect(routeForPush({ kind: 'chat_message', conversationId: 'c1' })).toBe('/chat/c1');
  expect(routeForPush({ kind: 'booking_requested', bookingId: 'b1' })).toBe('/booking/b1');
  expect(routeForPush({ kind: 'vendor_approved', vendorId: 'v1' })).toBe('/notifications');
  expect(routeForPush(undefined)).toBe('/notifications');
});

test('asks once, registers the FCM token with the API, and creates both channels', async () => {
  n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  n.requestPermissionsAsync.mockResolvedValue({ granted: true });
  expect(await registerForPush()).toBe('registered');
  expect(n.setNotificationChannelAsync.mock.calls.map((c) => c[0])).toEqual(['bookings', 'chat']);
  expect(post).toHaveBeenCalledWith('/v1/devices', { fcmToken: 'fcm-token-123', platform: 'android' });

  await unregisterPush();
  expect(del).toHaveBeenCalledWith('/v1/devices', { fcmToken: 'fcm-token-123' });
  expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});

test('denied permission or no Firebase config: nothing registered, app keeps working', async () => {
  n.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  expect(await registerForPush()).toBe('denied');
  n.getPermissionsAsync.mockResolvedValue({ granted: true });
  n.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('Default FirebaseApp is not initialized'));
  expect(await registerForPush()).toBe('unsupported');
  Platform.OS = 'ios';
  expect(await registerForPush()).toBe('unsupported');
  expect(post).not.toHaveBeenCalled();
});
