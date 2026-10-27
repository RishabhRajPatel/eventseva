// Phone notifications through Firebase Cloud Messaging. The server sends to the device's FCM token,
// which this module registers after login and removes at logout.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { client } from './api';
import { keys, queryClient } from './queryClient';
import { isUuid } from '@eventseva/app-shared';

const TOKEN_KEY = 'eventseva.customer.pushToken';

/** The server picks the channel: chat messages, everything else is a booking update. */
export const CHANNELS = [
  { id: 'bookings', name: 'Bookings and payments' },
  { id: 'chat', name: 'Chat messages' },
] as const;

let handlerSet = false;

// Show pushes while the app is open too, e.g. "vendor accepted, pay now".
function showWhileOpen() {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushSetup = 'registered' | 'denied' | 'unsupported';

/** Asks for permission (Android 13+ shows a prompt) and registers this phone with the API. */
export async function registerForPush(): Promise<PushSetup> {
  // iOS needs APNs set up in Firebase first; Android is the launch platform.
  if (Platform.OS !== 'android') return 'unsupported';
  try {
    for (const ch of CHANNELS) {
      await Notifications.setNotificationChannelAsync(ch.id, { name: ch.name, importance: Notifications.AndroidImportance.HIGH });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    const { data } = await Notifications.getDevicePushTokenAsync();
    await saveToken(String(data));
    return 'registered';
  } catch {
    // No google-services.json in this build, or Play services missing: the app works without pushes.
    return 'unsupported';
  }
}

async function saveToken(token: string) {
  await client.post('/v1/devices', { fcmToken: token, platform: 'android' });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/** Called before logout, while the session can still authorise the call. */
export async function unregisterPush() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await client.delete('/v1/devices', { fcmToken: token }).catch(() => undefined);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

/** Where tapping a notification goes, from the data the server attaches. */
export function routeForPush(data: Record<string, unknown> | undefined): Href {
  // Only real ids become paths: a payload like "../login" must never pick the screen.
  if (isUuid(data?.conversationId)) return `/chat/${data.conversationId}`;
  if (isUuid(data?.bookingId)) return `/booking/${data.bookingId}`;
  return '/notifications';
}

/** Registers after login, opens the right screen on tap, and refreshes lists when a push arrives. */
export function usePush(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    showWhileOpen();
    void registerForPush();
    const open = (r: Notifications.NotificationResponse) => router.push(routeForPush(r.notification.request.content.data));
    // The app may have been opened by tapping a notification.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      open(last);
      Notifications.clearLastNotificationResponse();
    }
    const subs = [
      Notifications.addNotificationResponseReceivedListener(open),
      Notifications.addNotificationReceivedListener(() => {
        void queryClient.invalidateQueries({ queryKey: keys.notifications });
        void queryClient.invalidateQueries({ queryKey: keys.allBookings });
        void queryClient.invalidateQueries({ queryKey: ['booking'] });
        void queryClient.invalidateQueries({ queryKey: keys.events });
        void queryClient.invalidateQueries({ queryKey: keys.conversations });
      }),
      // FCM rotates tokens now and then; keep the server's copy current.
      Notifications.addPushTokenListener((t) => void saveToken(String(t.data)).catch(() => undefined)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [signedIn]);
}
