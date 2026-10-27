import { fireEvent, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../lib/api';
import ChatThread from '../app/chat/[id]';
import { renderScreen } from './render';
import { router } from './routerMock';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));
const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

test('booking updates are centred lines that open the booking; quick replies fill the box without sending', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'c1' });
  get.mockImplementation(async (path: string) =>
    path === '/v1/conversations'
      ? { items: [{ id: 'c1', vendorId: 'v1', vendorName: 'Raj DJ', customerName: 'Rahul', lastMessage: null, lastKind: null, lastData: null, lastMessageAt: null, unreadCount: 0, hasBooking: true }] }
      : {
          items: [
            { id: 2, senderId: 'cust', kind: 'booking', data: { event: 'venue_updated', bookingId: B }, body: 'Venue details updated', readAt: null, createdAt: '2026-10-20T10:05:00Z', mine: false },
            { id: 1, senderId: 'cust', kind: 'text', data: null, body: 'Hello!', readAt: null, createdAt: '2026-10-20T10:00:00Z', mine: false },
          ],
          hasMore: false,
          phoneShared: true,
        },
  );
  await renderScreen(<ChatThread />);
  expect(await screen.findByText('The customer updated the venue details')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('booking-line-venue_updated').children[0] as never);
  expect(router.push).toHaveBeenCalledWith(`/booking/${B}`);

  await fireEvent.press(screen.getByTestId('quick-r2'));
  expect(screen.getByTestId('message-input').props.value).toBe('Please share the exact venue location.');
  expect(post).not.toHaveBeenCalled();
});
