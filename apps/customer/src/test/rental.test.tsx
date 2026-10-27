import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError, rupees, type RentalCatalogue, type RentalView } from '@eventseva/app-shared';
import BookingScreen from '../app/booking/[id]';
import RentScreen from '../app/vendor/[id]/rent';
import { api } from '../lib/api';
import { canCancel } from '../lib/booking';
import { addDaysTo, istIso, lineProblem, maxQty, rentalDays, stepQty } from '../lib/rental';
import { booking, event, inDays } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/session', () => ({ ...jest.requireActual('../lib/session'), useMe: () => ({ name: 'Rahul', phone: '+919876543210' }) }));

const mockedApi = api as unknown as Record<string, jest.Mock>;
const Stub = () => null;

const chairItem = {
  id: 'i1', name: 'Plastic chair', description: 'White, with arms', categoryId: 'c1', categoryName: 'Furniture', categoryNameHi: 'फ़र्नीचर', unit: 'piece',
  rentPaise: 1_000, rentPer: 'booking' as const, depositPaise: 500, damagePaise: 30_000, missingPaise: 30_000, minQty: 10, maxQty: 80, minDays: 1, maxDays: null,
  quality: 'premium' as const, qualityLabel: null, condition: 'good' as const, attributes: {}, isActive: true, updatedAt: '', photos: [], stock: 100, available: 60,
};
const catalogue: RentalCatalogue = {
  serviceId: 's-rent',
  settings: { deliveryFeePaise: 50_000, travelFreeKm: null, travelPerKmPaise: null, minOrderPaise: null, taxPercent: 0, leadTimeHours: 12, approval: 'vendor', instructions: null },
  categories: [{ id: 'c1', nameEn: 'Furniture', nameHi: 'फ़र्नीचर', itemCount: 1 }],
  items: [chairItem],
};

describe('rental rules', () => {
  it('works out days, steps and limits', () => {
    expect(istIso('2026-11-20', '10:00')).toBe('2026-11-20T10:00:00+05:30');
    expect(addDaysTo('2026-12-31', 1)).toBe('2027-01-01');
    expect(rentalDays(istIso('2026-11-20', '10:00'), istIso('2026-11-21', '18:00'))).toBe(2);
    expect(rentalDays(istIso('2026-11-20', '10:00'), istIso('2026-11-20', '22:00'))).toBe(1);
    expect(maxQty(chairItem)).toBe(60);
    expect(maxQty({ ...chairItem, available: null })).toBe(80);
    expect(stepQty(chairItem, 0, 1)).toBe(10); // straight to the minimum
    expect(stepQty(chairItem, 10, -1)).toBe(0); // below the minimum: none
    expect(stepQty(chairItem, 60, 1)).toBe(60); // never above what is free
    expect(stepQty({ ...chairItem, available: 5 }, 0, 1)).toBe(0);
    expect(lineProblem(chairItem, 5, 1)).toBe('min');
    expect(lineProblem(chairItem, 70, 1)).toBe('notFree');
    expect(lineProblem({ ...chairItem, available: null }, 90, 1)).toBe('max');
    expect(lineProblem({ ...chairItem, maxDays: 1 }, 20, 2)).toBe('days');
    expect(lineProblem(chairItem, 20, 1)).toBeNull();
  });

  it('rentals on their way are not cancelled in the app', () => {
    expect(canCancel({ status: 'confirmed', day: inDays(5), stage: 'confirmed' })).toBe(true);
    expect(canCancel({ status: 'confirmed', day: inDays(5), stage: 'dispatched' })).toBe(false);
    expect(canCancel({ status: 'confirmed', day: inDays(5) })).toBe(true);
  });
});

