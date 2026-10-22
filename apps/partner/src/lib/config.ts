import { Platform } from 'react-native';

// Android emulators reach the host machine at 10.0.2.2; everything else uses localhost.
const defaultApiUrl = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL || defaultApiUrl;

/** Empty until the owner sets up Cloudinary; screens then show placeholders instead of photos. */
export const CLOUDINARY_CLOUD_NAME: string = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
