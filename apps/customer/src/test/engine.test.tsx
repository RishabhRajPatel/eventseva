import { screen, userEvent, waitFor } from '@testing-library/react-native';
import { ApiError, rupees, type PublicEngineService, type Quote, type TripView } from '@eventseva/app-shared';
import BookingScreen from '../app/booking/[id]';
import CartScreen from '../app/cart';
import EngineBookScreen from '../app/vendor/[id]/engine';
import { api } from '../lib/api';
import { cart } from '../lib/cart';
import { carModes, countKind, durationChoices, extendedEnd, formProblem, licenceProblem, movedTimes, perModel, toRequest, type EngineForm } from '../lib/engine';
import { istIso } from '../lib/rental';
import { booking, event, inDays, vendor } from './fixtures';
import { renderApp } from './render';

jest.mock('../lib/api', () => require('./mockApi').mockApiModule());
jest.mock('../lib/session', () => ({ ...jest.requireActual('../lib/session'), useMe: () => ({ name: 'Rahul', phone: '+919876543210' }) }));

const mockedApi = api as unknown as Record<string, jest.Mock>;
const Stub = () => null;

const catering: PublicEngineService = {
  id: 's-cat', title: 'Veg wedding thali', description: 'Puri, sabzi, raita, sweet', bookingType: 'per_person',
  pricing: { model: 'per_person', ratePaise: 45_000 }, attributes: {}, minGuests: null, maxGuests: null,
  rules: { minDurationMin: null, maxDurationMin: null, minQty: 50, maxQty: 2000, workingHours: null, leadTimeHours: 48, perPersonMin: null, minAge: null, approval: 'vendor', requiredDocuments: [], instructions: null },
  questions: [
    { key: 'menu', label: { en: 'Menu', hi: 'मेन्यू' }, type: 'select', required: true, options: [{ value: 'veg', label: { en: 'Veg', hi: 'शाकाहारी' } }, { value: 'jain', label: { en: 'Jain', hi: 'जैन' } }] },
  ],
  resource: null,
  addons: [{ id: 'a1', serviceId: null, name: 'Live jalebi counter', kind: 'extra', inclusions: ['1 cook'], exclusions: [], pricePaise: 300_000, setupMinutes: 0, requiresApproval: true, isActive: true }],
};

const car: PublicEngineService = {
  ...catering, id: 's-car', title: 'Wedding car', bookingType: 'transport', pricing: { model: 'fixed', ratePaise: 500_000, includedKm: 80 },
  rules: { ...catering.rules, minQty: null, maxQty: null, minDurationMin: 120, maxDurationMin: 1440, minAge: 21 },
  questions: [], addons: [],
  resource: { id: 'r1', kind: 'vehicle', name: 'White Innova', bookable: true, attributes: { with_driver: true, self_drive: true, registrationMasked: 'UP70 •• 1234' }, photos: [] },
};

const form = (over: Partial<EngineForm> = {}): EngineForm => ({
  eventId: 'e1', eventDay: '2026-12-01', dayOffset: 0, startTime: '18:00', hours: 4, count: '', mode: 'with_driver', pickup: null, destination: null, answers: {}, addons: {}, note: '', ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  lines: [{ code: 'base', label: 'Veg wedding thali × 300', qty: 300, unitPaise: 45_000, amountPaise: 13_500_000, kind: 'base' }],
  subtotalPaise: 13_500_000, taxPaise: 0, totalPaise: 13_500_000, advancePaise: 3_375_000, balancePaise: 10_125_000, depositPaise: 0, priceKind: 'indicative',
  startsAt: '', endsAt: '', returnDueAt: null, approval: 'vendor', cancellation: { customer: [], vendorPercent: 100 }, notes: [], ...over,
});

