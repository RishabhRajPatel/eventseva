import { Platform } from 'react-native';

// Expo inlines EXPO_PUBLIC_* at build time, so each one must be read with its full name.
const envApiUrl = process.env.EXPO_PUBLIC_API_URL;
const envCloud = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;

/** The Android emulator reaches the host computer at 10.0.2.2. */
export const API_URL = envApiUrl || (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

/** Empty when not configured: screens then show category placeholders instead of photos. */
export const CLOUD_NAME = envCloud || '';

export const CITY = { id: 1, name: 'Prayagraj' } as const;

/** The vendor app ("Are you a vendor?" links). */
export const PARTNER_APP_URL = 'https://play.google.com/store/search?q=EventSeva%20Partner&c=apps';

/** How often an open chat checks for new messages. */
export const CHAT_POLL_MS = 4_000;
