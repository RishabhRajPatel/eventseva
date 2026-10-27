// Paying the advance. Screens call payAdvance() and do not care whether the Razorpay checkout or
// the development shortcut is used.
import { NativeModules, TurboModuleRegistry } from 'react-native';
import { palette, type Booking } from '@eventseva/app-shared';
import { api, type PayPart } from './api';

export type PaymentPath = 'razorpay' | 'dev';
export type PayMethod = 'upi' | 'card' | 'netbanking';

/** The Razorpay checkout needs a native build; Expo Go does not have it. */
export function razorpayAvailable(): boolean {
  try {
    return TurboModuleRegistry.get('RNRazorpayCheckout') != null || NativeModules.RNRazorpayCheckout != null;
  } catch {
    return false;
  }
}

/** Dev path when asked for (EXPO_PUBLIC_PAYMENTS=dev) or when the native checkout is missing. */
export function choosePaymentPath(
  mode: string | undefined = process.env.EXPO_PUBLIC_PAYMENTS,
  hasNativeCheckout: boolean = razorpayAvailable(),
): PaymentPath {
  return mode === 'dev' || !hasNativeCheckout ? 'dev' : 'razorpay';
}

export type PayResult = { status: 'paid'; booking: Booking } | { status: 'cancelled' };

/** Where a payment is, for the screen: creating the order, in the checkout, checking with the server. */
export type PayStage = 'starting' | 'checkout' | 'verifying';

export class PaymentError extends Error {}

/** Razorpay's error code when the customer closes the checkout. */
const RAZORPAY_CANCELLED = 2;

export async function payAdvance(
  booking: Pick<Booking, 'id' | 'item'>,
  who: { name?: string | null; phone?: string; method?: PayMethod } = {},
  path: PaymentPath = choosePaymentPath(),
  onStage: (stage: PayStage) => void = () => undefined,
  /** The advance by default; for a confirmed rental also the security deposit or the balance. */
  part: PayPart = 'advance',
): Promise<PayResult> {
  if (path === 'dev') {
    onStage('verifying');
    return { status: 'paid', booking: await api.devPay(booking.id, part) };
  }

  onStage('starting');
  const order = await api.startPayment(booking.id, part);
  onStage('checkout');
  // Loaded only here, so Expo Go and tests never touch the missing native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RazorpayCheckout = (require('react-native-razorpay') as typeof import('react-native-razorpay')).default;
  let result;
  try {
    result = await RazorpayCheckout.open({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.orderId,
      name: 'EventSeva',
      description: booking.item.title,
      prefill: { name: who.name ?? undefined, contact: who.phone, method: who.method },
      theme: { color: palette.royal },
    });
  } catch (e) {
    const err = e as { code?: number; description?: string };
    if (err?.code === RAZORPAY_CANCELLED) return { status: 'cancelled' };
    throw new PaymentError(err?.description || 'Payment failed. No money was taken; please try again.');
  }
  onStage('verifying');
  const paid = await api.verifyPayment(booking.id, {
    razorpayOrderId: result.razorpay_order_id ?? order.orderId,
    razorpayPaymentId: result.razorpay_payment_id,
    razorpaySignature: result.razorpay_signature ?? '',
  });
  return { status: 'paid', booking: paid };
}
