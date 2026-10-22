import { screen, userEvent, within } from '@testing-library/react-native';
import { ApiError, rupees, type Offer } from '@eventseva/app-shared';
import HomeScreen from '../app/(tabs)/index';
import BookingScreen from '../app/booking/[id]';
import OffersScreen from '../app/offers';
import PayScreen from '../app/pay/[id]';
import { api } from '../lib/api';
import { booking, inDays } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/session', () => ({
  useMe: () => ({ id: 'u1', phone: '+919876543210', name: 'Rahul Verma', language: 'en', cityId: 1 }),
  useSession: () => ({}),
}));
// A native build, so the Pay button with the amount is shown (tests have no Razorpay module).
jest.mock('../lib/payments', () => ({ ...jest.requireActual('../lib/payments'), choosePaymentPath: () => 'razorpay' }));

const mockedApi = api as unknown as Record<string, jest.Mock>;
const Stub = () => null;

const shaadi: Offer = {
  code: 'SHAADI10',
  title: '10% off your first booking',
  summary: '10% off, up to ₹500',
  discountType: 'percent',
  discountValue: 10,
  maxDiscountPaise: 50_000,
  minAmountPaise: 1_000_000,
  firstBookingOnly: true,
  validUntil: '2026-12-31T18:29:00Z',
  category: null,
};
const tent: Offer = {
  code: 'TENT20',
  title: 'Tent season',
  summary: '₹300 off',
  discountType: 'flat',
  discountValue: 30_000,
  maxDiscountPaise: null,
  minAmountPaise: 0,
  firstBookingOnly: false,
  validUntil: null,
  category: { slug: 'tent', icon: 'tent', name: 'Tent house' },
};

// The board's example: ₹15,000 booking, advance ₹3,750, SHAADI10 takes ₹500 off, pay ₹3,250 now.
const payBy = () => new Date(Date.now() + 3 * 3600_000).toISOString();
const accepted = (over = {}) =>
  booking({ status: 'accepted', payBy: payBy(), quantity: 1, amountPaise: 1_500_000, advancePaise: 375_000, balancePaise: 1_125_000, ...over });
const withCoupon = (over = {}) => accepted({ discountPaise: 50_000, couponCode: 'SHAADI10', payNowPaise: 325_000, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.offers.mockResolvedValue({ items: [shaadi, tent] });
});