describe('rent screen', () => {
  beforeEach(() => jest.clearAllMocks());
  const open = () => renderApp({ 'vendor/[id]/rent': RentScreen, 'booking/[id]': Stub, 'event/new': Stub, 'event/[id]/venue': Stub }, '/vendor/v1/rent');

  it('shows what is free for the dates, prices the cart on the server, and sends once with an idempotency key', async () => {
    const ev = { ...event, eventDate: inDays(10), venueAddress: 'Civil Lines' };
    mockedApi.events.mockResolvedValue({ items: [ev] });
    mockedApi.rentals.mockResolvedValue(catalogue);
    mockedApi.quote.mockResolvedValue({
      lines: [{ code: 'base', label: 'Delivery and setup', qty: 1, unitPaise: 50_000, amountPaise: 50_000, kind: 'fee' }, { code: 'item_i1', label: 'Plastic chair × 11', qty: 11, unitPaise: 1_000, amountPaise: 11_000, kind: 'base' }],
      subtotalPaise: 61_000, taxPaise: 0, totalPaise: 61_000, advancePaise: 15_250, balancePaise: 45_750, depositPaise: 5_500, priceKind: 'confirmed',
      startsAt: '', endsAt: '', returnDueAt: null, approval: 'vendor', cancellation: { customer: [], vendorPercent: 100 }, notes: [],
    });
    mockedApi.requestRental.mockResolvedValue({ id: 'b9' });
    const user = userEvent.setup();
    const router = await open();

    expect(await screen.findByText('Plastic chair')).toBeOnTheScreen();
    expect(screen.getByText('60 free for your dates')).toBeOnTheScreen();
    expect(screen.getByText('Delivered to: Civil Lines')).toBeOnTheScreen();
    const from = mockedApi.rentals.mock.calls.at(-1)![1].from as string;
    expect(from).toBe(istIso(ev.eventDate, '10:00'));

    // Nothing chosen: says so instead of sending.
    await user.press(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getAllByText('Choose items and how many you need.').length).toBeGreaterThan(0);
    expect(mockedApi.requestRental).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'More Plastic chair' }));
    await user.press(screen.getByRole('button', { name: 'More Plastic chair' }));
    expect(screen.getByLabelText('How many Plastic chair').props.value).toBe('11');
    await waitFor(() => expect(mockedApi.quote).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 's-rent', lines: [{ itemId: 'i1', qty: 11 }] })));
    expect(await screen.findByText(rupees(61_000))).toBeOnTheScreen();
    expect(screen.getByText(rupees(5_500))).toBeOnTheScreen(); // deposit, shown apart

    await user.press(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(mockedApi.requestRental).toHaveBeenCalledTimes(1));
    const [sent, key] = mockedApi.requestRental.mock.calls[0];
    expect(sent).toMatchObject({ eventId: ev.id, serviceId: 's-rent', lines: [{ itemId: 'i1', qty: 11 }] });
    expect(key).toMatch(/^rent-[a-z0-9-]{8,}$/);
    await waitFor(() => expect(router.getPathname()).toBe('/booking/b9'));
  });

  it('says how many are left when the stock went meanwhile', async () => {
    mockedApi.events.mockResolvedValue({ items: [{ ...event, eventDate: inDays(10), venueAddress: 'Civil Lines' }] });
    mockedApi.rentals.mockResolvedValue(catalogue);
    mockedApi.quote.mockRejectedValue(new ApiError(409, 'NOT_AVAILABLE', 'x', { available: 12 }));
    const user = userEvent.setup();
    await open();
    await user.press(await screen.findByRole('button', { name: 'More Plastic chair' }));
    expect(await screen.findByText('Only 12 free for those dates. Try fewer or other dates.')).toBeOnTheScreen();
  });

  it('asks for an event first', async () => {
    mockedApi.events.mockResolvedValue({ items: [] });
    mockedApi.rentals.mockResolvedValue(catalogue);
    await open();
    expect(await screen.findByText('Add your event first')).toBeOnTheScreen();
  });
});

