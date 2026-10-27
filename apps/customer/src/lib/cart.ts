// The cart: services from one or more vendors for the same event, booked together in one checkout
// (all or none). Kept in memory while the app is open; the server prices and checks everything again.
import { useSyncExternalStore } from 'react';
import type { EngineBookingRequest } from '@eventseva/app-shared';

export const MAX_CART_ITEMS = 10;

export interface CartItem {
  /** Local id, so the same service can be in the cart twice (e.g. two cars). */
  key: string;
  vendorId: string;
  vendorName: string;
  serviceTitle: string;
  request: EngineBookingRequest;
}

export interface CartState {
  items: CartItem[];
  /** A vendor's package: its discount applies when its services are booked together. */
  bundle: { id: string; vendorId: string; name: string; discountPercent: number } | null;
}

let state: CartState = { items: [], bundle: null };
const listeners = new Set<() => void>();
const emit = (next: CartState) => {
  state = next;
  for (const l of listeners) l();
};

export type AddResult = 'added' | 'full' | 'otherEvent';

export const cart = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** One event per checkout: a service for another event is refused (the screen asks to clear first). */
  add(item: Omit<CartItem, 'key'>): AddResult {
    if (state.items.length >= MAX_CART_ITEMS) return 'full';
    if (state.items.length && state.items[0].request.eventId !== item.request.eventId) return 'otherEvent';
    emit({ ...state, items: [...state.items, { ...item, key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` }] });
    return 'added';
  },
  remove(key: string) {
    const items = state.items.filter((i) => i.key !== key);
    // The package goes when none of its vendor's services is left.
    const bundle = state.bundle && items.some((i) => i.vendorId === state.bundle!.vendorId) ? state.bundle : null;
    emit({ items, bundle });
  },
  setBundle(bundle: CartState['bundle']) {
    emit({ ...state, bundle });
  },
  clear() {
    emit({ items: [], bundle: null });
  },
};

export function useCart(): CartState {
  return useSyncExternalStore(cart.subscribe, cart.get, cart.get);
}
