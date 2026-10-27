import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProgressBanner, TripCard } from '../components/TripCard';
import { VenuePicker, type Venue } from '../components/VenuePicker';
import { bookingEventText } from '../lib/bookingEvents';
import i18n from 'i18next';
import '../i18n';
import { booking } from './fixtures';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const wrap = (ui: React.ReactElement) => render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

function Picker({ start, onValue }: { start: Venue; onValue: (v: Venue) => void }) {
  const [v, setV] = useState(start);
  return <VenuePicker value={v} onChange={(next) => (setV(next), onValue(next))} />;
}

describe('venue pin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('"I\'m at the venue" pins the phone\'s location and fills an empty address', async () => {
    const onValue = jest.fn();
    await wrap(<Picker start={{ address: '', landmark: '', pin: null }} onValue={onValue} />);
    await fireEvent.press(screen.getByTestId('venue-here'));
    await waitFor(() => expect(screen.getByTestId('venue-pinned')).toBeTruthy());
    expect(onValue).toHaveBeenLastCalledWith({ address: 'Hotel Kanha Shyam, Civil Lines, Prayagraj', landmark: '', pin: { lat: 25.424612, lng: 81.884546 } });
  });

  it('"Find on map" geocodes the typed address in our city; typing a new address drops the pin', async () => {
    const onValue = jest.fn();
    await wrap(<Picker start={{ address: 'Hotel Kanha Shyam', landmark: '', pin: null }} onValue={onValue} />);
    await fireEvent.press(screen.getByTestId('venue-find'));
    await waitFor(() => expect(screen.getByTestId('venue-pinned')).toBeTruthy());
    expect(Location.geocodeAsync).toHaveBeenCalledWith('Hotel Kanha Shyam, Prayagraj, India');
    await fireEvent.changeText(screen.getByLabelText('Area or venue'), 'Somewhere else, Jhunsi');
    expect(onValue).toHaveBeenLastCalledWith(expect.objectContaining({ pin: null }));
  });

  it('says what to do when location is not allowed or the address is unknown', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    await wrap(<Picker start={{ address: 'Nowhere 123', landmark: '', pin: null }} onValue={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('venue-here'));
    expect(await screen.findByText(/Location permission is off/)).toBeTruthy();
    (Location.geocodeAsync as jest.Mock).mockResolvedValueOnce([]);
    await fireEvent.press(screen.getByTestId('venue-find'));
    expect(await screen.findByText(/could not find this address/)).toBeTruthy();
  });
});

describe('trip and event day', () => {
  it('shows distance, travel time, the range warning and the arrival time', async () => {
    await wrap(<TripCard booking={booking({ travel: { roadKm: 32.5, minutes: 80, serviceRadiusKm: 20, outsideServiceArea: true }, arriveBy: '17:30' })} />);
    expect(screen.getByText('About 32.5 km from the vendor · About 1 h 20 min drive')).toBeTruthy();
    expect(screen.getByTestId('trip-outside')).toBeTruthy();
    expect(screen.getByText('Vendor to arrive by 5:30 pm')).toBeTruthy();
  });

  it('asks to pin the venue when there is no pin', async () => {
    await wrap(<TripCard booking={booking()} />);
    expect(screen.getByText(/Pin your venue/)).toBeTruthy();
    expect(screen.getByLabelText('Add venue location')).toBeTruthy();
  });

  it('counts down while the vendor is on the way, then shows reached', async () => {
    const etaAt = new Date(Date.now() + 18 * 60_000 + 20_000).toISOString();
    const { rerender } = await wrap(
      <ProgressBanner booking={booking({ status: 'confirmed', progress: { status: 'on_the_way', at: new Date().toISOString(), etaAt } })} />,
    );
    expect(screen.getByText('Shree Ram Caterers is on the way')).toBeTruthy();
    expect(screen.getByText(/Reaching in about 18 min/)).toBeTruthy();
    await rerender(
      <SafeAreaProvider initialMetrics={metrics}>
        <ProgressBanner booking={booking({ status: 'confirmed', progress: { status: 'reached', at: new Date().toISOString(), etaAt: null } })} />
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('progress-reached')).toBeTruthy();
  });

  it('booking updates in the chat read naturally in both languages', () => {
    const t = i18n.getFixedT('en');
    expect(bookingEventText(t, { event: 'on_the_way', bookingId: 'b', minutes: 25 }, 'en')).toBe('Vendor is on the way: about 25 min');
    expect(bookingEventText(t, { event: 'expired', bookingId: 'b', why: 'not_paid' }, 'en')).toBe('The advance was not paid in time');
    expect(bookingEventText(i18n.getFixedT('hi'), { event: 'confirmed', bookingId: 'b' }, 'hi')).toBe('बुकिंग पक्की। अब फ़ोन नंबर दिख रहे हैं।');
  });
});
