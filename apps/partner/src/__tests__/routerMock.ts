// Shared jest mock for expo-router: navigation calls are recorded, focus effects run once.
import { useEffect } from 'react';

export const router = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

export const expoRouterMock = {
  router,
  useRouter: () => router,
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  useIsFocused: () => true,
  Redirect: ({ href }: { href: string }) => {
    router.replace(href);
    return null;
  },
};
