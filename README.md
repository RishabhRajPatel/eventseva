# EventSeva

Event-services marketplace for Prayagraj: customers book halls, DJs, cooks, photographers and more for
weddings, birthdays and pujas; vendors run their business from a separate Partner app; the EventSeva team
approves vendors and handles money and complaints from an admin panel.

| Folder | What | Stack |
|---|---|---|
| `apps/backend` | API (all business rules) | NestJS 11, PostgreSQL 16, plain SQL |
| `apps/customer` | Customer app (Android first) | Expo SDK 58, expo-router |
| `apps/partner` | Partner app for vendors | Expo SDK 58, expo-router |
| `apps/admin` | Admin panel | Next.js 16 |
| `database/` | All tables explained (`tables.md`), the whole schema (`schema.sql`), migrations | PostgreSQL 16 |
| `packages/app-shared` | API client, types, theme, formatting, Cloudinary URLs | TypeScript |
| `packages/core` | Shared constants | TypeScript |
| `docs/API.md` | Every API route, error code and status | |
| `docs/DEPLOY.md` | Server setup with Docker, HTTPS, backups, smoke test | |
| `docs/PHONE_TEST.md` | Checklist for testing both apps on a real phone before a release | |
| `design/` | Design boards (open the `.dc.html` files in a browser) | |

## Run it locally

Needs Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install

# API (http://localhost:3000)
cd apps/backend
cp .env.example .env          # set DATABASE_URL; CLOUDINARY_URL for photo uploads
pnpm migrate                  # applies database/migrations
ADMIN_PASSWORD='a-long-password' pnpm create-admin you@example.com super   # prints the 2FA secret
pnpm build && pnpm start      # OTP codes are printed in this log while OTP_PROVIDER=console

# Admin panel (http://localhost:3001)
cd apps/admin && cp .env.example .env.local && pnpm dev

# Apps (Expo). EXPO_PUBLIC_PAYMENTS=dev shows a "Test payment" button instead of Razorpay.
cd apps/customer && cp .env.example .env && npx expo start
cd apps/partner  && cp .env.example .env && npx expo start
```

Razorpay checkout needs a development build (`npx expo run:android` or `eas build --profile development`); Expo Go
works for everything else.

## Checks

```bash
pnpm -r lint     # type checks (and eslint for admin)
pnpm -r test     # backend e2e tests need PostgreSQL on localhost (postgres/postgres)
```

## Play Store

- **Public pages** (served by the admin app; link them in the Play Console):
  - Privacy policy: `https://<admin-domain>/privacy`
  - Account deletion: `https://<admin-domain>/account-deletion`
  - Have the privacy text reviewed before launch, and set `NEXT_PUBLIC_SUPPORT_EMAIL`.
- **In-app account deletion:** Profile → Delete account, in both apps.
- **Builds** (`apps/customer` or `apps/partner`):

  ```bash
  npx eas-cli@latest login
  npx eas-cli@latest build --platform android --profile development   # APK for testing, incl. Razorpay
  npx eas-cli@latest build --platform android --profile preview       # APK to share with testers
  npx eas-cli@latest build --platform android --profile production    # .aab for the Play Store
  npx eas-cli@latest submit --platform android --profile production   # uploads to the internal testing track
  ```

  The first `eas build` links the app to an Expo project and creates the signing key. Keep that key
  (EAS stores it).
- **API URLs:** set `EXPO_PUBLIC_API_URL` in `eas.json` to the real HTTPS API before the preview and production
  builds. Release builds do not allow plain `http`.

## Push notifications (Firebase)

Every in-app notification (new request, payment, chat …) is also pushed to the phone. Until Firebase is set up,
the API prints pushes in its log and the apps simply skip push.

