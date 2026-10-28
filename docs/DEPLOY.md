# Deploying EventSeva

The server side is three parts: PostgreSQL 16, the API (`apps/backend/Dockerfile`) and the admin panel
(`apps/admin/Dockerfile`, which also serves the public privacy and account-deletion pages). The apps are
built separately with EAS and only need the API's HTTPS address.

`docker-compose.yml` runs all three on one machine. That is enough for launch in Prayagraj; the same
images also run on Railway, Render or a cloud VM with a managed Postgres.

## What you need first

- A Linux server in India (2 vCPU, 4 GB RAM is plenty to start) with Docker and Docker Compose.
- Two DNS names pointing at it, for example `api.eventseva.in` and `admin.eventseva.in`.
- The accounts and keys listed under "Settings" below. Keep them in a password manager, never in git or chat.

## Settings (`apps/backend/.env`)

Copy `apps/backend/.env.example` to `apps/backend/.env` on the server and fill it in. Every setting is
explained in that file. In production:

| Setting | Value |
|---|---|
| `NODE_ENV` | `production`. This refuses console OTP, fake payments and weak secrets. |
| `JWT_SECRET`, `OTP_PEPPER` | Long random strings: `openssl rand -base64 48`, a different one each. |
| `BANK_DETAILS_KEY` | `openssl rand -base64 32`. **Never change it** and back it up: bank accounts and admin 2FA cannot be read without it. |
| `OTP_PROVIDER` | The SMS provider, once chosen. |
| `PAYMENT_PROVIDER` | `razorpay`, with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. |
| `CLOUDINARY_URL` | From Cloudinary → Settings → API Keys. |
| `FIREBASE_SERVICE_ACCOUNT` | See "Push notifications" in the README. |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_GSTIN` | Exactly as registered; they appear on commission invoices. |
| `TRUST_PROXY` | `1` behind Caddy or Nginx, so rate limits see each user's real IP. |
| `REVIEW_PHONE`, `REVIEW_OTP` | The Google Play reviewer's demo login (optional). |

`DATABASE_URL` is set by `docker-compose.yml`. The database password comes from `POSTGRES_PASSWORD`,
which you pass when starting compose (or keep in a root `.env` file next to `docker-compose.yml`, which git
ignores). `SUPPORT_EMAIL` sets the address shown on the public pages.

## Start it

```bash
git clone https://github.com/RishabhRajPatel/eventseva.git && cd eventseva
cp apps/backend/.env.example apps/backend/.env    # then fill it in
export POSTGRES_PASSWORD='<long random password>'
docker compose up -d --build
docker compose ps                                  # all three "healthy" after about a minute
curl http://localhost:3000/health                  # {"ok":true}
```

- **Migrations** run automatically each time the API starts (`pnpm migrate`, then the server). Each one
  runs once, inside a transaction: if one fails, nothing of it is applied and the API does not start, so
  `docker compose logs api` shows the error. Take a backup before updates that add migrations.
- **First admin:** run this once, then scan the printed 2FA secret with an authenticator app and keep the
  8 recovery codes somewhere safe.

  ```bash
  docker compose exec -e ADMIN_PASSWORD='<at least 12 characters>' api pnpm create-admin you@eventseva.in super
  ```

## HTTPS and domains

Put a reverse proxy in front. With Caddy, which gets and renews certificates by itself:

```
api.eventseva.in {
	reverse_proxy 127.0.0.1:3000
}
admin.eventseva.in {
	reverse_proxy 127.0.0.1:3001
}
```

Then:

- Set `TRUST_PROXY=1` and restart the API (`docker compose up -d api`).
- **Razorpay webhook:** Dashboard → Webhooks → `https://api.eventseva.in/v1/payments/webhook`, events
  `payment.captured`, `refund.processed` and `refund.failed`, with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- **Play Console:** privacy policy `https://admin.eventseva.in/privacy`, account deletion
  `https://admin.eventseva.in/account-deletion`.
- **Apps:** set `EXPO_PUBLIC_API_URL` to `https://api.eventseva.in` in both `eas.json` files, then build.

## Updates

```bash
git pull
docker compose up -d --build     # rebuilds, runs new migrations, swaps the containers
docker compose logs -f api       # watch the start
```

To go back, check out the previous commit and run the same command. A migration that already ran stays;
every migration has a `migrate:down` section if one ever has to be undone by hand.

## Backups

The database is the only thing to back up on the server (photos and documents live in Cloudinary).

```bash
# Every night, keep 14 days (crontab -e):
0 2 * * * cd /path/to/eventseva && docker compose exec -T db pg_dump -U eventseva -Fc eventseva > /backups/eventseva-$(date +\%F).dump && find /backups -name 'eventseva-*.dump' -mtime +14 -delete
```

- Copy `/backups` to a second place (another server or cloud storage) and keep `BANK_DETAILS_KEY` with it,
  in the password manager.
- **Test a restore** once a month on a spare machine:

  ```bash
  docker compose exec -T db createdb -U eventseva restore_test
  docker compose exec -T db pg_restore -U eventseva -d restore_test < /backups/eventseva-<date>.dump
  ```

## Run locally or on a test server

The same compose file runs a test stack. In `apps/backend/.env` set `NODE_ENV=development`,
`OTP_PROVIDER=console` and `PAYMENT_PROVIDER=fake`; OTP codes then appear in `docker compose logs api`,
and the apps show a "Test payment" button. Start with `BIND=0.0.0.0` to reach it from a phone on the same
Wi-Fi (see `docs/PHONE_TEST.md`).

## Smoke test

After a deploy to a **test** stack, run the end-to-end smoke test. It signs up a vendor, approves it, books,
pays, extends, checks out a cart, cancels and checks the admin reports: 34 checks over HTTP, like the apps.
It creates real rows, so it only works with the development settings above and cannot pass against
production.

```bash
cd apps/backend
SMOKE_API_URL=http://localhost:3000 \
SMOKE_ADMIN_EMAIL=you@eventseva.in SMOKE_ADMIN_PASSWORD='…' SMOKE_ADMIN_TOTP_SECRET='<secret from create-admin>' \
SMOKE_CLOUDINARY_SECRET='<api_secret from CLOUDINARY_URL>' \
pnpm smoke
```

It reads OTP codes from `docker compose logs api`; set `SMOKE_LOGS` to another command if the API runs
elsewhere. It uses new phone numbers each run, so it can be repeated on the same database. If logins start
failing after several runs, raise the `OTP_MAX_PER_IP_*` limits on the test stack.

## Checks before each release

- CI is green on GitHub (Actions tab): lint and tests for every package.
- Smoke test passes on the test stack.
- `docs/PHONE_TEST.md` done on a real phone.
