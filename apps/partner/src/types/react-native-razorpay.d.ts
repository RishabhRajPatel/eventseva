// react-native-razorpay 3.0 ships plain JS without type declarations (its src/types.ts is not exported).
declare module 'react-native-razorpay' {
  export interface RazorpayOptions {
    key: string;
    amount: number | string;
    currency?: string;
    name?: string;
    description?: string;
    order_id?: string;
    prefill?: { name?: string; email?: string; contact?: string; method?: string };
    theme?: { color?: string };
    [key: string]: unknown;
  }
  export interface PaymentSuccessData {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  }
  const RazorpayCheckout: { open(options: RazorpayOptions): Promise<PaymentSuccessData> };
  export default RazorpayCheckout;
}
