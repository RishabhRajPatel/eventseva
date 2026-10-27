import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError, type Media } from '@eventseva/app-shared';
import { api } from '../lib/api';
import PhotosScreen from '../app/photos';
import { UNDO_MS } from '../hooks/useMediaActions';
import { renderScreen } from './render';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../hooks/useIsTablet', () => ({ useIsTablet: () => false }));
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));

const get = api.get as jest.Mock;
const del = api.delete as jest.Mock;

const item = (id: string, extra: Partial<Media> = {}): Media =>
  ({ id, publicId: `p/${id}`, type: 'photo', width: 1600, height: 1200, blurhash: null, durationSec: null, isCover: false, coverCrop: null, sortOrder: 0, status: 'approved', rejectReason: null, ...extra }) as Media;

const items = [item('cover', { isCover: true }), item('m2', { status: 'pending' }), item('m3', { status: 'rejected', rejectReason: 'Blurry' }), item('v1', { type: 'video', durationSec: 42 })];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/partner/media') return { items, limits: { photos: 30, videos: 5 } };
    if (path === '/v1/partner/vendor') return { status: 'approved', media: items, services: [], packages: [] };
    throw new ApiError(404, 'NOT_FOUND', path);
  });
  del.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

async function openDelete(id: string) {
  await fireEvent.press(await screen.findByTestId(`more-${id}`));
  await fireEvent.press(screen.getByTestId('delete-media'));
}

describe('photos screen', () => {
  it('shows a review badge on every tile', async () => {
    await renderScreen(<PhotosScreen />);
    expect(await screen.findByTestId('status-m2')).toHaveTextContent('Waiting for review');
    expect(screen.getByTestId('status-cover')).toHaveTextContent('Live');
    expect(screen.getByTestId('status-m3')).toHaveTextContent('Not approved');
    expect(screen.getByText('Blurry')).toBeTruthy();
  });

  it('deletes a photo at once with Undo: no API call when undone', async () => {
    jest.useFakeTimers();
    await renderScreen(<PhotosScreen />);
    await openDelete('m2');
    expect(screen.queryByTestId('media-m2')).toBeNull();
    expect(screen.getByTestId('undo-toast')).toHaveTextContent('Photo deletedUndo');
    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(screen.getByTestId('media-m2')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(UNDO_MS + 100);
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('calls the API only after the 5 s pass without Undo', async () => {
    jest.useFakeTimers();
    await renderScreen(<PhotosScreen />);
    await openDelete('m2');
    await act(async () => {
      jest.advanceTimersByTime(UNDO_MS - 100);
    });
    expect(del).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(del).toHaveBeenCalledWith('/v1/partner/media/m2');
  });

  it('puts the photo back and says why when the delete fails', async () => {
    jest.useFakeTimers();
    del.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'No internet'));
    await renderScreen(<PhotosScreen />);
    await openDelete('m2');
    await act(async () => {
      jest.advanceTimersByTime(UNDO_MS + 10);
    });
    await waitFor(() => expect(screen.getByTestId('media-m2')).toBeTruthy());
    expect(screen.getByTestId('toast')).toHaveTextContent(/Couldn't delete it.*No internet connection/);
  });

  it('asks before deleting the cover photo; Keep does nothing', async () => {
    await renderScreen(<PhotosScreen />);
    await openDelete('cover');
    expect(await screen.findByTestId('confirm-dialog')).toHaveTextContent(/Delete your cover photo\?/);
    expect(screen.getByTestId('confirm-yes')).toHaveTextContent('Delete photo');
    await fireEvent.press(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByTestId('media-cover')).toBeTruthy();
  });

  it('deletes a video after "Delete this video?"', async () => {
    await renderScreen(<PhotosScreen />);
    await openDelete('v1');
    expect(await screen.findByTestId('confirm-dialog')).toHaveTextContent(/^Delete this video\?Customers will no longer see it\./);
    await fireEvent.press(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/partner/media/v1'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('Video deleted');
  });

  it('marks the tile whose menu is open as selected, and opens full screen on tap', async () => {
    await renderScreen(<PhotosScreen />);
    await fireEvent.press(await screen.findByTestId('more-m2'));
    expect(screen.getByTestId('media-m2').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('move-earlier').props.accessibilityState).toMatchObject({ disabled: false });
  });
});
