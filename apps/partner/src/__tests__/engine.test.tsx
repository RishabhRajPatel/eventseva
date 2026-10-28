import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { BookingChange, EngineService, ServiceSetup, TripView, VendorResource } from '@eventseva/app-shared';
import { api } from '../lib/api';
import {
  checkReadings,
  fieldErrors,
  missingDocs,
  nextTripStep,
  priceExtras,
  priceForm,
  resourceKinds,
  ruleForm,
  toPricing,
  toRules,
  toValues,
} from '../lib/engine';
import { businessPayload, initialBusiness, validateBusiness } from '../components/BusinessForm';
import { ChangesPanel } from '../components/ChangesPanel';
import { needsDecision, RequestActions } from '../components/RequestActions';
import { TripPanel } from '../components/TripPanel';
import EngineServiceEditor from '../app/engine/service/[id]';
import EngineHub from '../app/engine';
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
const params = expoRouterMock.useLocalSearchParams as jest.Mock;

function routeGets(map: Record<string, unknown>) {
  get.mockImplementation(async (url: string) => {
    const key = Object.keys(map).find((k) => url === k);
    if (!key) throw new Error(`unexpected GET ${url}`);
    return map[key];
  });
}

const carSetup: ServiceSetup = {
  bookingType: 'transport',
  pricingModels: ['fixed', 'hourly', 'daily', 'per_trip'],
  attributes: [],
  questions: [],
  resourceKind: 'vehicle',
  staffKind: null,
  defaultRules: { leadTimeHours: 12, minDurationMin: 120 },
  vendorRuleKeys: ['minDurationMin', 'leadTimeHours', 'deposit', 'approval'],
  resourceFields: {
    vehicle: [{ key: 'registration', label: { en: 'Registration number', hi: 'रजिस्ट्रेशन नंबर' }, type: 'text', required: true, maxLength: 13 }],
    driver: [],
    staff: [],
    artist: [],
    venue: [],
    equipment: [],
  },
};

const innova: VendorResource = {
  id: 'r1', kind: 'vehicle', name: 'White Innova', attributes: { registration: 'UP70AB1234', with_driver: true }, status: 'active', verification: 'pending', rejectReason: null,
  documents: [{ id: 'd1', docType: 'vehicle_rc', status: 'pending', rejectReason: null }],
};
const ramesh: VendorResource = { id: 'r2', kind: 'driver', name: 'Ramesh', attributes: {}, status: 'active', verification: 'approved', rejectReason: null, documents: [] };

