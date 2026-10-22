import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { rupees } from '@eventseva/app-shared';
import BookingFormScreen from '../app/vendor/[id]/book';
import { api } from '../lib/api';
import { booking, event, vendor } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());

const mockedApi = api as unknown as Record<string, jest.Mock>;
const BookingStub = () => null;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.vendor.mockResolvedValue(vendor);
  mockedApi.events.mockResolvedValue({ items: [event] });
  mockedApi.availability.mockResolvedValue({ month: '', busy: [] });
});

function open(item: string) {
  return renderApp({ 'vendor/[id]/book': BookingFormScreen, 'booking/[id]': BookingStub }, `/vendor/v1/book?item=${item}`);
}

test('per-plate service: estimate appears only after a quantity, then the request is sent without any amount', async () => {
  mockedApi.createBooking.mockResolvedValue(booking());
  const user = userEvent.setup();
  const router = await open('service:s1');

  expect(await screen.findByText('Booking details')).toBeOnTheScreen();
  expect(screen.getByText('No payment now. The vendor will reply within 24 hours.')).toBeOnTheScreen();
  expect(screen.getByText('Enter how many to see an estimate.')).toBeOnTheScreen();
  // The existing upcoming event is picked by default.
  expect(screen.getByRole('radio', { name: /Rahul's Wedding/, checked: true })).toBeOnTheScreen();

  await user.type(screen.getByLabelText('Number of plates'), '300');
  expect(await screen.findByText(rupees(13_500_000))).toBeOnTheScreen(); // ₹450 × 300
  expect(screen.getByText(rupees(3_375_000))).toBeOnTheScreen(); // 25% advance
  expect(screen.getByText(rupees(10_125_000))).toBeOnTheScreen(); // balance

  await user.press(screen.getByRole('radio', { name: /Night/ }));
  await user.press(screen.getByRole('button', { name: 'Send request' }));

  await waitFor(() => expect(mockedApi.createBooking).toHaveBeenCalledTimes(1));
  const body = mockedApi.createBooking.mock.calls[0][0];
  expect(body).toEqual({ eventId: 'e1', vendorId: 'v1', serviceId: 's1', slot: 'night', quantity: 300, note: undefined });
  expect(Object.keys(body).some((k) => /amount|paise|price/i.test(k))).toBe(false);
  await waitFor(() => expect(router.getPathname()).toBe('/booking/b1'));
});

test('a counted unit cannot be sent without a quantity', async () => {
  const user = userEvent.setup();
  await open('service:s1');
  await user.press(await screen.findByRole('button', { name: 'Send request' }));
  expect(await screen.findByText('Please enter how many you need.')).toBeOnTheScreen();
  expect(mockedApi.createBooking).not.toHaveBeenCalled();
});

test('a fixed-price package shows its estimate at once and sends no quantity', async () => {
  mockedApi.createBooking.mockResolvedValue(booking({ id: 'b2' }));
  const user = userEvent.setup();
  await open('package:p1');
  expect((await screen.findAllByText(rupees(2_500_000))).length).toBeGreaterThan(1); // price and estimate
  expect(screen.queryByLabelText('Number of plates')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Send request' }));
  await waitFor(() => expect(mockedApi.createBooking).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'p1', quantity: undefined, slot: 'full' })));
});

test('slots the vendor is already booked for are disabled', async () => {
  mockedApi.availability.mockResolvedValue({ month: '', busy: [{ day: event.eventDate, slot: 'night' }] });
  await open('package:p1');
  expect(await screen.findByRole('radio', { name: /Night, Booked/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Full day, Booked/ })).toBeDisabled();
  expect(screen.getByRole('radio', { name: /Day, 10–4/ })).toBeEnabled();
});
