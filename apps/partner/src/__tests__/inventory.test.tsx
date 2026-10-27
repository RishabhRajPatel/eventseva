import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ApiError, type InventoryItem, type RentalView } from '@eventseva/app-shared';
import { api } from '../lib/api';
import { checkStock, nextStep } from '../lib/inventory';
import InventoryScreen from '../app/inventory';
import ItemEditor from '../app/inventory/[id]';
import { RentalPanel } from '../components/RentalPanel';
import { booking } from './fixtures';
import { renderScreen } from './render';
import { expoRouterMock, router } from './routerMock';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;
const params = expoRouterMock.useLocalSearchParams as jest.Mock;

const categories = [
  { id: 'c-furn', key: 'furniture', nameEn: 'Furniture & bedding', nameHi: 'फ़र्नीचर और बिस्तर', isCustom: false, itemCount: 1 },
  { id: 'c-cook', key: 'cooking', nameEn: 'Cooking utensils', nameHi: 'खाना बनाने के बर्तन', isCustom: false, itemCount: 0 },
];
const chair: InventoryItem = {
  id: 'i1', name: 'Plastic chair', description: null, categoryId: 'c-furn', categoryName: 'Furniture & bedding', categoryNameHi: 'फ़र्नीचर',
  unit: 'piece', rentPaise: 1_000, rentPer: 'booking', totalQty: 100, repairQty: 2, depositPaise: 500, damagePaise: 30_000, missingPaise: 30_000,
  minQty: 1, maxQty: null, minDays: 1, maxDays: null, quality: 'standard', qualityLabel: null, condition: 'good', attributes: {}, isActive: true,
  updatedAt: '2026-10-27T00:00:00Z', photos: [], availableNow: 58, openBookings: 2,
};

function routeGets(map: Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    const key = Object.keys(map).find((k) => url === k || url.startsWith(k));
    if (!key) throw new Error(`unexpected GET ${url}`);
    return map[key];
  });
}

describe('inventory rules', () => {
  it('checks stock fields like the server', () => {
    expect(checkStock(100, 2, 1, null, 1, null)).toEqual({ total: null, repair: null, qty: null, days: null });
    expect(checkStock(null, null, null, null, null, null).total).toBe('required');
    expect(checkStock(5, 6, null, null, null, null).repair).toBe('repairTooMany');
    expect(checkStock(5, 0, 10, 5, null, null).qty).toBe('maxBelowMin');
    expect(checkStock(5, 0, null, null, 3, 2).days).toBe('maxBelowMin');
    expect(checkStock(5, 0, null, null, 0, null).days).toBe('daysRange');
  });

  it('knows the vendor\'s next step', () => {
    expect(nextStep('scheduled', false)).toBe('prepare');
    expect(nextStep('preparing', false)).toBe('dispatch');
    expect(nextStep('dispatched', false)).toBe('deliver');
    expect(nextStep('delivered', false)).toBe('return');
    expect(nextStep('return_pending', false)).toBe('return');
    expect(nextStep('return_pending', true)).toBe('verify');
    expect(nextStep('closed', true)).toBe('done');
  });
});

describe('inventory list', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows items with what is free now, and searches', async () => {
    routeGets({ '/v1/partner/inventory': { items: [chair] }, '/v1/partner/item-categories': { items: categories } });
    await renderScreen(<InventoryScreen />);
    expect(await screen.findByText('Plastic chair')).toBeTruthy();
    expect(screen.getByTestId('stock-i1')).toHaveTextContent('58 of 100 piece free now · 2 in repair');
    expect(screen.getByText('2 bookings')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('inventory-search'), 'deg');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/v1/partner/inventory', { q: 'deg' }));
    await fireEvent.press(screen.getByTestId('cat-cooking'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/v1/partner/inventory', { q: 'deg', categoryId: 'c-cook' }));
  });
});

