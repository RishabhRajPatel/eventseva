import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { VideoModal, VideoTiles, duration } from '../components/VideoPlayer';
import '../i18n';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderWithProviders = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

jest.mock('../lib/config', () => ({ ...jest.requireActual('../lib/config'), CLOUD_NAME: 'demo' }));

const video = {
  id: 'v1', type: 'video' as const, publicId: 'vendors/v/1', width: 1280, height: 720, blurhash: null,
  durationSec: 65, isCover: false, coverCrop: null, sortOrder: 0,
};

describe('vendor videos', () => {
  it('shows a poster tile with the length and opens the player on tap', async () => {
    const onOpen = jest.fn();
    await renderWithProviders(<VideoTiles videos={[video]} onOpen={onOpen} />);
    expect(screen.getByText('1:05')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Play video 1 of 1'));
    expect(onOpen).toHaveBeenCalledWith(video);
  });

  it('streams the video from Cloudinary and starts playing', async () => {
    await renderWithProviders(<VideoModal media={video} onClose={jest.fn()} />);
    const view = screen.getByTestId('video-view');
    expect(view.props.player.source).toBe('https://res.cloudinary.com/demo/video/upload/sp_auto/vendors/v/1.m3u8');
    expect(view.props.player.play).toHaveBeenCalled();
    expect(view.props.player.loop).toBe(false);
  });

  it('formats lengths', () => {
    expect(duration(5)).toBe('0:05');
    expect(duration(120)).toBe('2:00');
  });
});
