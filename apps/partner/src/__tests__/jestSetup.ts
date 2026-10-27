// Runs after the test framework: leave no toast, dialog or upload behind between tests.
// Everything is required lazily, so a test file's own jest.mock (haptics, image manipulator…) still applies.
import { act } from '@testing-library/react-native';

afterEach(async () => {
  await act(async () => {
    (require('../lib/toast') as typeof import('../lib/toast')).hideToast();
    (require('../lib/confirm') as typeof import('../lib/confirm')).answerConfirm(false);
    (require('../lib/network') as typeof import('../lib/network')).offlineStore.set(false);
    (require('../lib/uploadQueue') as typeof import('../lib/uploadQueue')).mediaUploads.clear();
  });
});

// expo-video is native-only: a stand-in player that records what it was asked to do.
jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (p: object) => void) => {
      const player = { source, loop: true, play: jest.fn(), pause: jest.fn() };
      setup?.(player);
      return player;
    },
    VideoView: (props: object) => require('react').createElement(View, props),
  };
});