describe('item form', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates on the phone, then sends paise, numbers and the custom unit', async () => {
    params.mockReturnValue({ id: 'new' });
    routeGets({ '/v1/partner/item-categories': { items: categories } });
    post.mockResolvedValue({ ...chair, id: 'i9' });
    await renderScreen(<ItemEditor />);
    await fireEvent.press(await screen.findByTestId('save-item'));
    expect(await screen.findByText('Enter the item name')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('item-name'), 'Steel deg');
    await fireEvent.press(screen.getByTestId('item-cat-cooking'));
    await fireEvent.changeText(screen.getByTestId('item-price'), '400');
    await fireEvent.press(screen.getByText('Per day'));
    await fireEvent.press(screen.getByTestId('unit-other'));
    await fireEvent.changeText(screen.getByTestId('unit-custom'), 'deg');
    await fireEvent.changeText(screen.getByTestId('item-total'), '6');
    await fireEvent.changeText(screen.getByTestId('item-repair'), '7');
    await fireEvent.press(screen.getByTestId('save-item'));
    expect(await screen.findByText("Can't be more than the total stock")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('item-repair'), '1');
    await fireEvent.changeText(screen.getByTestId('item-deposit'), '1000');
    await fireEvent.changeText(screen.getByTestId('item-damage'), '2500.50');
    await fireEvent.press(screen.getByTestId('quality-premium'));
    await fireEvent.press(screen.getByTestId('save-item'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/partner/inventory', expect.objectContaining({
        name: 'Steel deg', categoryId: 'c-cook', unit: 'deg', rentPaise: 40_000, rentPer: 'day', totalQty: 6, repairQty: 1,
        depositPaise: 100_000, damagePaise: 250_050, missingPaise: 0, quality: 'premium', qualityLabel: null, condition: 'good', isActive: true,
      })),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/inventory/i9'));
  });

  it('explains a stock cut below what bookings hold', async () => {
    params.mockReturnValue({ id: 'i1' });
    routeGets({ '/v1/partner/inventory/i1/movements': { items: [] }, '/v1/partner/inventory/i1': chair, '/v1/partner/item-categories': { items: categories } });
    patch.mockRejectedValue(new ApiError(409, 'STOCK_COMMITTED', 'x', { committed: 60, minTotalQty: 62 }));
    await renderScreen(<ItemEditor />);
    await fireEvent.changeText(await screen.findByTestId('item-total'), '50');
    await fireEvent.press(screen.getByTestId('save-item'));
    expect(await screen.findByText('Bookings already hold more than that. Keep at least 62 in stock.')).toBeTruthy();
  });

  it('asks before deleting and says when bookings keep the item', async () => {
    params.mockReturnValue({ id: 'i1' });
    routeGets({ '/v1/partner/inventory/i1/movements': { items: [] }, '/v1/partner/inventory/i1': chair, '/v1/partner/item-categories': { items: categories } });
    del.mockResolvedValue({ result: 'archived', openBookings: 2 });
    await renderScreen(<ItemEditor />);
    await fireEvent.press(await screen.findByTestId('delete-item'));
    expect(await screen.findByText(/Bookings already made for it still go ahead/)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
    const buttons = screen.getAllByText('Delete item');
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(del).toHaveBeenCalledWith('/v1/partner/inventory/i1'));
    expect(await screen.findByText('Item removed. 2 bookings already made still go ahead.')).toBeTruthy();
  });
});

describe('rental panel', () => {
  beforeEach(() => jest.clearAllMocks());
  const line = {
    id: 'l1', itemId: 'i1', item: { name: 'Plastic chair', unit: 'piece', category: 'Furniture', quality: 'standard' as const, qualityLabel: null, condition: 'good' as const, rentPaise: 1_000, rentPer: 'booking' as const },
    qty: 50, unitPaise: 1_000, amountPaise: 50_000, depositPaise: 500, damagePaise: 30_000, missingPaise: 30_000,
    loadedQty: 50, dispatchedQty: 50, deliveredQty: 50, returnedQty: 0, damagedQty: 0, missingQty: 0, note: null, verifiedAt: null,
  };
  const view = (over: Partial<RentalView>): RentalView => ({
    fulfilment: 'delivered', startsAt: '2026-11-06T04:30:00Z', endsAt: '2026-11-07T04:30:00Z', returnDueAt: '2026-11-07T04:30:00Z', lines: [line], steps: [],
    charges: [], deposit: { requiredPaise: 25_000, paidPaise: 25_000, keptPaise: 0, settledAt: null }, balancePaidPaise: 0, dueToVendorPaise: 0, ...over,
  });

  it('counts the return: the numbers must add up, and the charge is shown before saving', async () => {
    routeGets({ '/v1/partner/bookings/b1/rental': view({}) });
    post.mockResolvedValue(view({ fulfilment: 'return_pending', steps: [{ phase: 'return', notes: null, photoIds: [], recordedAt: '' }] }));
    await renderScreen(<RentalPanel booking={booking('b1', 'confirmed', { bookingType: 'rental', stage: 'delivered' })} />);
    await fireEvent.changeText(await screen.findByTestId('return-returned-l1'), '45');
    await fireEvent.changeText(screen.getByTestId('return-damaged-l1'), '3');
    expect(screen.getByText('Plastic chair: back, damaged and missing must add up to 50')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('return-missing-l1'), '2');
    expect(screen.getByTestId('charge-l1')).toHaveTextContent('Charge by the agreed rates: ₹1,500');
    await fireEvent.press(screen.getByTestId('rental-return'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/partner/bookings/b1/rental/return', { lines: [{ lineId: 'l1', returned: 45, damaged: 3, missing: 2 }], note: undefined, photos: undefined }),
    );
    expect(await screen.findByTestId('rental-verify')).toBeTruthy();
  });

  it('dispatches the booked quantities by default', async () => {
    routeGets({ '/v1/partner/bookings/b1/rental': view({ fulfilment: 'preparing', lines: [{ ...line, dispatchedQty: 0, deliveredQty: 0 }] }) });
    post.mockResolvedValue(view({ fulfilment: 'dispatched' }));
    await renderScreen(<RentalPanel booking={booking('b1', 'confirmed', { bookingType: 'rental', stage: 'preparing' })} />);
    await fireEvent.changeText(await screen.findByTestId('rental-note'), 'Truck UP70 1234');
    await fireEvent.press(screen.getByTestId('rental-dispatch'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/partner/bookings/b1/rental/dispatch', { lines: [{ lineId: 'l1', qty: 50 }], note: 'Truck UP70 1234', photos: undefined }),
    );
  });
});
