import { createApiClient } from '@eventseva/app-shared';
import { API_URL } from './config';
import { secureTokenStore } from './tokens';
import { currentLanguage } from '../i18n';

type Listener = () => void;
const sessionEndedListeners = new Set<Listener>();

/** The session provider subscribes here to send the user back to the login screen. */
export function onSessionEnded(listener: Listener) {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

export const api = createApiClient({
  baseUrl: API_URL,
  tokens: secureTokenStore,
  getLanguage: currentLanguage,
  onSessionEnded: () => sessionEndedListeners.forEach((l) => l()),
});