describe('engine booking rules', () => {
  it('asks for the right count, duration and car mode', () => {
    expect(countKind('per_person')).toBe('guests');
    expect(countKind('staffing')).toBe('workers');
    expect(countKind('appointment')).toBe('people');
    expect(countKind('time_window')).toBeNull();
    expect(durationChoices({ rules: { ...catering.rules, minDurationMin: 120, maxDurationMin: 720 } })).toEqual([2, 3, 4, 5, 6, 8, 10, 12]);
    expect(durationChoices({ rules: { ...catering.rules, minDurationMin: 150, maxDurationMin: 360 } })).toEqual([3, 4, 5, 6]);
    expect(carModes(car)).toEqual(['with_driver', 'self_drive']);
    expect(carModes({ resource: null })).toEqual(['with_driver']);
    expect(perModel('hourly')).toBe('hourly');
    expect(perModel('quote')).toBe('fixed');
  });

  it('checks the form like the server and builds the request', () => {
    expect(formProblem(catering, form({ count: '' }))).toBe('count');
    expect(formProblem(catering, form({ count: '20' }))).toBe('countRange');
    expect(formProblem(catering, form({ count: '300' }))).toBe('answers');
    expect(formProblem(catering, form({ count: '300', answers: { menu: 'veg' } }))).toBeNull();
    expect(toRequest(catering, form({ count: '300', answers: { menu: 'veg' }, addons: { a1: { on: true, note: ' Near stage ' }, a2: { on: false, note: '' } }, note: ' Hi ' }))).toEqual({
      eventId: 'e1', serviceId: 's-cat', startsAt: istIso('2026-12-01', '18:00'), endsAt: new Date(Date.parse(istIso('2026-12-01', '18:00')) + 4 * 3_600_000).toISOString(),
      guestCount: 300, answers: { menu: 'veg' }, addons: [{ addonId: 'a1', note: 'Near stage' }], note: 'Hi',
    });

    const place = { address: 'Civil Lines', lat: 25.45, lng: 81.84 };
    expect(formProblem(car, form({ pickup: place }))).toBe('route');
    const req = toRequest(car, form({ dayOffset: -1, startTime: '16:00', hours: 6, mode: 'self_drive', pickup: place, destination: { ...place, address: 'Venue' } }));
    expect(req).toMatchObject({ startsAt: istIso('2026-11-30', '16:00'), mode: 'self_drive', route: { pickup: place, destination: { address: 'Venue' } } });
    expect(req.guestCount).toBeUndefined();
  });

  it('moves and extends bookings in India time, and checks licences', () => {
    expect(extendedEnd('2026-12-01T16:30:00.000Z', 2)).toBe('2026-12-01T18:30:00.000Z');
    expect(movedTimes('2026-12-01T12:30:00.000Z', '2026-12-01T16:30:00.000Z', '2026-12-02', '10:00')).toEqual({ startsAt: '2026-12-02T04:30:00.000Z', endsAt: '2026-12-02T08:30:00.000Z' });
    expect(licenceProblem('UP70 20190012345', '1995-04-23', '2034-04-22', '2026-10-27')).toBeNull();
    expect(licenceProblem('12345', '1995-04-23', '2034-04-22', '2026-10-27')).toBe('number');
    expect(licenceProblem('UP7020190012345', '1995-02-30', '2034-04-22', '2026-10-27')).toBe('dob');
    expect(licenceProblem('UP7020190012345', '1995-04-23', '2025-04-22', '2026-10-27')).toBe('expired');
  });

  it('the cart keeps one event and drops a package with its vendor', () => {
    cart.clear();
    const item = { vendorId: 'v1', vendorName: 'Shree Ram', serviceTitle: 'Thali', request: { eventId: 'e1', serviceId: 's1', startsAt: '' } };
    expect(cart.add(item)).toBe('added');
    expect(cart.add({ ...item, request: { ...item.request, eventId: 'e2' } })).toBe('otherEvent');
    cart.setBundle({ id: 'bd1', vendorId: 'v1', name: 'Wedding', discountPercent: 10 });
    cart.remove(cart.get().items[0].key);
    expect(cart.get()).toEqual({ items: [], bundle: null });
  });
});