1. [console.firebase.google.com](https://console.firebase.google.com) → create a project (e.g. "EventSeva").
2. **Add the apps:**
   - Add an Android app with package `in.eventseva.app`, download `google-services.json`, and put it in `apps/customer/`.
   - Add another Android app with `in.eventseva.partner`, and put its `google-services.json` in `apps/partner/`.
   - These files are not secret.
3. **Server key:**
   - Project settings → Service accounts → Generate new private key.
   - Run `base64 -w0 key.json` and put the output in the server's `.env` as `FIREBASE_SERVICE_ACCOUNT`.
   - **This key is secret:** never commit it or put it in the apps.
4. Make new app builds (`eas build`), because push is part of the native app.

## How a booking works (customer ↔ vendor)

1. **Plan the event.** The customer adds the date, guests and venue. The venue can be pinned with "Find on map" (the
   phone's own geocoder turns the address into a pin) or "I'm at the venue" (GPS). No Google Maps API key is needed.
2. **Pick a vendor.**
   - Search can sort by distance from the venue (`sort=nearest`).
   - Before sending a request, the form shows "about 6.5 km, 20 min", and warns when the venue is beyond the vendor's
     usual range (they may charge for travel).
   - The customer can ask the vendor to arrive by a time.
3. **Request → accept → pay.**
   - Every step is a push notification and also a line in the pair's chat, so the whole story is in one place.
   - The chat opens automatically with the request.
   - Quick replies help with common questions.
   - Phone numbers, the venue address, the landmark and the pin are shared with the vendor only after the advance is paid.
4. **The evening before** (from 5 pm), both sides get a reminder:
   - the vendor's says where, how far and when to arrive;
   - the customer's asks them to pin the venue if it is missing.
5. **Event day.**
   - The vendor taps "Directions" (Google Maps from where they are).
   - They tap "On the way", with an ETA (their own or the estimate). The customer sees "reaching in about 18 min (5:40 pm)".
   - On arrival the vendor taps "Reached".
6. **Venue changed?** The customer edits it on the booking. Confirmed vendors get a push, and the new distance shows at once.

Distances are estimates: straight line × 1.3 for roads, at 25 km/h city speed. Vendors set where they start from and how
far they usually travel (Partner app → Business profile). Customers never see a vendor's exact location, only distances.

## Admin login security (two-factor)

- **Every admin login needs three things:** email, password, and a 6-digit code from an authenticator app
  (Google Authenticator or Authy).
- **Codes and locks:**
  - Each code works once.
  - 5 wrong attempts lock the account for 15 minutes.
  - Logout ends all of that admin's sessions.
- **Fresh code for sensitive actions:** refunds, payouts, bank details, CSV exports, blocking and featured grants ask
  for a fresh code even when logged in. After one good code, the next 5 minutes need none, in that same login only.
  A stolen session token alone therefore cannot move money or export customer data.
- **Lost phone:**
  - Each admin has 8 one-time recovery codes. `create-admin` prints them once; new ones are made under My security.
  - Using one sends the admin to My security with a warning.
- **Storage:** the 2FA secret is encrypted in the database (`BANK_DETAILS_KEY`). Recovery codes are stored only as keyed hashes.
- **Setup:** create admins with `ADMIN_PASSWORD='…' pnpm --filter @eventseva/backend create-admin <email> <role>`,
  using the same `BANK_DETAILS_KEY` as the API server.

## Security of URLs and links

- **Ids:** every id in a URL is a random UUID (not 1, 2, 3), checked for its format before any query runs.
  Every route also checks that the record belongs to the caller. Another user's id gives 404, and
  `apps/backend/test/url-security.spec.ts` tries this for every booking, event and chat route.
- **Tokens:** they travel only in the `Authorization` header, never in a URL, so they do not end up in logs or browser history.
- **Caching:** personal answers are `Cache-Control: no-store`. Only the public catalogue may be cached.
- **App deep links:**
  - A push notification can open a chat or booking only when its id is a real UUID.
  - The apps open outside links only from an allow-list: phone calls, Google Maps, our Play Store pages and Cloudinary
    (`isSafeExternalUrl` in app-shared).
- **Admin panel headers:**
  - a strict Content-Security-Policy;
  - `X-Frame-Options: DENY` (no clickjacking);
  - `Referrer-Policy: no-referrer`, so booking ids never leak to other sites;
  - HSTS.
- **API headers:** helmet sends `nosniff`, HSTS and no `X-Powered-By`. There is no CORS: browsers reach the API only through
  the admin panel's own `/api`.
- **HTTPS:** store builds refuse to build unless `EXPO_PUBLIC_API_URL` is `https://`.
- **Rate limits and payments:**
  - every route has a rate limit, and distance lookups a tighter one (20 a minute);
  - the payment webhook checks Razorpay's signature on the raw body.

## Before going live

- `NODE_ENV=production` refuses development settings. Set `BANK_DETAILS_KEY` (`openssl rand -base64 32`, never change it),
  long random `JWT_SECRET` and `OTP_PEPPER`, a real
  `OTP_PROVIDER` (SMS provider still to choose), and `PAYMENT_PROVIDER=razorpay` with the keys and webhook secret.
- Razorpay webhook: `POST /v1/payments/webhook`, event `payment.captured`.
- Secrets (Cloudinary, Razorpay, JWT) live only in the server's environment, never in the apps or in git.
