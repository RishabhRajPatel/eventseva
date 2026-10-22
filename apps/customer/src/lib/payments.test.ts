import RazorpayCheckout from 'react-native-razorpay';
import { api } from './api';
import { choosePaymentPath, payAdvance, PaymentError, razorpayAvailable } from './payments';

jest.mock('./api', () => ({
  api: { devPay: jest.fn(), startPayment: jest.fn(), verifyPayment: jest.fn() },
}));
jest.mock('react-native-razorpay', () => ({ __esModule: true, default: { open: jest.fn() } }));

const mocked = api as unknown as jest.Mocked<Pick<typeof api, 'devPay' | 'startPayment' | 'verifyPayment'>>;
const open = RazorpayCheckout.open as jest.Mock;
const booking = { id: 'b1', item: { type: 'package' as const, id: 'p1', title: 'Wedding night', unit: 'package' as const } };
const confirmed = { id: 'b1', status: 'confirmed' } as never;

beforeEach(() => jest.clearAllMocks());

describe('choosing the payment path', () => {
  test('EXPO_PUBLIC_PAYMENTS=dev always uses the test payment', () => {
    expect(choosePaymentPath('dev', true)).toBe('dev');
  });

  test('a missing native checkout (Expo Go) falls back to the test payment', () => {
    expect(choosePaymentPath(undefined, false)).toBe('dev');
    expect(choosePaymentPath('', false)).toBe('dev');
  });

  test('a native build without the dev flag uses Razorpay', () => {
    expect(choosePaymentPath(undefined, true)).toBe('razorpay');
    expect(choosePaymentPath('live', true)).toBe('razorpay');
  });

  test('in tests (no native module) Razorpay is not available', () => {
    expect(razorpayAvailable()).toBe(false);
    expect(choosePaymentPath(undefined)).toBe('dev');
  });
});

describe('paying the advance', () => {
  test('dev path calls pay/dev and never opens the checkout', async () => {
    mocked.devPay.mockResolvedValue(confirmed);
    await expect(payAdvance(booking, {}, 'dev')).resolves.toEqual({ status: 'paid', booking: confirmed });
    expect(mocked.devPay).toHaveBeenCalledWith('b1');
    expect(mocked.startPayment).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  test('Razorpay path: order → checkout → verify with the three fields', async () => {
    mocked.startPayment.mockResolvedValue({ orderId: 'order_1', amountPaise: 625_000, currency: 'INR', keyId: 'rzp_test_x' });
    open.mockResolvedValue({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' });
    mocked.verifyPayment.mockResolvedValue(confirmed);

    const result = await payAdvance(booking, { name: 'Rahul', phone: '+919876543210', method: 'upi' }, 'razorpay');

    expect(result).toEqual({ status: 'paid', booking: confirmed });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'rzp_test_x', amount: 625_000, order_id: 'order_1', currency: 'INR', prefill: expect.objectContaining({ method: 'upi' }) }),
    );
    expect(mocked.verifyPayment).toHaveBeenCalledWith('b1', { razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'sig' });
    expect(mocked.devPay).not.toHaveBeenCalled();
  });

  test('closing the checkout is not an error', async () => {
    mocked.startPayment.mockResolvedValue({ orderId: 'order_1', amountPaise: 1, currency: 'INR', keyId: 'k' });
    open.mockRejectedValue({ code: 2, description: 'Payment cancelled by user' });
    await expect(payAdvance(booking, {}, 'razorpay')).resolves.toEqual({ status: 'cancelled' });
    expect(mocked.verifyPayment).not.toHaveBeenCalled();
  });

  test('a failed checkout throws PaymentError and does not verify', async () => {
    mocked.startPayment.mockResolvedValue({ orderId: 'order_1', amountPaise: 1, currency: 'INR', keyId: 'k' });
    open.mockRejectedValue({ code: 0, description: 'Network error' });
    await expect(payAdvance(booking, {}, 'razorpay')).rejects.toBeInstanceOf(PaymentError);
    expect(mocked.verifyPayment).not.toHaveBeenCalled();
  });
});
