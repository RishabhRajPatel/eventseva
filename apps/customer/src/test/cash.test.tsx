import { screen } from '@testing-library/react-native';
import { rupees } from '@eventseva/app-shared';
import BookingScreen from '../app/booking/[id]';
import { api } from '../lib/api';
import { booking } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/session', () => ({
  useMe: () => ({ id: 'u1', phone: '+919876543210', name: 'Rahul Verma', language: 'en', cityId: 1 }),
  useSession: () => ({}),
}));

const mockedApi = api as unknown as Record<string, jest.Mock>;

beforeEach(() => jest.clearAllMocks());

describe('cash bookings in the customer app', () => {
  test('a confirmed cash booking shows what to pay the vendor and the cash recorded, with no pay button', async () => {
    mockedApi.booking.mockResolvedValue(booking({ status: 'confirmed', payMode: 'cash', amountPaise: 1_500_000, advancePaise: 375_000 }));
    mockedApi.cash.mockResolvedValue({
      payMode: 'cash', amountPaise: 1_500_000, depositPaise: 0, receivedPaise: 500_000, depositHeldPaise: 0,
      receipts: [{ id: 'r1', kind: 'advance', amountPaise: 500_000, note: null, createdAt: '2026-11-01T10:00:00Z' }],
    });
    await renderApp({ 'booking/[id]': BookingScreen }, '/booking/b1');
    expect(await screen.findByText(`Pay ${rupees(1_500_000)} to the vendor in person, as you agree with them.`)).toBeOnTheScreen();
    expect(screen.getByText('Recorded by the vendor')).toBeOnTheScreen();
    expect(screen.getAllByText(rupees(500_000))).toHaveLength(2); // the total recorded and the one entry
    expect(screen.queryByRole('button', { name: /^Pay / })).toBeNull();
    expect(mockedApi.cash).toHaveBeenCalledWith('b1');
  });

  test('a cash request waiting for the vendor explains how it gets confirmed', async () => {
    mockedApi.booking.mockResolvedValue(booking({ status: 'requested', payMode: 'cash' }));
    await renderApp({ 'booking/[id]': BookingScreen }, '/booking/b1');
    expect(await screen.findByText(/Once the vendor accepts, the booking is confirmed and you pay them in person/)).toBeOnTheScreen();
    expect(mockedApi.cash).not.toHaveBeenCalled();
  });
});
