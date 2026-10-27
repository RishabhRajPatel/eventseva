import { Linking } from 'react-native';
import { isSafeExternalUrl } from '@eventseva/app-shared';

/**
 * Opens a phone call, Google Maps or our Play Store page. Anything else (a link a server field or a
 * push could carry) is refused, so nobody can make the app open a phishing page or another app.
 */
export function openLink(url: string): Promise<boolean> {
  if (!isSafeExternalUrl(url)) return Promise.resolve(false);
  return Linking.openURL(url).then(
    () => true,
    () => false,
  );
}
