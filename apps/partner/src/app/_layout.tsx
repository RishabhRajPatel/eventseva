import '../i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
// Per-weight imports, so only these six font files go into the app.
import { Lato_400Regular } from '@expo-google-fonts/lato/400Regular';
import { Lato_700Bold } from '@expo-google-fonts/lato/700Bold';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSerifDevanagari_700Bold } from '@expo-google-fonts/noto-serif-devanagari/700Bold';
import { ApiError } from '@eventseva/app-shared';
import { SessionProvider, useSession } from '../lib/session';
import { usePush } from '../lib/push';
import { offlineStore, reportResult } from '../lib/network';
import { useStore } from '../lib/store';
import { c } from '../lib/theme';
import { ConfirmHost } from '../components/ConfirmDialog';
import { OfflineBanner } from '../components/OfflineBanner';
import { Offline } from '../components/States';
import { ToastHost } from '../components/Toast';
import { UploadWatcher } from '../components/UploadWatcher';

void SplashScreen.preventAutoHideAsync();

/** While offline, quietly try again this often (there is no netinfo to tell us when the phone is back). */
const OFFLINE_RETRY_MS = 15_000;

function makeQueryClient() {
  return new QueryClient({
    // Every request tells the offline banner whether the internet works.
    queryCache: new QueryCache({ onError: (e) => reportResult(e), onSuccess: () => reportResult(null) }),
    mutationCache: new MutationCache({ onError: (e) => reportResult(e), onSuccess: () => reportResult(null) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Client errors (404, 409 …) will not fix themselves; only retry network trouble and 5xx.
        retry: (count, e) => count < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
      },
    },
  });
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  const [fontsLoaded, fontError] = useFonts({
    Lato_400Regular,
    Lato_700Bold,
    PlayfairDisplay_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_700Bold,
    NotoSerifDevanagari_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <WithOfflineBanner>
            <AppStack />
          </WithOfflineBanner>
          <UploadWatcher />
          <ToastHost />
          <ConfirmHost />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** "No internet. Showing saved data." on top of every screen while requests fail with NETWORK. */
function WithOfflineBanner({ children }: { children: ReactNode }) {
  const offline = useStore(offlineStore);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  useEffect(() => {
    if (!offline) return;
    const retry = () => void qc.refetchQueries({ type: 'active' });
    const id = setInterval(retry, OFFLINE_RETRY_MS);
    // Coming back to the app is a good moment to check again.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && retry());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [offline, qc]);

  if (!offline) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: c.peach }}>
      <OfflineBanner topInset={insets.top} onRetry={() => void qc.refetchQueries({ type: 'active' })} />
      {/* The banner already covers the status bar, so the screens below start at 0. */}
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={{ flex: 1 }}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

function AppStack() {
  const { state, retry } = useSession();
  const ready = state.status !== 'loading';
  usePush(state.status === 'signedIn');
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;
  if (state.status === 'offline') return <Offline onRetry={retry} />;
  const signedIn = state.status === 'signedIn';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.cream } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="otp" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="name" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/services" />
        <Stack.Screen name="onboarding/submit" />
        <Stack.Screen name="pending" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="earnings" />
        <Stack.Screen name="featured" />
        <Stack.Screen name="service/[id]" />
        <Stack.Screen name="package/[id]" />
        <Stack.Screen name="inventory/index" />
        <Stack.Screen name="inventory/[id]" />
        <Stack.Screen name="rental-settings" />
        <Stack.Screen name="engine/index" />
        <Stack.Screen name="engine/service/[id]" />
        <Stack.Screen name="engine/resource/[id]" />
        <Stack.Screen name="engine/addon/[id]" />
        <Stack.Screen name="engine/bundle/[id]" />
        <Stack.Screen name="invoice/[id]" />
        <Stack.Screen name="business" />
        <Stack.Screen name="photos" />
        <Stack.Screen name="documents" />
        <Stack.Screen name="bank" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="language" />
        <Stack.Screen name="reviews" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="help" />
      </Stack.Protected>
    </Stack>
  );
}
