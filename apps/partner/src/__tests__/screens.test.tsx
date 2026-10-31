import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { PartnerDashboard } from '@eventseva/app-shared';
import { ApiError } from '@eventseva/app-shared';
import { api } from '../lib/api';
import Home from '../app/(tabs)/home';
import Bookings from '../app/(tabs)/bookings';
import { booking } from './fixtures';
import { renderScreen } from './render';
import { router } from './routerMock';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
// Phone layout (the jest window is tablet-wide).
jest.mock('../hooks/useIsTablet', () => ({ useIsTablet: () => false }));
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const dashboard: PartnerDashboard = {
  month: '2026-11',
  status: 'approved',
  ratingAvg: 4.6,
  ratingCount: 12,
  newRequests: 2,
  awaitingPayment: 1,
  overdueReturns: 0,
  monthBookings: 7,
  monthEarningsPaise: 4_500_000,
  pendingPayoutPaise: 320_000,
  unreadChats: 3,
  upcoming: [{ id: 'u1', day: '2026-11-20', slot: 'night', status: 'confirmed', eventTitle: "Rahul's Wedding", itemTitle: 'DJ night' }],
};

const vendor = { businessName: 'Raj DJ Sound', status: 'approved', media: [], services: [], packages: [] };

function routeApi(routes: Record<string, unknown>) {
  get.mockImplementation(async (path: string, query?: { status?: string }) => {
    const key = query?.status ? `${path}?status=${query.status}` : path;
    if (key in routes) {
      const value = routes[key];
      if (value instanceof Error) throw value;
      return value;
    }
    throw new ApiError(404, 'NOT_FOUND', `no mock for ${key}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Home (Aaj)', () => {
  it('shows this month, requests, payout, rating and upcoming bookings', async () => {
    routeApi({
      '/v1/partner/dashboard': dashboard,
      '/v1/partner/vendor': vendor,
      '/v1/notifications': { items: [], hasMore: false, unreadCount: 4 },
      '/v1/partner/bookings?status=requested': { items: [booking('r1', 'requested', { respondBy: inHours(18) })] },
    });

    await renderScreen(<Home />);
    expect(await screen.findByText('Raj DJ Sound')).toBeTruthy();
    expect(screen.getByText('₹45,000')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('₹3,200')).toBeTruthy();
    expect(screen.getByText('4.6 (12)')).toBeTruthy();
    expect(screen.getByText("Rahul's Wedding")).toBeTruthy();
    expect(await screen.findByText('Event r1')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tile-new'));
    expect(router.navigate).toHaveBeenCalledWith('/bookings');
    await fireEvent.press(screen.getByTestId('upcoming-u1'));
    expect(router.push).toHaveBeenCalledWith('/booking/u1');
  });

  it('shows the offline state with Try again when there is no internet', async () => {
    routeApi({ '/v1/partner/dashboard': new ApiError(0, 'NETWORK', 'No internet') });
    await renderScreen(<Home />);
    expect(await screen.findByTestId('offline')).toBeTruthy();
    expect(screen.getByText('No internet')).toBeTruthy();
    routeApi({ '/v1/partner/dashboard': dashboard, '/v1/partner/vendor': vendor, '/v1/notifications': { items: [], hasMore: false, unreadCount: 0 } });
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('₹45,000')).toBeTruthy();
  });
});

describe('Bookings tab', () => {
  const items = [
    booking('r1', 'requested', { respondBy: inHours(18.5), note: 'Baraat leaves at 7:30' }),
    booking('a1', 'accepted', { payBy: inHours(10) }),
    booking('c1', 'confirmed', { customer: { name: 'Priya', phone: '+919876543210' } }),
    booking('x1', 'expired'),
  ];

  beforeEach(() => {
    get.mockImplementation(async (path: string) => {
      if (path === '/v1/partner/bookings') return { items };
      throw new ApiError(404, 'NOT_FOUND', path);
    });
  });

  it('groups bookings into the four segments with counts and a countdown', async () => {
    await renderScreen(<Bookings />);
    expect(await screen.findByText('Event r1')).toBeTruthy();
    expect(screen.getByText('New (1)')).toBeTruthy();
    expect(screen.getByText('Waiting for payment (1)')).toBeTruthy();
    expect(screen.getByText('Upcoming (1)')).toBeTruthy();
    expect(screen.getByText(/^18h (29|30)m left$/)).toBeTruthy();
    expect(screen.getByText('“Baraat leaves at 7:30”')).toBeTruthy();
    // What the vendor earns, labelled kindly.
    expect(screen.getByText('You receive from EventSeva')).toBeTruthy();
    expect(screen.getByText('₹7,500')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('segment-past'));
    expect(screen.getByText('Event x1')).toBeTruthy();
    expect(screen.queryByText('Event r1')).toBeNull();
  });

  it('accepts a request and explains SLOT_TAKEN in a toast', async () => {
    post.mockRejectedValueOnce(new ApiError(409, 'SLOT_TAKEN', 'The vendor is not free at this time.'));
    await renderScreen(<Bookings />);
    const card = await screen.findByTestId('booking-r1');
    await fireEvent.press(within(card).getByTestId('accept'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/r1/accept'));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/already booked or blocked/);
  });

  it('accepting shows the busy button, then the success toast; a double tap sends once', async () => {
    let resolve!: (b: unknown) => void;
    post.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await renderScreen(<Bookings />);
    const card = await screen.findByTestId('booking-r1');
    const accept = within(card).getByTestId('accept');
    await fireEvent.press(accept);
    await fireEvent.press(accept);
    expect(post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(card).getByTestId('accept').props.accessibilityState).toMatchObject({ busy: true, disabled: true }));
    expect(within(card).getByText('Accepting…')).toBeTruthy();
    expect(within(card).getByTestId('decline').props.accessibilityState).toMatchObject({ disabled: true });
    resolve(booking('r1', 'accepted'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('Request accepted, the customer has 24 h to pay.');
  });

  it('declining needs a reason; a quick pick is sent to the API', async () => {
    post.mockResolvedValueOnce(booking('r1', 'rejected'));
    await renderScreen(<Bookings />);
    const card = await screen.findByTestId('booking-r1');
    await fireEvent.press(within(card).getByTestId('decline'));
    await fireEvent.press(screen.getByTestId('reason-confirm'));
    expect(screen.getByText('Pick a reason or write one (at least 3 letters).')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    // The picked reason shows as selected (✓, lilac, royal border).
    await fireEvent.press(screen.getByText('Already booked that day'));
    expect(screen.getByTestId('reason-0').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('reason-1').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/r1/reject', { reason: 'Already booked that day' }));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/Request declined/);
  });
});
