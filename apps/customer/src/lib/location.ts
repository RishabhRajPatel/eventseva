// The venue pin, found on the phone itself: no Maps API key and nothing sent anywhere but our API.
// Android's geocoder turns an address into a pin; the GPS gives "where I am now".
import * as Location from 'expo-location';
import type { LatLng } from '@eventseva/app-shared';
import { CITY } from './config';

export type LocationProblem = 'denied' | 'off' | 'notFound' | 'failed';

export class LocationError extends Error {
  constructor(readonly problem: LocationProblem) {
    super(problem);
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Where the phone is now (asks for permission the first time). */
export async function currentPin(): Promise<LatLng> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') throw new LocationError('denied');
  if (!(await Location.hasServicesEnabledAsync())) throw new LocationError('off');
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
  } catch {
    throw new LocationError('failed');
  }
}

/** A typed address as a pin, looked up in our city first. */
export async function findAddress(address: string): Promise<LatLng> {
  let hits: Location.LocationGeocodedLocation[] = [];
  try {
    hits = await Location.geocodeAsync(`${address}, ${CITY.name}, India`);
  } catch {
    throw new LocationError('failed');
  }
  if (!hits.length) throw new LocationError('notFound');
  return { lat: round(hits[0].latitude), lng: round(hits[0].longitude) };
}

/** A readable address for a pin, to fill an empty address field ("Civil Lines, Prayagraj"). */
export async function addressOf(p: LatLng): Promise<string | null> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    if (!a) return null;
    const parts = [a.name, a.street, a.district ?? a.subregion, a.city].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
    return parts.join(', ') || null;
  } catch {
    return null;
  }
}
