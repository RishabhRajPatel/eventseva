// What the cart keeps when items come and go — in particular which package still applies.
import type { EngineBookingRequest } from '@eventseva/app-shared';
import { cart, restoreCart, type CartItem, type CartState } from './cart';

const SOON = new Date(Date.now() + 7 * 86_400_000).toISOString();

const item = (key: string, vendorId: string, serviceId: string): CartItem => ({
  key,
  vendorId,
  vendorName: `Vendor ${vendorId}`,
  serviceTitle: `Service ${serviceId}`,
  request: { eventId: 'e1', serviceId, startsAt: SOON, endsAt: SOON, answers: {} } as EngineBookingRequest,
});

const vendorBundle = { id: 'b1', vendorId: 'v1', name: 'Full decor', discountPercent: 10, serviceIds: ['s1', 's2'] };
const curated = { id: 'p1', vendorId: null, name: 'Full wedding', discountPercent: 12, serviceIds: ['s1', 's9'] };

const saved = (state: CartState) => JSON.stringify(state);

describe('which package the cart keeps', () => {
  afterEach(() => cart.clear());

  it("drops a vendor's bundle once none of that vendor's services is left", () => {
    const kept = restoreCart(saved({ items: [item('k1', 'v1', 's1')], bundle: vendorBundle }));
    expect(kept.bundle?.id).toBe('b1');

    const gone = restoreCart(saved({ items: [item('k1', 'v2', 's5')], bundle: vendorBundle }));
    expect(gone.bundle).toBeNull();
  });

  it('keeps an EventSeva package while one of its own services is in the cart', () => {
    const kept = restoreCart(saved({ items: [item('k1', 'v7', 's9')], bundle: curated }));
    expect(kept.bundle?.id).toBe('p1');
  });

  it('drops an EventSeva package when the cart holds only unrelated services', () => {
    // The vendor differs from every vendor in the package, and so does the service. Keeping the
    // package here would show a discount the checkout would then refuse (BUNDLE_INCOMPLETE).
    const gone = restoreCart(saved({ items: [item('k1', 'v3', 'other')], bundle: curated }));
    expect(gone.bundle).toBeNull();
  });

  it('drops any package once the cart is empty', () => {
    expect(restoreCart(saved({ items: [], bundle: curated })).bundle).toBeNull();
    expect(restoreCart(saved({ items: [], bundle: vendorBundle })).bundle).toBeNull();
  });

  it('removing the last of a package’s services removes the package with it', () => {
    cart.setBundle(curated);
    // add() makes its own key, so the keys come back out of the cart.
    const { key: _k1, ...inPackage } = item('x', 'v7', 's9');
    const { key: _k2, ...unrelated } = item('x', 'v8', 'other');
    cart.add(inPackage);
    cart.add(unrelated);
    expect(cart.get().bundle?.id).toBe('p1');

    const packageKey = cart.get().items.find((i) => i.request.serviceId === 's9')!.key;
    cart.remove(packageKey); // the only service that belonged to the package
    expect(cart.get().bundle).toBeNull();
    expect(cart.get().items).toHaveLength(1);
  });

  it('survives a cart saved before packages had serviceIds', () => {
    // Old saves have no serviceIds; the package is dropped rather than crashing on undefined.
    const old = JSON.stringify({ items: [item('k1', 'v1', 's1')], bundle: { id: 'b1', vendorId: 'v1', name: 'Old', discountPercent: 5 } });
    expect(restoreCart(old).bundle?.id).toBe('b1'); // a vendor bundle still matches on its vendor
    const oldCurated = JSON.stringify({ items: [item('k1', 'v1', 's1')], bundle: { id: 'p1', vendorId: null, name: 'Old', discountPercent: 5 } });
    expect(restoreCart(oldCurated).bundle).toBeNull();
  });
});