describe('book a service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cart.clear();
  });
  const open = (url = '/vendor/v1/engine') => renderApp({ 'vendor/[id]/engine': EngineBookScreen, 'booking/[id]': Stub, 'event/new': Stub, cart: Stub, licence: Stub }, url);

  it('fills the guests from the event, asks the vendor questions, prices on the server and sends once', async () => {
    mockedApi.vendor.mockResolvedValue(vendor);
    mockedApi.events.mockResolvedValue({ items: [{ ...event, eventDate: inDays(30) }] });
    mockedApi.engineServices.mockResolvedValue({ items: [catering] });
    mockedApi.engineQuote.mockResolvedValue(quote());
    mockedApi.requestEngine.mockResolvedValue({ id: 'b7' });
    const user = userEvent.setup();
    const router = await open();

    expect(await screen.findByText('Veg wedding thali')).toBeOnTheScreen();
    expect(screen.getByLabelText('Number of guests').props.value).toBe('300');
    await user.press(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getAllByText("Please answer the vendor's questions.").length).toBeGreaterThan(0);
    expect(mockedApi.requestEngine).not.toHaveBeenCalled();

    await user.press(screen.getByRole('radio', { name: 'Veg' }));
    await user.press(screen.getByRole('radio', { name: 'Live jalebi counter, +₹3,000' }));
    expect(screen.getByText('The vendor confirms this extra when they accept.')).toBeOnTheScreen();
    await waitFor(() => expect(mockedApi.engineQuote).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 's-cat', guestCount: 300, answers: { menu: 'veg' }, addons: [{ addonId: 'a1' }] })));
    expect((await screen.findAllByText(rupees(13_500_000))).length).toBeGreaterThan(0);
    expect(screen.getByText('Indicative price: the vendor confirms it when they accept.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(mockedApi.requestEngine).toHaveBeenCalledTimes(1));
    expect(mockedApi.requestEngine.mock.calls[0][1]).toMatch(/^book-[a-z0-9-]{8,}$/);
    await waitFor(() => expect(router.getPathname()).toBe('/booking/b7'));
  });

  it('a car needs both places; self-drive points to the licence; it can go to the cart', async () => {
    mockedApi.vendor.mockResolvedValue({ ...vendor, businessName: 'Raj Cars' });
    mockedApi.events.mockResolvedValue({ items: [{ ...event, eventDate: inDays(30), venueAddress: 'Shubh Mangal Hall', venueLocation: { lat: 25.44, lng: 81.83 } }] });
    mockedApi.engineServices.mockResolvedValue({ items: [car] });
    mockedApi.engineQuote.mockResolvedValue(quote({ priceKind: 'confirmed' }));
    const user = userEvent.setup();
    const router = await open();

    expect(await screen.findByText('White Innova · UP70 •• 1234')).toBeOnTheScreen();
    await user.press(screen.getByRole('radio', { name: 'Self-drive' }));
    expect(screen.getByText(/you must be at least 21/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Add to cart' }));
    expect(screen.getAllByText('Add the pickup and drop places, and find them on the map.').length).toBeGreaterThan(0);
    expect(cart.get().items).toHaveLength(0);
    expect(router.getPathname()).toBe('/vendor/v1/engine');
  });
});