describe('engine rules on the phone', () => {
  it('shows the price fields that matter and sends paise', () => {
    expect(priceExtras('transport', 'daily')).not.toContain('dayRatePaise');
    expect(priceExtras('transport', 'fixed')).toEqual(expect.arrayContaining(['includedKm', 'extraKmPaise', 'driverDayPaise', 'dayRatePaise']));
    expect(priceExtras('time_window', 'fixed')).toEqual(['includedHours', 'overtimeHourPaise', 'minChargePaise', 'travelFreeKm', 'travelPerKmPaise']);
    expect(priceExtras('quote', 'quote')).toEqual([]);

    const ok = toPricing('transport', { model: 'fixed', rate: '5000', extras: { includedKm: '80', extraKmPaise: '18.50' }, taxPercent: 5 });
    expect(ok).toEqual({ ok: true, pricing: { model: 'fixed', ratePaise: 500_000, includedKm: 80, extraKmPaise: 1_850, taxPercent: 5 } });
    expect(toPricing('transport', { model: 'fixed', rate: '', extras: {}, taxPercent: 0 })).toEqual({ ok: false, field: 'rate' });
    expect(toPricing('transport', { model: 'fixed', rate: '100', extras: { includedKm: '8.5' }, taxPercent: 0 })).toEqual({ ok: false, field: 'includedKm' });
    expect(toPricing('quote', { model: 'quote', rate: '', extras: {}, taxPercent: 0 })).toEqual({ ok: true, pricing: { model: 'quote', ratePaise: 0 } });
    // Round trip from a saved service.
    expect(priceForm({ model: 'hourly', ratePaise: 150_000, minChargePaise: 300_000 }, ['hourly'])).toMatchObject({ model: 'hourly', rate: '1500', extras: { minChargePaise: '3000' } });
  });

  it('turns hours into minutes and checks ranges and the category notice', () => {
    expect(toRules('time_window', { approval: 'auto', instructions: ' Power needed ', minHours: '2', maxHours: '6.5', setupHours: '1.5' })).toEqual({
      ok: true,
      rules: { approval: 'auto', instructions: 'Power needed', minDurationMin: 120, maxDurationMin: 390, setupMin: 90 },
    });
    expect(toRules('time_window', { approval: 'vendor', instructions: '', minHours: '6', maxHours: '2' })).toMatchObject({ ok: false, field: 'maxHours', reason: 'range' });
    expect(toRules('per_person', { approval: 'vendor', instructions: '', minQty: '500', maxQty: '50' })).toMatchObject({ ok: false, field: 'maxQty' });
    expect(toRules('transport', { approval: 'vendor', instructions: '', leadTimeHours: '2' }, 12)).toMatchObject({ ok: false, reason: 'lead' });
    expect(toRules('transport', { approval: 'vendor', instructions: '', deposit: '5000' })).toMatchObject({ ok: true, rules: { deposit: { fixedPaise: 500_000 } } });
    expect(ruleForm({ minDurationMin: 90, leadTimeHours: 24, approval: 'auto' })).toMatchObject({ minHours: '1.5', leadTimeHours: '24', approval: 'auto' });
  });

  it('checks template fields like the server and cleans the registration', () => {
    const fields = carSetup.resourceFields.vehicle.concat([{ key: 'seats', label: { en: 'Seats', hi: 'सीटें' }, type: 'number', required: true, min: 1, max: 60 }]);
    expect(fieldErrors(fields, {})).toEqual({ registration: 'required', seats: 'required' });
    expect(fieldErrors(fields, { registration: 'UP70AB1234', seats: '90' })).toEqual({ seats: 'invalid' });
    expect(toValues(fields, { registration: ' up 70 ab-1234 ', seats: '7' })).toEqual({ registration: 'UP70AB1234', seats: 7 });
  });

  it('knows what the vendor lists, what papers are missing and the next trip step', () => {
    expect(resourceKinds(carSetup)).toEqual(['vehicle', 'driver']);
    expect(resourceKinds({ bookingType: 'staffing', resourceKind: null, staffKind: 'cook' })).toEqual(['staff']);
    expect(resourceKinds({ bookingType: 'time_window', resourceKind: 'crew', staffKind: null })).toEqual([]);
    expect(missingDocs(innova)).toEqual(['vehicle_insurance']);
    expect(nextTripStep({ fulfilment: 'scheduled', mode: 'with_driver', driver: null }, true)).toBe('assign');
    expect(nextTripStep({ fulfilment: 'assigned', mode: 'with_driver', driver: { id: 'r2', name: 'Ramesh' } }, true)).toBe('handover');
    expect(nextTripStep({ fulfilment: 'scheduled', mode: 'self_drive', driver: null }, true)).toBe('handover');
    expect(nextTripStep({ fulfilment: 'in_progress', mode: 'self_drive', driver: null }, true)).toBe('return');
    expect(nextTripStep({ fulfilment: 'in_progress', mode: 'self_drive', driver: null }, false)).toBe('done');
    expect(checkReadings('', 4)).toBe('odometer');
    expect(checkReadings('12000', null)).toBe('fuel');
    expect(checkReadings('11999', 4, 12000)).toBe('below');
    expect(checkReadings('12080', 4, 12000)).toBeNull();
  });

  it('asks before accepting a quotation or extras that need a yes / no', () => {
    expect(needsDecision({ bookingType: 'quote', addons: [] })).toBe(true);
    expect(needsDecision({ bookingType: 'time_window', addons: [{ addonId: 'a1', name: 'Fog', pricePaise: 100, status: 'pending_approval', note: null }] })).toBe(true);
    expect(needsDecision({ bookingType: 'time_window', addons: [{ addonId: 'a1', name: 'Fog', pricePaise: 100, status: 'included', note: null }] })).toBe(false);
  });

  it('GST number: checked on the phone, sent upper-case, can be cleared', () => {
    const base = initialBusiness({ businessName: 'Raj Cars', category: { id: 2 }, city: { id: 1 }, area: 'Civil Lines', address: null, about: '', location: null, serviceRadiusKm: null, gstin: null } as never);
    expect(validateBusiness({ ...base, gstin: '09ABCDE1234' }).gstin).toBe('gstin');
    expect(validateBusiness({ ...base, gstin: '09ABCDE1234F1Z5' }).gstin).toBeUndefined();
    expect(businessPayload({ ...base, gstin: '09abcde1234f1z5' }, base)).toEqual({ gstin: '09ABCDE1234F1Z5' });
    expect(businessPayload({ ...base, gstin: '' }, { ...base, gstin: '09ABCDE1234F1Z5' })).toEqual({ gstin: null });
  });
});

