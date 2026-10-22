import '../i18n';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { c } from '../lib/theme';
import { Offline } from '../components/States';

void SplashScreen.preventAutoHideAsync();

function makeQueryClient() {
  return new QueryClient({
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
          <AppStack />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
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
