const { existsSync } = require('node:fs');
const { join } = require('node:path');

// app.json holds the settings; this adds Firebase only when its file is present, so builds keep
// working (without push) until google-services.json is downloaded from the Firebase console.
module.exports = ({ config }) => {
  const hasFirebase = existsSync(join(__dirname, 'google-services.json'));
  return {
    ...config,
    android: {
      ...config.android,
      ...(hasFirebase ? { googleServicesFile: './google-services.json' } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-notifications', { icon: './assets/notification-icon.png', color: '#312E81', defaultChannel: 'bookings' }],
    ],
  };
};
