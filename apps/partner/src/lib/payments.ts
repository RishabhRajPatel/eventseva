// Paying for "Get featured". The screen calls buyFeatured() and does not care whether the Razorpay
// checkout or the development shortcut is used.
import { NativeModules, TurboModuleRegistry } from 'react-native';
import { palette, type FeaturedOrder, type FeaturedOverview, type FeaturedPlan } from '@eventseva/app-shared';
import { api } from './api';

export type PaymentPath = 'razorpay' | 'dev';

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

export type BuyResult = { status: 'paid'; overview: FeaturedOverview } | { status: 'cancelled' };

/** The checkout failed on Razorpay's side (not a server error); message is Razorpay's or ours. */
export class PaymentError extends Error {}

/** Razorpay's error code when the vendor closes the checkout. */
const RAZORPAY_CANCELLED = 2;

export async function buyFeatured(
  plan: Pick<FeaturedPlan, 'id' | 'name'>,
  who: { name?: string | null; phone?: string } = {},
  path: PaymentPath = choosePaymentPath(),
): Promise<BuyResult> {
  const order = await api.post<FeaturedOrder>(`/v1/partner/featured/plans/${plan.id}/order`);
  if (path === 'dev') {
    return { status: 'paid', overview: await api.post<FeaturedOverview>(`/v1/partner/featured/purchases/${order.purchaseId}/pay/dev`) };
  }

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
      description: plan.name,
      prefill: { name: who.name ?? undefined, contact: who.phone },
      theme: { color: palette.indigo },
    });
  } catch (e) {
    const err = e as { code?: number; description?: string };
    if (err?.code === RAZORPAY_CANCELLED) return { status: 'cancelled' };
    throw new PaymentError(err?.description || 'Payment failed. No money was taken; please try again.');
  }
  const overview = await api.post<FeaturedOverview>('/v1/partner/featured/verify', {
    razorpayOrderId: result.razorpay_order_id ?? order.orderId,
    razorpayPaymentId: result.razorpay_payment_id,
    razorpaySignature: result.razorpay_signature ?? '',
  });
  return { status: 'paid', overview };
}
