// Checks for anything that turns outside data (a push payload, a server field, a deep link) into a
// screen to open or a link to follow. Never trust such text as a path or a URL as it is.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Every id in the API is a random UUID: anything else (e.g. "../login") is refused. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** The only places the apps open outside themselves. */
const ALLOWED: RegExp[] = [
  /^tel:\+?\d{10,13}$/,
  /^https:\/\/www\.google\.com\/maps\/(dir|search)\/\?api=1&[\w%=&.,+-]+$/,
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=in\.eventseva\.(app|partner)$/,
  /^https:\/\/res\.cloudinary\.com\/[\w-]+\/[\w/.,-]+$/,
  // Signed 10-minute links to private KYC documents (admin panel only).
  /^https:\/\/api\.cloudinary\.com\/v1_1\/[\w-]+\/image\/download\?[\w%=&.-]+$/,
];

/** True only for phone calls, Google Maps, our Play Store pages and Cloudinary files. */
export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length < 2048 && ALLOWED.some((r) => r.test(url));
}
