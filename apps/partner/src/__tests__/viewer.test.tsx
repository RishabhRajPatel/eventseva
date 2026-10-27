import { fireEvent, screen } from '@testing-library/react-native';
import type { Media } from '@eventseva/app-shared';
import { MediaViewer } from '../components/MediaViewer';
import { renderScreen } from './render';

jest.mock('../lib/config', () => ({ ...jest.requireActual('../lib/config'), CLOUDINARY_CLOUD_NAME: 'demo' }));

const video: Media = {
  id: 'v1', type: 'video', publicId: 'vendors/v/1', width: 1280, height: 720, blurhash: null,
  durationSec: 42, isCover: false, coverCrop: null, sortOrder: 0, status: 'pending',
};
const photo: Media = { ...video, id: 'p1', type: 'photo', durationSec: null, publicId: 'vendors/v/p1' };

describe('media viewer', () => {
  it('plays a video only after play is tapped, from the adaptive stream', async () => {
    await renderScreen(<MediaViewer media={video} list={[video]} onChange={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('viewer-video')).toBeNull();
    await fireEvent.press(screen.getByTestId('viewer-play'));
    const player = screen.getByTestId('viewer-video').props.player;
    expect(player.source).toBe('https://res.cloudinary.com/demo/video/upload/sp_auto/vendors/v/1.m3u8');
    expect(player.play).toHaveBeenCalled();
  });

  it('photos have no play button', async () => {
    await renderScreen(<MediaViewer media={photo} list={[photo]} onChange={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('viewer-play')).toBeNull();
  });
});
