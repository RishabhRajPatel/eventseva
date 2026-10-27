// How far a vendor travels to a venue, without a paid maps API: straight-line distance from the two
// pins, a road factor for Indian city roads, and an average city speed. Good enough for "about 12 km,
// about 35 min"; the apps link to Google Maps for turn-by-turn directions.

export interface Point {
  lat: number;
  lng: number;
}

/** Roads are rarely straight: typical detour over the straight line in Indian cities. */
export const ROAD_FACTOR = 1.3;
/** Average door-to-door speed with traffic (km/h), loading and parking not included. */
export const CITY_SPEED_KMPH = 25;

/** Straight-line (great-circle) distance in km. */
export function straightKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Travel {
  /** Estimated road distance, rounded to 0.5 km (1 decimal under 2 km). */
  roadKm: number;
  /** Estimated drive time in minutes, rounded up to 5. */
  minutes: number;
  /** The vendor's usual range, if they set one. */
  serviceRadiusKm: number | null;
  /** Further than the vendor usually goes: they may ask for travel charges. */
  outsideServiceArea: boolean;
}

export function travelBetween(from: Point | null, to: Point | null, serviceRadiusKm: number | null = null): Travel | null {
  if (!from || !to) return null;
  const road = straightKm(from, to) * ROAD_FACTOR;
  const roadKm = road < 2 ? Math.round(road * 10) / 10 : Math.round(road * 2) / 2;
  const minutes = Math.max(5, Math.ceil(((road / CITY_SPEED_KMPH) * 60) / 5) * 5);
  return { roadKm, minutes, serviceRadiusKm, outsideServiceArea: serviceRadiusKm !== null && roadKm > serviceRadiusKm };
}

/** A pin from two nullable numeric columns (pg returns numeric as a string). */
export const pointOf = (lat: unknown, lng: unknown): Point | null =>
  lat === null || lat === undefined || lng === null || lng === undefined ? null : { lat: Number(lat), lng: Number(lng) };

/** SQL for the straight-line km between two lat/lng pairs (same formula as straightKm). */
export const SQL_STRAIGHT_KM = (lat1: string, lng1: string, lat2: string, lng2: string) =>
  `(2 * 6371 * asin(least(1, sqrt(power(sin(radians(${lat2} - ${lat1}) / 2), 2) +
     cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians(${lng2} - ${lng1}) / 2), 2)))))`;

/** "On the way" and "reached" can be sent on the event day, or the evening before for long trips. */
export function progressAllowed(daysUntilEvent: number): boolean {
  return daysUntilEvent === 0 || daysUntilEvent === 1;
}

/** The day-before reminder goes out from this hour (India time). */
export const REMINDER_HOUR_IST = 17;
