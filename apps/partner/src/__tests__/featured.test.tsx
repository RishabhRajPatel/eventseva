import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, type FeaturedOverview, type PartnerDashboard } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { buyFeatured, choosePaymentPath } from '../lib/payments';
import FeaturedScreen from '../app/featured';
import Home from '../app/(tabs)/home';
import { MoneyBreakdown } from '../components/MoneyBreakdown';
import { booking } from './fixtures';
import { renderScreen } from './render';
import { router } from './routerMock';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../hooks/useIsTablet', () => ({ useIsTablet: () => false }));
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));
jest.mock('react-native-razorpay', () => ({ __esModule: true, default: { open: jest.fn() } }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const razorpay = (jest.requireMock('react-native-razorpay') as { default: { open: jest.Mock } }).default;

const plans = [
  { id: 1, name: 'One week', days: 7, pricePaise: 49_900 },
  { id: 2, name: 'One month', days: 30, pricePaise: 149_900 },
];

const notFeatured: FeaturedOverview = {
  featuredUntil: null,
  canBuy: true,
  plans,
  history: [
    { id: 'p1', days: 7, amountPaise: 49_900, status: 'paid', startsAt: '2026-09-01T06:00:00Z', endsAt: '2026-09-08T06:00:00Z', createdAt: '2026-09-01T06:00:00Z' },
    { id: 'p2', days: 3, amountPaise: 0, status: 'granted', startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-04T06:00:00Z', createdAt: '2026-10-01T06:00:00Z' },
  ],
};
const featured: FeaturedOverview = { ...notFeatured, featuredUntil: '2026-11-21T06:00:00Z' };

function mockGet(overview: FeaturedOverview | (() => FeaturedOverview), extra: Record<string, unknown> = {}) {
  get.mockImplementation(async (path: string) => {
    if (path === '/v1/partner/featured') return typeof overview === 'function' ? overview() : overview;
    if (path === '/v1/partner/vendor') return { businessName: 'Raj DJ Sound', status: 'approved', media: [], services: [], packages: [], featuredUntil: null };
    if (path in extra) return extra[path];
    throw new ApiError(404, 'NOT_FOUND', `no mock for ${path}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Get featured screen', () => {
  it('shows the plans with price per day, the status and the purchase history', async () => {
    mockGet(notFeatured);
    await renderScreen(<FeaturedScreen />);
    expect(await screen.findByText('Not featured')).toBeTruthy();
    expect(screen.getByText('Show at the top of search with a Featured badge')).toBeTruthy();
    expect(screen.getByText('One week')).toBeTruthy();
    expect(screen.getByTestId('plan-1')).toHaveTextContent(/₹499/);
    expect(screen.getByText('₹71/day')).toBeTruthy();
    expect(screen.getByTestId('plan-2')).toHaveTextContent(/₹1,499/);
    expect(screen.getByText('₹50/day')).toBeTruthy();
    expect(screen.getByText('30 days')).toBeTruthy();
    expect(screen.getByText('Days add on top of your current featured period.')).toBeTruthy();
    // History: one paid, one free from EventSeva.
    expect(screen.getByTestId('purchase-p1')).toBeTruthy();
    expect(screen.getByText('Free from EventSeva')).toBeTruthy();
    expect(screen.getByText('3 days')).toBeTruthy();
    // The longest plan is chosen to start with; Jest has no Razorpay native module, so the labelled test button is used.
    expect(screen.getByTestId('plan-2').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('buy')).toHaveTextContent('Test payment for 30 days (development)');
    await fireEvent.press(screen.getByTestId('plan-1'));
    expect(screen.getByTestId('plan-1').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('plan-2').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByTestId('buy')).toHaveTextContent('Test payment for 7 days (development)');
  });

  it('shows the current featured end date', async () => {
    mockGet(featured);
    await renderScreen(<FeaturedScreen />);
    expect(await screen.findByText('Featured until 21 Nov 2026')).toBeTruthy();
  });

  it('buys a plan in dev mode: order, then dev pay, then refresh with a success message', async () => {
    let current = notFeatured;
    mockGet(() => current);
    post.mockImplementation(async (path: string) => {
      if (path === '/v1/partner/featured/plans/2/order') return { purchaseId: 'fp-9', orderId: 'order_1', amountPaise: 149_900, currency: 'INR', keyId: 'rzp_test' };
      if (path === '/v1/partner/featured/purchases/fp-9/pay/dev') {
        current = featured;
        return featured;
      }
      throw new Error(`unexpected ${path}`);
    });

    await renderScreen(<FeaturedScreen />);
    await fireEvent.press(await screen.findByTestId('plan-2'));
    await fireEvent.press(screen.getByTestId('buy'));

    expect(await screen.findByTestId('featured-success')).toHaveTextContent('Payment done. You are featured until 21 Nov 2026.');
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/v1/partner/featured/plans/2/order', '/v1/partner/featured/purchases/fp-9/pay/dev']);
    expect(screen.getByText('Featured until 21 Nov 2026')).toBeTruthy();
    // Refetched after the purchase.
    await waitFor(() => expect(get.mock.calls.filter((c) => c[0] === '/v1/partner/featured').length).toBeGreaterThanOrEqual(2));
    expect(razorpay.open).not.toHaveBeenCalled();
  });

  it('explains and disables the buttons when the profile is not live', async () => {
    mockGet({ ...notFeatured, canBuy: false });
    await renderScreen(<FeaturedScreen />);
    expect(await screen.findByTestId('featured-locked')).toHaveTextContent(/must be live to get featured/);
    await fireEvent.press(screen.getByTestId('buy'));
    expect(screen.getByTestId('buy')).toBeDisabled();
    expect(screen.getByTestId('plan-1')).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('explains VENDOR_NOT_ACTIVE from the server next to the plans', async () => {
    mockGet(notFeatured);
    post.mockRejectedValue(new ApiError(409, 'VENDOR_NOT_ACTIVE', 'Your profile must be live to get featured.'));
    await renderScreen(<FeaturedScreen />);
    await fireEvent.press(await screen.findByTestId('buy'));
    expect(await screen.findByTestId('featured-failed')).toHaveTextContent(/must be live to get featured/);
    expect(screen.getByTestId('toast')).toHaveTextContent(/must be live to get featured/);
  });
});

describe('buyFeatured with Razorpay', () => {
  const order = { purchaseId: 'fp-1', orderId: 'order_1', amountPaise: 49_900, currency: 'INR', keyId: 'rzp_test' };

  it('uses the dev path when asked for, or without the native checkout', () => {
    expect(choosePaymentPath('dev', true)).toBe('dev');
    expect(choosePaymentPath(undefined, false)).toBe('dev');
    expect(choosePaymentPath(undefined, true)).toBe('razorpay');
  });

  it('opens the checkout and verifies the payment', async () => {
    post.mockImplementation(async (path: string) => (path.endsWith('/order') ? order : featured));
    razorpay.open.mockResolvedValue({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig' });
    const res = await buyFeatured(plans[0], { name: 'Raj DJ' }, 'razorpay');
    expect(res).toEqual({ status: 'paid', overview: featured });
    expect(razorpay.open).toHaveBeenCalledWith(expect.objectContaining({ key: 'rzp_test', order_id: 'order_1', amount: 49_900 }));
    expect(post).toHaveBeenLastCalledWith('/v1/partner/featured/verify', { razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'sig' });
  });

  it('returns cancelled (no error) when the vendor closes the checkout', async () => {
    post.mockResolvedValue(order);
    razorpay.open.mockRejectedValue({ code: 2, description: 'Payment cancelled' });
    await expect(buyFeatured(plans[0], {}, 'razorpay')).resolves.toEqual({ status: 'cancelled' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('Featured entry points', () => {
  const dashboard: PartnerDashboard = {
    month: '2026-11',
    status: 'approved',
    ratingAvg: 0,
    ratingCount: 0,
    newRequests: 0,
    awaitingPayment: 0,
    overdueReturns: 0,
    monthBookings: 0,
    monthEarningsPaise: 0,
    pendingPayoutPaise: 0,
    unreadChats: 0,
    upcoming: [],
  };

  it('home shows "Get more bookings" and opens Get featured', async () => {
    mockGet(notFeatured, {
      '/v1/partner/dashboard': dashboard,
      '/v1/notifications': { items: [], hasMore: false, unreadCount: 0 },
      '/v1/partner/bookings': { items: [] },
    });
    await renderScreen(<Home />);
    const cta = await screen.findByTestId('featured-cta');
    expect(cta).toHaveTextContent(/Get more bookings/);
    await fireEvent.press(cta);
    expect(router.push).toHaveBeenCalledWith('/featured');
  });
});

describe('payout deduction', () => {
  it('shows what EventSeva took off the payout', async () => {
    await render(<MoneyBreakdown booking={booking('b1', 'completed', { payoutDeductionPaise: 50_000, payoutPaise: 100_000 })} full />);
    expect(screen.getByTestId('payout-deduction')).toHaveTextContent(/Deducted by EventSeva.*−₹500/);
    expect(screen.getByTestId('payout')).toHaveTextContent('₹1,000');
  });

  it('shows nothing when there is no deduction', async () => {
    await render(<MoneyBreakdown booking={booking('b1', 'completed')} />);
    expect(screen.queryByTestId('payout-deduction')).toBeNull();
  });
});
