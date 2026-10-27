// Tests run at phone size (390×844) unless a test sets another size with setWindowSize().
const size = { width: 390, height: 844, scale: 2, fontScale: 1 };

export function setWindowSize(width: number, height: number) {
  size.width = width;
  size.height = height;
}

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...size }),
}));

// FlashList measures its container natively; give it a phone-sized window in tests.
require('@shopify/flash-list/jestSetup');

// expo-video is native-only: a stand-in player that records what it was asked to do.
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (p: object) => void) => {
      const player = { source, loop: true, play: jest.fn(), pause: jest.fn() };
      setup?.(player);
      return player;
    },
    VideoView: (props: object) => require('react').createElement(View, { ...props, testID: 'video-view' }),
  };
});
