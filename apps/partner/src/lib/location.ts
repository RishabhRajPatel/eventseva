// Where the vendor starts from, from the phone's GPS (only when they tap the button). It is never
// shown to customers: they only see distances.
import * as Location from 'expo-location';
import type { LatLng } from '@eventseva/app-shared';

export type LocationProblem = 'denied' | 'off' | 'failed';

export class LocationError extends Error {
  constructor(readonly problem: LocationProblem) {
    super(problem);
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

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