describe('services and cars', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists cars with their check status and missing papers', async () => {
    routeGets({
      '/v1/partner/service-setup': carSetup,
      '/v1/partner/engine-services': { items: [] },
      '/v1/partner/resources': { items: [innova, ramesh] },
      '/v1/partner/addons': { items: [] },
      '/v1/partner/bundles': { items: [] },
    });
    await renderScreen(<EngineHub />);
    expect(await screen.findByText('White Innova')).toBeTruthy();
    expect(screen.getByText('Car · UP70AB1234')).toBeTruthy();
    expect(screen.getByText('Being checked')).toBeTruthy();
    expect(screen.getByText('1 paper still needed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('add-resource-driver'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/engine/resource/[id]', params: { id: 'new', kind: 'driver' } });
  });

  it('a car service needs its car, sends the price in paise, and GST waits for a GST number', async () => {
    params.mockReturnValue({ id: 'new' });
    routeGets({
      '/v1/partner/service-setup': carSetup,
      '/v1/partner/engine-services': { items: [] },
      '/v1/partner/resources': { items: [innova, ramesh] },
      '/v1/partner/vendor': { businessName: 'Raj Cars', gstin: null, status: 'approved', media: [], services: [], packages: [] },
    });
    post.mockResolvedValue({ id: 's1' } as EngineService);
    await renderScreen(<EngineServiceEditor />);
    await fireEvent.changeText(await screen.findByTestId('service-title'), 'Wedding car');
    await fireEvent.changeText(screen.getByTestId('service-rate'), '5000');
    await fireEvent.changeText(screen.getByTestId('price-includedKm'), '80');
    await fireEvent.press(screen.getByTestId('save-service'));
    expect(await screen.findByText('Choose the car this service is for')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByTestId('gst-5').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(screen.getByTestId('pick-resource-r1'));
    await fireEvent.changeText(screen.getByTestId('rule-deposit'), '3000');
    await fireEvent.press(screen.getByTestId('save-service'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/partner/engine-services', {
        title: 'Wedding car',
        description: null,
        pricing: { model: 'fixed', ratePaise: 500_000, includedKm: 80 },
        rules: { approval: 'vendor', minDurationMin: 120, leadTimeHours: 12, deposit: { fixedPaise: 300_000 } },
        attributes: {},
        resourceId: 'r1',
        cashAllowed: false,
        plans: [],
        eventTypes: [],
        questions: [],
      }),
    );
  });
});

