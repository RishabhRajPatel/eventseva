const { existsSync } = require('node:fs');
const { join } = require('node:path');

// app.json holds the settings; this adds Firebase only when its file is present, so builds keep
// working (without push) until google-services.json is downloaded from the Firebase console.
/**
 * A store build must talk to the API over HTTPS only: on plain HTTP anyone on the same Wi-Fi could
 * read OTPs and tokens, or change answers. The build stops with a clear message instead.
 */
function checkApiUrl() {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile !== 'production' && profile !== 'preview') return;
  const url = process.env.EXPO_PUBLIC_API_URL ?? '';
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(url)) {
    throw new Error(`EXPO_PUBLIC_API_URL must be an https:// address for ${profile} builds (got "${url}").`);
  }
}

module.exports = ({ config }) => {
  checkApiUrl();
  const hasFirebase = existsSync(join(__dirname, 'google-services.json'));
  return {
    ...config,
    android: {
      ...config.android,
      ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#263BAA', defaultChannel: 'bookings' }],
      // Plays vendor videos on the vendor page.
      'expo-video',
      // Foreground only, on request: never tracked in the background.
      ['expo-location', { locationWhenInUsePermission: 'EventSeva uses your location only when you tap “Use my current location”, to pin your event venue so vendors can find it.', isAndroidBackgroundLocationEnabled: false }],
    ],
  };
};
