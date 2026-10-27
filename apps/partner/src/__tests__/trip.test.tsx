import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { addDays, todayIst } from '@eventseva/app-shared';
import * as Location from 'expo-location';
import { useState } from 'react';
import { api } from '../lib/api';
import { BusinessForm, businessPayload, initialBusiness, type BusinessValues } from '../components/BusinessForm';
import { etaChoices, eventDayOpen, TripCard } from '../components/TripCard';
import { bookingEventText } from '../lib/bookingEvents';
import i18n from 'i18next';
import { booking } from './fixtures';
import { renderScreen } from './render';

jest.mock('expo-router', () => require('./routerMock').expoRouterMock);
jest.mock('../lib/api', () => ({
  api: { get: jest.fn(async () => []), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  onSessionEnded: jest.fn(),
}));
const post = api.post as jest.Mock;

const SANGAM = { lat: 25.4246, lng: 81.8845 };

describe('trip card', () => {
  beforeEach(() => jest.clearAllMocks());

  it('before payment: distance, range warning and arrival time, but no directions', async () => {
    await renderScreen(
      <TripCard booking={booking('b1', 'requested', { travel: { roadKm: 32.5, minutes: 80, serviceRadiusKm: 20, outsideServiceArea: true }, arriveBy: '17:30' })} />,
    );
    expect(screen.getByText('About 32.5 km from you · about 1 h 20 min drive')).toBeTruthy();
    expect(screen.getByTestId('outside-range')).toBeTruthy();
    expect(screen.getByText('Arrive by 5:30 pm')).toBeTruthy();
    expect(screen.queryByTestId('directions')).toBeNull();
    expect(screen.queryByTestId('event-day')).toBeNull();
  });

  it('after payment: directions and the landmark; only Google Maps links are opened', async () => {
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('25.4246,81.8845')}`;
    const b = booking('b2', 'confirmed', {
      directionsUrl,
      event: { id: 'e1', title: 'Shaadi', eventType: 'wedding', guestCount: 300, venueAddress: 'Hotel', venueLandmark: 'Near the Sangam gate', venueLocation: SANGAM },
    });
    const first = await renderScreen(<TripCard booking={b} />);
    expect(screen.getByTestId('directions')).toBeTruthy();
    expect(screen.getByText('Landmark: Near the Sangam gate')).toBeTruthy();
    await first.unmount();
    // A tampered link is never offered.
    await renderScreen(<TripCard booking={{ ...b, directionsUrl: 'https://evil.example/phish' }} />);
    expect(screen.queryByTestId('directions')).toBeNull();
  });

  it('event day: "on the way" asks for the ETA (our estimate first), then "reached"', async () => {
    const b = booking('b3', 'confirmed', { day: todayIst(), travel: { roadKm: 6.5, minutes: 20, serviceRadiusKm: null, outsideServiceArea: false } });
    post.mockResolvedValue({ ...b, progress: { status: 'on_the_way', at: new Date().toISOString(), etaAt: new Date(Date.now() + 20 * 60_000).toISOString() } });
    await renderScreen(<TripCard booking={b} />);
    await fireEvent.press(screen.getByTestId('on-the-way'));
    expect(screen.getByText('20 min (estimate)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('eta-20'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/partner/bookings/b3/progress', { status: 'on_the_way', etaMinutes: 20 }));
    await fireEvent.press(screen.getByTestId('reached'));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/v1/partner/bookings/b3/progress', { status: 'reached' }));
  });

  it('event-day buttons show only on the day or the evening before; ETA choices', () => {
    const today = todayIst();
    expect(eventDayOpen(booking('x', 'confirmed', { day: today }))).toBe(true);
    expect(eventDayOpen(booking('x', 'confirmed', { day: addDays(today, 1) }))).toBe(true);
    expect(eventDayOpen(booking('x', 'confirmed', { day: addDays(today, 2) }))).toBe(false);
    expect(eventDayOpen(booking('x', 'accepted', { day: today }))).toBe(false);
    expect(etaChoices(20)).toEqual([20, 15, 30, 45, 60, 90]);
    expect(etaChoices(30)).toEqual([30, 15, 45, 60, 90]);
    expect(etaChoices(null)).toEqual([15, 30, 45, 60, 90]);
  });

  it('chat lines are worded for the vendor', () => {
    const t = i18n.getFixedT('en');
    expect(bookingEventText(t, { event: 'cancelled_by_customer', bookingId: 'b' }, 'en')).toBe('The customer cancelled the booking');
    expect(bookingEventText(t, { event: 'on_the_way', bookingId: 'b', minutes: 25 }, 'en')).toBe('On the way: about 25 min');
  });
});

describe('business: where you start from and how far you travel', () => {
  function Form({ start, onValue }: { start: BusinessValues; onValue: (v: BusinessValues) => void }) {
    const [v, setV] = useState(start);
    return <BusinessForm values={v} onChange={(n) => (setV(n), onValue(n))} showErrors={false} />;
  }
  const base = initialBusiness({ businessName: 'Raj DJ', category: { id: 2 }, city: { id: 1 }, area: 'Civil Lines', address: null, about: '', location: null, serviceRadiusKm: null } as never);

  it('"Use my current location" pins the phone; a range chip sets the radius; only changes are sent', async () => {
    const onValue = jest.fn();
    await renderScreen(<Form start={base} onValue={onValue} />);
    await fireEvent.press(screen.getByTestId('base-here'));
    await waitFor(() => expect(screen.getByTestId('base-pinned')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('radius-20'));
    const last = onValue.mock.calls.at(-1)[0] as BusinessValues;
    expect(businessPayload(last, base)).toEqual({ lat: 25.448412, lng: 81.840646, serviceRadiusKm: 20 });
    // Back to "Anywhere" sends null, which clears it on the server.
    expect(businessPayload({ ...last, radiusKm: null }, { ...base, radiusKm: 20 })).toMatchObject({ serviceRadiusKm: null });
  });

  it('says what to do when location is not allowed', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    await renderScreen(<Form start={base} onValue={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('base-here'));
    expect(await screen.findByText(/Location permission is off/)).toBeTruthy();
  });
});