describe('engine bookings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a quotation is accepted with the vendor price and a decision on each extra', async () => {
    const b = booking('q1', 'requested', {
      bookingType: 'quote',
      addons: [{ addonId: 'a1', name: 'Fog machine', pricePaise: 150_000, status: 'pending_approval', note: 'For the entry' }],
    });
    post.mockResolvedValue({ ...b, status: 'accepted' });
    await renderScreen(<RequestActions bookingId="q1" booking={b} />);
    await fireEvent.press(screen.getByTestId('accept'));
    expect(post).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByTestId('confirm-accept'));
    expect(await screen.findByText("Choose “Can do” or “Can't do” for each extra.")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('quote-price'), '75000');
    await fireEvent.press(screen.getByTestId('addon-no-a1'));
    await fireEvent.press(screen.getByTestId('confirm-accept'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/q1/accept', { pricePaise: 7_500_000, addons: [{ addonId: 'a1', approve: false }] }));
  });

  const trip = (over: Partial<TripView>): TripView => ({
    fulfilment: 'in_progress', mode: 'self_drive', startsAt: '2026-12-01T04:30:00Z', endsAt: '2026-12-01T14:30:00Z', vehicle: { name: 'White Innova', registration: 'UP70AB1234' }, driver: null,
    route: null, inspections: [{ phase: 'handover', readings: { odometerKm: 12_000, fuelEighths: 8 }, notes: null, photoIds: [], recordedAt: '2026-12-01T04:30:00Z', customerAck: null, customerNote: null }],
    charges: [], deposit: { requiredPaise: 500_000, paidPaise: 500_000, keptPaise: 0, settledAt: null }, balancePaidPaise: 0, balanceDuePaise: 0, ...over,
  });

  it('records the return with fuel, tolls and damage, and refuses a meter below the handover', async () => {
    routeGets({ '/v1/partner/bookings/t1/trip': trip({}) });
    post.mockResolvedValue(trip({ fulfilment: 'closed' }));
    await renderScreen(<TripPanel booking={booking('t1', 'confirmed', { bookingType: 'transport', stage: 'confirmed' })} />);
    await fireEvent.changeText(await screen.findByTestId('return-odometer'), '11990');
    await fireEvent.press(screen.getByTestId('return-fuel-4'));
    await fireEvent.press(screen.getByTestId('save-return'));
    expect(await screen.findByText('The odometer cannot be below 12000 km (at handover).')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('return-odometer'), '12180');
    expect(screen.getByText('180 km driven')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('return-tolls'), '240');
    await fireEvent.press(screen.getByTestId('add-damage'));
    await fireEvent.changeText(screen.getByTestId('damage-desc-0'), 'Scratch on rear door');
    await fireEvent.changeText(screen.getByTestId('damage-amount-0'), '1500');
    await fireEvent.press(screen.getByTestId('save-return'));
    const buttons = await screen.findAllByText('Save return');
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/partner/bookings/t1/trip/return', {
        odometerKm: 12_180, fuelEighths: 4, notes: undefined, photos: undefined, tollsPaise: 24_000, damage: [{ description: 'Scratch on rear door', amountPaise: 150_000 }],
      }),
    );
  });

  it('assigns an approved driver before the handover', async () => {
    routeGets({ '/v1/partner/bookings/t2/trip': trip({ fulfilment: 'scheduled', mode: 'with_driver', inspections: [] }), '/v1/partner/resources': { items: [innova, ramesh] } });
    post.mockResolvedValue(trip({ fulfilment: 'assigned', mode: 'with_driver', driver: { id: 'r2', name: 'Ramesh' }, inspections: [] }));
    await renderScreen(<TripPanel booking={booking('t2', 'confirmed', { bookingType: 'transport' })} />);
    await fireEvent.press(await screen.findByTestId('driver-r2'));
    await fireEvent.press(screen.getByTestId('assign'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/t2/trip/driver', { driverId: 'r2' }));
    expect(await screen.findByTestId('handover-form')).toBeTruthy();
  });

  it('approves a change the customer asked for', async () => {
    const change: BookingChange = { id: 'c1', kind: 'extension', startsAt: '2026-12-01T04:30:00Z', endsAt: '2026-12-01T18:30:00Z', priceDiffPaise: 200_000, status: 'requested', reason: 'Baraat late', createdAt: '', decidedAt: null };
    routeGets({ '/v1/partner/bookings/b1/changes': { items: [change] } });
    post.mockResolvedValue({ items: [{ ...change, status: 'approved' }] });
    await renderScreen(<ChangesPanel booking={booking('b1', 'confirmed', { bookingType: 'transport' })} />);
    expect(await screen.findByText('Customer pays ₹2,000 more')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('approve-change-c1'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/b1/changes/c1/approve'));
    expect(await screen.findByText('Approved')).toBeTruthy();
  });
});

describe('customer answers on a booking', () => {
  it('shows the question and option labels in the vendor language, and skips internal keys', () => {
    const { answerRows } = jest.requireActual<typeof import('../lib/engine')>('../lib/engine');
    const b = {
      answers: { occasion: 'baraat', power_at_venue: false, area: ['stage', 'mandap'], mode: 'with_driver', estKm: 12 },
      questions: [
        { key: 'occasion', label: { en: 'Occasion', hi: 'मौका' }, options: [{ value: 'baraat', label: { en: 'Baraat', hi: 'बारात' } }] },
        { key: 'power_at_venue', label: { en: 'Power available at the venue', hi: 'वेन्यू पर बिजली है' } },
        { key: 'area', label: { en: 'Area to decorate', hi: 'सजाने की जगह' }, options: [{ value: 'stage', label: { en: 'Stage', hi: 'स्टेज' } }, { value: 'mandap', label: { en: 'Mandap', hi: 'मंडप' } }] },
      ],
    };
    expect(answerRows(b, 'en')).toEqual([
      { key: 'occasion', label: 'Occasion', value: 'Baraat' },
      { key: 'power_at_venue', label: 'Power available at the venue', value: false },
      { key: 'area', label: 'Area to decorate', value: 'Stage, Mandap' },
    ]);
    expect(answerRows(b, 'hi')[0]).toEqual({ key: 'occasion', label: 'मौका', value: 'बारात' });
  });
});