describe('payment screen coupons', () => {
  const open = () => renderApp({ 'pay/[id]': PayScreen, 'booking/[id]': Stub }, '/pay/b1');

  test('typing a code applies it; the breakdown and the Pay button use payNowPaise', async () => {
    mockedApi.booking.mockResolvedValue(accepted());
    mockedApi.applyCoupon.mockResolvedValue(withCoupon());
    const user = userEvent.setup();
    await open();
    expect(await screen.findByRole('button', { name: `Pay ${rupees(375_000)}` })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Have a coupon?' }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    await user.type(screen.getByLabelText('Coupon code'), 'sh');
    expect(apply).toBeDisabled(); // at least 3 characters
    await user.type(screen.getByLabelText('Coupon code'), 'aadi-10');
    expect(screen.getByLabelText('Coupon code')).toHaveDisplayValue('SHAADI10');
    await user.press(apply);
    expect(mockedApi.applyCoupon).toHaveBeenCalledWith('b1', 'SHAADI10');

    expect(await screen.findByText(`SHAADI10 applied: −${rupees(50_000)}`)).toBeOnTheScreen();
    expect(screen.getByText('Advance')).toBeOnTheScreen();
    expect(screen.getByText(rupees(375_000))).toBeOnTheScreen();
    expect(screen.getByText('Coupon SHAADI10')).toBeOnTheScreen();
    expect(screen.getByText(`−${rupees(50_000)}`)).toBeOnTheScreen();
    expect(screen.getByText('Pay now')).toBeOnTheScreen();
    expect(screen.getByText(rupees(325_000))).toBeOnTheScreen();
    expect(screen.getByText(rupees(1_125_000))).toBeOnTheScreen(); // balance unchanged
    expect(screen.getByRole('button', { name: `Pay ${rupees(325_000)}` })).toBeOnTheScreen();
  });

  test('tapping an available offer applies it', async () => {
    mockedApi.booking.mockResolvedValue(accepted());
    mockedApi.applyCoupon.mockResolvedValue(withCoupon());
    const user = userEvent.setup();
    await open();
    expect(await screen.findByText('Available offers')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Apply SHAADI10: 10% off, up to ₹500' }));
    expect(mockedApi.applyCoupon).toHaveBeenCalledWith('b1', 'SHAADI10');
    expect(await screen.findByRole('button', { name: `Pay ${rupees(325_000)}` })).toBeOnTheScreen();
  });

  test('removing the coupon goes back to the full advance', async () => {
    mockedApi.booking.mockResolvedValue(withCoupon());
    mockedApi.removeCoupon.mockResolvedValue(accepted());
    const user = userEvent.setup();
    await open();
    expect(await screen.findByRole('button', { name: `Pay ${rupees(325_000)}` })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Remove' }));
    expect(mockedApi.removeCoupon).toHaveBeenCalledWith('b1');
    expect(await screen.findByRole('button', { name: `Pay ${rupees(375_000)}` })).toBeOnTheScreen();
    expect(screen.queryByText(/applied/)).not.toBeOnTheScreen();
    expect(screen.getByText('Advance now')).toBeOnTheScreen();
  });

  test.each([
    [new ApiError(400, 'COUPON_NOT_APPLICABLE', 'below', { reason: 'min_amount', minAmountPaise: 5_000_000 }), `This coupon is for bookings of ${rupees(5_000_000)} or more.`],
    [new ApiError(400, 'COUPON_NOT_APPLICABLE', 'x', { reason: 'category' }), 'This coupon is not for this kind of service.'],
    [new ApiError(400, 'COUPON_NOT_APPLICABLE', 'x', { reason: 'first_booking' }), 'This coupon is only for your first booking.'],
    [new ApiError(400, 'COUPON_NOT_APPLICABLE', 'x', { reason: 'zero' }), 'This coupon gives no discount on this booking.'],
    [new ApiError(400, 'COUPON_INVALID', 'x'), 'This coupon code is not valid or has expired.'],
    [new ApiError(409, 'COUPON_ALREADY_USED', 'x'), 'You have already used this coupon.'],
    [new ApiError(409, 'COUPON_USED_UP', 'x'), 'This coupon has been fully used. Try another offer.'],
    [new ApiError(409, 'COUPON_NOT_ALLOWED', 'x', { status: 'confirmed' }), 'Coupons can only be changed before you pay.'],
  ])('error %#: clear message', async (error, text) => {
    mockedApi.booking.mockResolvedValue(accepted());
    mockedApi.applyCoupon.mockRejectedValue(error);
    const user = userEvent.setup();
    await open();
    await user.press(await screen.findByRole('button', { name: 'Have a coupon?' }));
    await user.type(screen.getByLabelText('Coupon code'), 'BIG');
    await user.press(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `Pay ${rupees(375_000)}` })).toBeOnTheScreen();
  });
});

describe('booking detail coupons', () => {
  const open = () => renderApp({ 'booking/[id]': BookingScreen, 'pay/[id]': Stub, 'chat/[id]': Stub, help: Stub, search: Stub }, '/booking/b1');

  test('requested: the coupon box is there and applying updates the amounts', async () => {
    mockedApi.booking.mockResolvedValue(accepted({ status: 'requested', payBy: null }));
    mockedApi.applyCoupon.mockResolvedValue(withCoupon({ status: 'requested', payBy: null }));
    const user = userEvent.setup();
    await open();
    await user.press(await screen.findByRole('button', { name: 'Apply TENT20: ₹300 off' }));
    expect(await screen.findByText(`SHAADI10 applied: −${rupees(50_000)}`)).toBeOnTheScreen();
    expect(screen.getByText('Pay now')).toBeOnTheScreen();
    expect(screen.getByText(rupees(325_000))).toBeOnTheScreen();
  });

  test('accepted: the Pay button shows what is paid now', async () => {
    mockedApi.booking.mockResolvedValue(withCoupon());
    await open();
    expect(await screen.findByRole('button', { name: `Pay ${rupees(325_000)}` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeOnTheScreen();
  });

  test('confirmed: the coupon line is in the breakdown, no coupon box; refund estimate uses what was paid', async () => {
    mockedApi.booking.mockResolvedValue(withCoupon({ status: 'confirmed', payBy: null, day: inDays(20) }));
    const user = userEvent.setup();
    await open();
    expect(await screen.findByText('Coupon SHAADI10')).toBeOnTheScreen();
    expect(screen.getByText(`−${rupees(50_000)}`)).toBeOnTheScreen();
    expect(screen.getByText('Paid in the app')).toBeOnTheScreen();
    expect(screen.getByText(rupees(325_000))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Have a coupon?' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Cancel booking' }));
    // 90% of the ₹3,250 paid, not of the ₹3,750 advance.
    expect(await screen.findByText(`You will get about ${rupees(292_500)} back (90% of the ${rupees(325_000)} you paid).`)).toBeOnTheScreen();
  });

  test('no coupon: the breakdown is unchanged', async () => {
    mockedApi.booking.mockResolvedValue(booking({ status: 'confirmed' }));
    await open();
    expect(await screen.findByText('Advance paid')).toBeOnTheScreen();
    expect(screen.queryByText(/^Coupon /)).not.toBeOnTheScreen();
  });
});

describe('offers on Home', () => {
  const open = () => renderApp({ index: HomeScreen, offers: OffersScreen, search: Stub, notifications: Stub, 'event/new': Stub }, '/');

  beforeEach(() => {
    mockedApi.categories.mockResolvedValue({ items: [] });
    mockedApi.vendors.mockResolvedValue({ items: [], page: 1, hasMore: false });
    mockedApi.notifications.mockResolvedValue({ items: [], hasMore: false, unreadCount: 0 });
  });

  test('with offers: one banner per offer instead of "Plan your event"; tapping opens Offers', async () => {
    const user = userEvent.setup();
    const router = await open();
    const card = await screen.findByRole('button', { name: /^10% off your first booking\. 10% off, up to ₹500\. Code SHAADI10\. Valid till 31 Dec 2026/ });
    expect(within(card).getByText('SHAADI10')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Tent season. ₹300 off. Code TENT20' })).toBeOnTheScreen();
    expect(screen.queryByText('Plan your event')).not.toBeOnTheScreen();

    await user.press(card);
    expect(router.getPathname()).toBe('/offers');
    expect(await screen.findByText('Offers')).toBeOnTheScreen();
    expect(screen.getAllByText('Use this code at payment')).toHaveLength(2);
    expect(screen.getByText(`On bookings of ${rupees(1_000_000)} or more`)).toBeOnTheScreen();
    expect(screen.getByText('First booking only')).toBeOnTheScreen();
    expect(screen.getByText('Only for Tent house')).toBeOnTheScreen();
    expect(screen.getByText('Valid till 31 Dec 2026')).toBeOnTheScreen();
  });

  test('without offers: the "Plan your event" banner stays', async () => {
    mockedApi.offers.mockResolvedValue({ items: [] });
    await open();
    expect(await screen.findByText('Plan your event')).toBeOnTheScreen();
    expect(screen.queryByText('SHAADI10')).not.toBeOnTheScreen();
  });
});
