// The cart: services from one or more vendors for the same event, booked together in one checkout
// (all or none). Saved on the phone (see cartStorage.ts) so it survives closing the app; the server
// prices and checks everything again.
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

/** Where the cart is kept between app starts; set once at startup (tests leave it unset). */
export interface CartStorage {
  load(): string | null;
  save(json: string): void;
}
let storage: CartStorage | null = null;

const emit = (next: CartState) => {
  state = next;
  try {
    storage?.save(JSON.stringify(state));
  } catch {
    // A full or locked disk only means the cart is not kept after closing the app.
  }
  for (const l of listeners) l();
};

/** Saved cart, without services whose start has passed (they could not be booked any more). */
export function restoreCart(json: string | null, now = Date.now()): CartState {
  if (!json) return { items: [], bundle: null };
  try {
    const saved = JSON.parse(json) as CartState;
    if (!Array.isArray(saved.items)) return { items: [], bundle: null };
    const items = saved.items.filter((i) => i?.request?.eventId && Date.parse(i.request.startsAt) > now).slice(0, MAX_CART_ITEMS);
    const bundle = saved.bundle && items.some((i) => i.vendorId === saved.bundle!.vendorId) ? saved.bundle : null;
    return { items, bundle };
  } catch {
    return { items: [], bundle: null };
  }
}

export type AddResult = 'added' | 'full' | 'otherEvent';

export const cart = {
  get: () => state,
  /** Called once when the app starts. */
  attachStorage(s: CartStorage) {
    storage = s;
    let saved: string | null = null;
    try {
      saved = s.load();
    } catch {
      saved = null;
    }
    emit(restoreCart(saved));
  },
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

/** A package's "always included" services not yet in the cart: the checkout would refuse it (BUNDLE_INCOMPLETE). */
export function missingBundleServices(bundleItems: { serviceId: string; mandatory: boolean }[], items: Pick<CartItem, 'request'>[]): string[] {
  const inCart = new Set(items.map((i) => i.request.serviceId));
  return bundleItems.filter((i) => i.mandatory && !inCart.has(i.serviceId)).map((i) => i.serviceId);
}
