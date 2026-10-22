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
| `packages/app-shared` | API client, types, theme, formatting, Cloudinary URLs | TypeScript |
| `packages/core` | Shared constants | TypeScript |
| `docs/API.md` | Every API route, error code and status | |
| `design/` | Design boards (open the `.dc.html` files in a browser) | |

## Run it locally

Needs Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install

# API (http://localhost:3000)
cd apps/backend
cp .env.example .env          # set DATABASE_URL; CLOUDINARY_URL for photo uploads
pnpm migrate
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

## Before going live

- `NODE_ENV=production` refuses development settings. Set `BANK_DETAILS_KEY` (`openssl rand -base64 32`, never change it),
  long random `JWT_SECRET` and `OTP_PEPPER`, a real
  `OTP_PROVIDER` (SMS provider still to choose), and `PAYMENT_PROVIDER=razorpay` with the keys and webhook secret.
- Razorpay webhook: `POST /v1/payments/webhook`, event `payment.captured`.
- Secrets (Cloudinary, Razorpay, JWT) live only in the server's environment, never in the apps or in git.
