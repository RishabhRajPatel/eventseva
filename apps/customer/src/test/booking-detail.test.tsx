import { screen, userEvent } from '@testing-library/react-native';
import { rupees } from '@eventseva/app-shared';
import BookingScreen from '../app/booking/[id]';
import { api } from '../lib/api';
import { booking, inDays } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());

const mockedApi = api as unknown as Record<string, jest.Mock>;
const Stub = () => null;
const open = () => renderApp({ 'booking/[id]': BookingScreen, 'pay/[id]': Stub, 'chat/[id]': Stub, help: Stub, search: Stub }, '/booking/b1');

beforeEach(() => jest.clearAllMocks());

test('requested: waiting for the vendor with a countdown, cancel allowed, no phone', async () => {
  mockedApi.booking.mockResolvedValue(booking());
  await open();
  expect(await screen.findByText('Waiting for vendor')).toBeOnTheScreen();
  expect(screen.getByText(/The vendor has 5h (19|20)m left to reply/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Cancel booking' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Call vendor' })).not.toBeOnTheScreen();
});

test('accepted: pay the advance before payBy', async () => {
  mockedApi.booking.mockResolvedValue(booking({ status: 'accepted', payBy: new Date(Date.now() + 3 * 3600_000 + 90_000).toISOString() }));
  const user = userEvent.setup();
  const router = await open();
  expect(await screen.findByText(`Pay advance ${rupees(3_375_000)}`)).toBeOnTheScreen();
  expect(screen.getByText(/Pay within 3h (0|1)m to confirm/)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: `Pay ${rupees(3_375_000)}` }));
  expect(router.getPathname()).toBe('/pay/b1');
});

test('confirmed: vendor phone and Call; cancelling shows the refund estimate first', async () => {
  mockedApi.booking.mockResolvedValue(booking({ status: 'confirmed', day: inDays(20), vendor: { id: 'v1', businessName: 'Shree Ram Caterers', categorySlug: 'catering', phone: '+919876543210' } }));
  mockedApi.cancelBooking.mockResolvedValue(booking({ status: 'cancelled_by_customer', refundPaise: 3_037_500 }));
  const user = userEvent.setup();
  await open();
  expect((await screen.findAllByText('Confirmed')).length).toBe(2); // status pill and status box
  expect(screen.getByText("Vendor's phone: +91 98765 43210")).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Call vendor' })).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Cancel booking' }));
  // 20 days before the event: 90% of ₹33,750
  expect(await screen.findByText(`You will get about ${rupees(3_037_500)} back (90% of the advance).`)).toBeOnTheScreen();
  const confirm = screen.getByRole('button', { name: 'Yes, cancel booking' });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByLabelText('Why are you cancelling?'), 'Dates changed');
  await user.press(confirm);
  expect(mockedApi.cancelBooking).toHaveBeenCalledWith('b1', 'Dates changed');
  expect(await screen.findByText('You cancelled this booking')).toBeOnTheScreen();
  expect(screen.getByText(`${rupees(3_037_500)} will be refunded to you.`)).toBeOnTheScreen();
});

test('completed: write a review', async () => {
  mockedApi.booking.mockResolvedValue(booking({ status: 'completed', day: inDays(-2) }));
  mockedApi.review.mockResolvedValue({});
  const user = userEvent.setup();
  await open();
  await user.press(await screen.findByRole('button', { name: 'Write a review' }));
  await user.press(screen.getByRole('radio', { name: '4 stars' }));
  await user.press(screen.getByRole('button', { name: 'Submit review' }));
  expect(mockedApi.review).toHaveBeenCalledWith('b1', 4, undefined);
  expect(await screen.findByText('Thank you for your review!')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeOnTheScreen();
});

test('rejected: shows the reason and offers another vendor', async () => {
  mockedApi.booking.mockResolvedValue(booking({ status: 'rejected', cancelReason: 'Already booked that night' }));
  await open();
  const box = await screen.findByText('The vendor said no');
  expect(box).toBeOnTheScreen();
  expect(screen.getByText('Reason: Already booked that night')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Book another vendor' })).toBeOnTheScreen();
});

test('chat opens the existing conversation without creating one; guests and venue are shown', async () => {
  mockedApi.booking.mockResolvedValue(booking({ conversationId: 'c7' }));
  const user = userEvent.setup();
  const router = await open();
  expect(await screen.findByText('300 guests')).toBeOnTheScreen();
  expect(screen.getByText('Civil Lines')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Chat with vendor' }));
  expect(router.getPathname()).toBe('/chat/c7');
  expect(mockedApi.startChat).not.toHaveBeenCalled();
});

test('chat without a conversation starts one for the vendor', async () => {
  mockedApi.booking.mockResolvedValue(booking());
  mockedApi.startChat.mockResolvedValue({ id: 'c9' });
  const user = userEvent.setup();
  const router = await open();
  await user.press(await screen.findByRole('button', { name: 'Chat with vendor' }));
  expect(mockedApi.startChat).toHaveBeenCalledWith('v1');
  expect(router.getPathname()).toBe('/chat/c9');
});
