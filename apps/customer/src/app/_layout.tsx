import '../i18n';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { Lato_400Regular } from '@expo-google-fonts/lato/400Regular';
import { Lato_700Bold } from '@expo-google-fonts/lato/700Bold';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
import { NotoSerifDevanagari_700Bold } from '@expo-google-fonts/noto-serif-devanagari/700Bold';
import { queryClient } from '../lib/queryClient';
import { SessionProvider, useSession } from '../lib/session';
import { c } from '../lib/theme';
import { Screen } from '../components/Screen';
import { OfflineState } from '../components/States';

// The native splash (royal blue, Splash board) stays up until fonts and the login state are ready.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Lato_400Regular,
    Lato_700Bold,
    PlayfairDisplay_700Bold,
    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_700Bold,
    NotoSerifDevanagari_700Bold,
  });
  // A font that fails to load falls back to the system font; the app still works.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { state, retry } = useSession();
  const ready = state.status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;
  if (state.status === 'unreachable') {
    return (
      <Screen>
        <OfflineState onRetry={retry} />
      </Screen>
    );
  }

  const signedIn = state.status === 'signedIn';
  const hasName = signedIn && !!state.me.name;
  // Where a blocked route sends the user: login when signed out, the name screen for new users, else Home.
  const home = !signedIn ? '/login' : !hasName ? '/welcome' : '/';
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'slide_from_right' }}>
      <Stack.Protected guard={!signedIn} redirectTo={home}>
        <Stack.Screen name="login" />
        <Stack.Screen name="otp" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasName} redirectTo={home}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Protected guard={hasName} redirectTo={home}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vendor/[id]/index" />
        <Stack.Screen name="vendor/[id]/photos" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="vendor/[id]/book" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="pay/[id]" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="event/new" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="saved" />
        <Stack.Screen name="help" />
        <Stack.Screen name="language" />
        <Stack.Screen name="edit-profile" />
      </Stack.Protected>
    </Stack>
  );
}