describe('after booking', () => {
  beforeEach(() => jest.clearAllMocks());
  const openBooking = () => renderApp({ 'booking/[id]': BookingScreen, 'pay/[id]': Stub, 'chat/[id]': Stub, help: Stub, 'invoice/[id]': Stub }, '/booking/b1');
  const trip: TripView = {
    fulfilment: 'in_progress', mode: 'self_drive', startsAt: '2026-12-01T04:30:00Z', endsAt: '2026-12-01T14:30:00Z', vehicle: { name: 'White Innova', registration: 'UP70AB1234' }, driver: null,
    route: { pickup: { address: 'Civil Lines', lat: 25.45, lng: 81.84 }, destination: { address: 'Hall', lat: 25.44, lng: 81.83 } },
    inspections: [{ phase: 'handover', readings: { odometerKm: 12_000, fuelEighths: 8 }, notes: 'Small dent on bumper', photoIds: [], recordedAt: '2026-12-01T04:30:00Z', customerAck: null, customerNote: null }],
    charges: [], deposit: { requiredPaise: 500_000, paidPaise: 500_000, keptPaise: 0, settledAt: null }, balancePaidPaise: 0, balanceDuePaise: 0,
  };
  const carBooking = booking({ status: 'confirmed', bookingType: 'transport', stage: 'confirmed', startsAt: '2026-12-01T04:30:00Z', endsAt: '2026-12-01T14:30:00Z', day: inDays(30) });

  it('the customer agrees with the handover record, can extend, and opens the invoice', async () => {
    mockedApi.booking.mockResolvedValue({ ...carBooking, stage: 'confirmed' });
    mockedApi.trip.mockResolvedValue({ ...trip, fulfilment: 'assigned' });
    mockedApi.changes.mockResolvedValue({ items: [] });
    mockedApi.ackInspection.mockResolvedValue({ ...trip, inspections: [{ ...trip.inspections[0], customerAck: 'agreed' }] });
    mockedApi.requestChange.mockResolvedValue({});
    const user = userEvent.setup();
    const router = await openBooking();

    expect(await screen.findByText('Odometer 12000 km · fuel 8/8')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'This is right' }));
    await waitFor(() => expect(mockedApi.ackInspection).toHaveBeenCalledWith('b1', 'handover', 'agreed', undefined));
    expect(await screen.findByText('You agreed')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Ask to move or extend' }));
    await user.press(screen.getByRole('radio', { name: '+2 hours' }));
    await user.press(screen.getByRole('button', { name: 'Send to the vendor' }));
    await waitFor(() => expect(mockedApi.requestChange).toHaveBeenCalledWith('b1', { kind: 'extension', endsAt: '2026-12-01T16:30:00.000Z' }));

    await user.press(screen.getByRole('button', { name: 'Invoice' }));
    await waitFor(() => expect(router.getPathname()).toBe('/invoice/b1'));
  });

  it('the cart books everything together, and points at the line the server refused', async () => {
    cart.clear();
    const req = { eventId: 'e1', serviceId: 's-cat', startsAt: istIso('2026-12-01', '18:00'), guestCount: 300 };
    cart.add({ vendorId: 'v1', vendorName: 'Shree Ram Caterers', serviceTitle: 'Veg wedding thali', request: req });
    cart.add({ vendorId: 'v2', vendorName: 'Raj Cars', serviceTitle: 'Wedding car', request: { ...req, serviceId: 's-car' } });
    mockedApi.checkoutQuote.mockRejectedValueOnce(new ApiError(409, 'NOT_AVAILABLE', 'x', { itemIndex: 1 }));
    const user = userEvent.setup();
    const view = await renderApp({ cart: CartScreen, bookings: Stub }, '/cart');
    expect(await screen.findByText('Wedding car')).toBeOnTheScreen();
    await waitFor(() => expect(mockedApi.checkoutQuote).toHaveBeenCalledWith([req, { ...req, serviceId: 's-car' }], undefined));
    expect(await screen.findByText('Not enough is free for those dates. Try fewer or other dates.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send requests' })).toBeDisabled();

    mockedApi.checkoutQuote.mockResolvedValue({ items: [quote()], totalPaise: 13_500_000, advancePaise: 3_375_000, depositPaise: 0 });
    mockedApi.checkout.mockResolvedValue({ id: 'co1', eventId: 'e1', createdAt: '', bookings: [{ id: 'b5' }] });
    await user.press(screen.getAllByRole('button', { name: 'Remove' })[1]);
    await user.press(await screen.findByRole('button', { name: 'Send 1 request' }));
    await waitFor(() => expect(mockedApi.checkout).toHaveBeenCalledWith([req], undefined, expect.stringMatching(/^cart-/)));
    await waitFor(() => expect(view.getPathname()).toBe('/bookings'));
    expect(cart.get().items).toHaveLength(0);
  });
});