describe('rental on the booking screen', () => {
  beforeEach(() => jest.clearAllMocks());
  const view = (over: Partial<RentalView> = {}): RentalView => ({
    fulfilment: 'return_pending', startsAt: '2026-11-06T04:30:00Z', endsAt: '2026-11-07T04:30:00Z', returnDueAt: '2026-11-07T04:30:00Z',
    lines: [{ id: 'l1', itemId: 'i1', item: { name: 'Plastic chair', unit: 'piece', category: null, quality: 'standard', qualityLabel: null, condition: 'good', rentPaise: 1_000, rentPer: 'booking' },
      qty: 50, unitPaise: 1_000, amountPaise: 50_000, depositPaise: 500, damagePaise: 30_000, missingPaise: 30_000, loadedQty: 50, dispatchedQty: 50, deliveredQty: 50,
      returnedQty: 48, damagedQty: 2, missingQty: 0, note: null, verifiedAt: null }],
    steps: [], charges: [{ id: 'ch1', kind: 'damage', description: 'Plastic chair: 2 damaged × ₹300', amountPaise: 60_000, status: 'proposed', fromDeposit: true, decisionNote: null,
      createdAt: '2026-11-07T06:00:00Z', replyBy: '2026-11-09T06:00:00Z' }],
    deposit: { requiredPaise: 25_000, paidPaise: 25_000, keptPaise: 0, settledAt: null }, balancePaidPaise: 0, dueToVendorPaise: 0, balanceDuePaise: 0, ...over,
  });
  const rentalBooking = booking({ status: 'confirmed', bookingType: 'rental', stage: 'return_pending', startsAt: '2026-11-06T04:30:00Z', endsAt: '2026-11-07T04:30:00Z', day: inDays(1) });
  const open = () => renderApp({ 'booking/[id]': BookingScreen, 'pay/[id]': Stub, 'chat/[id]': Stub, help: Stub }, '/booking/b1');

  it('shows the items and lets the customer dispute a charge with a reason', async () => {
    mockedApi.booking.mockResolvedValue(rentalBooking);
    mockedApi.rental.mockResolvedValue(view());
    mockedApi.answerCharge.mockResolvedValue(view({ charges: [{ ...view().charges[0], status: 'disputed' }] }));
    const user = userEvent.setup();
    await open();
    expect(await screen.findByText('Plastic chair × 50')).toBeOnTheScreen();
    expect(screen.getByText('Delivered 50 · back 48 · damaged 2 · missing 0')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Dispute' }));
    const send = screen.getByRole('button', { name: 'Send dispute' });
    await user.type(screen.getByLabelText('What is wrong with this charge?'), 'Only one was broken');
    await user.press(send);
    await waitFor(() => expect(mockedApi.answerCharge).toHaveBeenCalledWith('b1', 'ch1', 'dispute', 'Only one was broken'));
    expect(await screen.findByText('Disputed: EventSeva will decide')).toBeOnTheScreen();
  });

  it('offers to pay the deposit before delivery', async () => {
    mockedApi.booking.mockResolvedValue({ ...rentalBooking, stage: 'confirmed' });
    mockedApi.rental.mockResolvedValue(view({ fulfilment: 'scheduled', charges: [], deposit: { requiredPaise: 25_000, paidPaise: 0, keptPaise: 0, settledAt: null } }));
    mockedApi.devPay.mockResolvedValue(rentalBooking);
    const user = userEvent.setup();
    await open();
    await user.press(await screen.findByRole('button', { name: `Pay deposit ${rupees(25_000)}` }));
    await waitFor(() => expect(mockedApi.devPay).toHaveBeenCalledWith('b1', 'deposit'));
  });

  it('lets the customer pay the balance, with charges beyond the deposit, online', async () => {
    mockedApi.booking.mockResolvedValue({ ...rentalBooking, stage: 'returned_verified' });
    mockedApi.rental.mockResolvedValue(view({ fulfilment: 'closed', charges: [{ ...view().charges[0], status: 'accepted' }], dueToVendorPaise: 35_000, balanceDuePaise: 85_000 }));
    mockedApi.devPay.mockResolvedValue(rentalBooking);
    const user = userEvent.setup();
    await open();
    expect(await screen.findByText(`${rupees(35_000)} of agreed charges is more than your deposit: it is added to your balance.`)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: `Pay balance ${rupees(85_000)}` }));
    await waitFor(() => expect(mockedApi.devPay).toHaveBeenCalledWith('b1', 'balance'));
  });
});
