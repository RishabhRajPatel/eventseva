# EventSeva API reference

Base URL: `http://localhost:3000` in development (`PORT` in `apps/backend/.env`). All routes are JSON.
Response types live in `packages/app-shared/src/types.ts`; the client in `packages/app-shared/src/api.ts`.
The source of truth is the controllers in `apps/backend/src/**/*.controller.ts`, and the e2e tests in
`apps/backend/test/*.spec.ts` show every route in use.

## Conventions

- **Auth:** `Authorization: Bearer <accessToken>`. App tokens last 15 min, and the client renews them with
  `POST /v1/auth/refresh`. Admin tokens last 8 h and are never renewed.
- **App split:** a login is either from the `customer` app or the `partner` app (`app` in otp/verify).
  - `/v1/partner/*` refuses customer-app tokens with **403 `PARTNER_APP_ONLY`**.
  - Chat behaves by app: a customer-app token talks as the customer, a partner-app token talks as the vendor.
- **Language:** send `Accept-Language: hi` or `en`. Category names come back in that language. The user's
  saved choice is `GET /v1/me → language`, changed with `PATCH /v1/me {language}` (Profile → Language).
  Login screens are English only.
- **Errors:**
  - Every error is `{"error": {"code": "SOME_CODE", "message": "Text to show", ...details}}`.
  - Show `message`; branch on `code`. Details are flat, for example `attemptsLeft` and `retryAfterSec`.
  - Common codes: `VALIDATION` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `RATE_LIMITED` 429.
- **Data formats:**
  - **Money** is integer **paise** (₹1 = 100). Never send amounts for bookings; the server prices them.
  - **Days** are `YYYY-MM-DD` India dates. Timestamps are ISO strings.
- **Paging:** `?page=N` returns `{items, page, hasMore}`, 20 per page unless noted.
- **Images:**
  - Media come as Cloudinary `publicId` with `width`, `height` and `blurhash`. Build URLs with
    `cardImage / wideImage / zoomImage / videoPoster / videoStream` from app-shared.
  - Cards must use `cardImage`, which fits the whole photo with a blurred fill and never crops.
  - Uploading (signed Cloudinary upload) is being built by the owner. Apps show an "Add photos" button
    that calls a stub `uploadMedia()` with a clear TODO.

## Auth (both apps)

| Route | Body → Response |
|---|---|
| `POST /v1/auth/otp/send` | `{phone}` → `{sent, expiresInSec: 300, resendAfterSec: 30}` |
| `POST /v1/auth/otp/verify` | `{phone, code, app: 'customer'\|'partner', deviceName?}` → `LoginResult` |
| `POST /v1/auth/refresh` | `{refreshToken}` → `TokenPair` (rotation) |
| `POST /v1/auth/logout` · `/logout-all` | → 204 |

- **Phone input:** `9876543210`, `+91 98765 43210` or `919876543210`. Only Indian mobiles are accepted (`INVALID_PHONE`).
- **otp/send errors:**
  - `OTP_TOO_SOON` 429 with `retryAfterSec`
  - `OTP_LIMIT` 429 (5 per phone per hour, 10 per IP per hour)
  - `OTP_LOCKED` 429 (15 minutes after 5 wrong codes)
- **otp/verify errors:**
  - `OTP_INVALID` 400 with `attemptsLeft`
  - `OTP_EXPIRED` 400 (also returned for a reused code)
  - `OTP_LOCKED` 429
  - `USER_BLOCKED` 403
- **What the apps do after login:**
  - `isNewUser` (or `user.name` null) → ask for the name (`PATCH /v1/me {name}`).
  - Partner app: `vendor` null → onboarding; `vendor.status` pending → waiting screen; approved → dashboard;
    rejected → show the reason and the edit flow.
- **Development:** with `OTP_PROVIDER=console` the code is printed in the backend log. With `REVIEW_PHONE` /
  `REVIEW_OTP` set, that number always takes that code.

## Profile and catalog

| Route | Notes |
|---|---|
| `GET /v1/me` | `Me` |
| `PATCH /v1/me` | `{name?, language?: 'en'\|'hi', cityId?}` → `Me`. `CITY_NOT_FOUND` |
| `GET /v1/cities` | `{items: City[]}` (only Prayagraj for now) |
| `GET /v1/categories` | `{items: Category[], language}`, 12 items, icons by `slug`: hall, dj, camera, halwai, catering, band, car, decor, hotel, bartender, makeup, other |

## Customer app

**Browse (no login needed)**

| Route | Notes |
|---|---|
| `GET /v1/vendors?category=dj&cityId=1&page=1&limit=20` | `Paged<VendorCard>`, approved only. Featured first, then by rating |
| `GET /v1/vendors/:id` | `VendorDetail` (address hidden; approved media only). `VENDOR_NOT_FOUND` 404 |
| `GET /v1/vendors/:id/reviews?page=` | `Paged<Review>` |
| `GET /v1/vendors/:id/availability?month=2026-11` | `{month, busy: [{day, slot}]}` for the date picker |

**Events and bookings (login)**

| Route | Notes |
|---|---|
| `POST /v1/events` | `{title, eventType, eventDate, cityId, venueAddress?, guestCount?, budgetPaise?}` → `EventSummary`. `EVENT_IN_PAST` |
| `GET /v1/events` | `{items: EventSummary[]}` with `confirmedCount`, `pendingCount`, `committedPaise` |
| `GET /v1/events/:id` | `EventSummary & {bookings: Booking[]}` |
| `POST /v1/bookings` | `{eventId, vendorId, serviceId \| packageId, slot: 'full'\|'day'\|'night', quantity?, note?}` → `Booking` |
| `GET /v1/bookings?eventId=&status=` | `{items: Booking[]}` |
| `GET /v1/bookings/:id` | `Booking` |
| `POST /v1/bookings/:id/pay` | → `PaymentOrder` for the Razorpay checkout |
| `POST /v1/bookings/:id/pay/verify` | `{razorpayOrderId, razorpayPaymentId, razorpaySignature}` → `Booking` (confirmed). `PAYMENT_INVALID` |
| `POST /v1/bookings/:id/pay/dev` | **Development only** (`PAYMENT_PROVIDER=fake`, 404 otherwise): pays without a checkout → `Booking` |
| `POST /v1/bookings/:id/cancel` | `{reason}` → `Booking` with `refundPaise` |
| `POST /v1/bookings/:id/review` | `{rating 1–5, comment?}`. Only when `completed`. `REVIEW_NOT_ALLOWED`, `REVIEW_EXISTS` |

- **Slot:** `full` = whole day, `day` = 10–4, `night` = 6–11. `quantity` is required for `COUNTED_UNITS`
  (`QUANTITY_REQUIRED`).
- **Booking request errors:** `SLOT_TAKEN` 409, `BOOKING_EXISTS` 409, `OWN_VENDOR`, `ITEM_NOT_FOUND`, `EVENT_NOT_FOUND`.
- **Payment:** the app shows the checkout with `keyId`, `orderId` and `amountPaise`, then calls verify.
  - Errors from `pay`: `BOOKING_BAD_STATUS` 409, `PAYMENT_TIME_OVER` 409.
  - Razorpay checkout needs a native build (`react-native-razorpay`). In Expo Go or with
    `EXPO_PUBLIC_PAYMENTS=dev`, show a "Test payment" button that calls `pay/dev`.
- **Cancel refunds:** before payment, nothing to refund. After payment the advance is refunded by days to the
  event: 15+ days 90%, 7–14 days 50%, under 7 days 0%. If the vendor cancels, the refund is 100%.

**Booking statuses and what the customer sees**

| Status | Customer sees | Action |
|---|---|---|
| `requested` | "Waiting for vendor", countdown to `respondBy` (24 h) | Cancel |
| `accepted` | "Pay advance ₹X", countdown to `payBy` (24 h) | Pay, Cancel |
| `confirmed` | "Confirmed", vendor phone shown | Call, Chat, Cancel (refund rule above) |
| `completed` | "Done" | Write review |
| `rejected` | Vendor said no (`cancelReason`) | Book another vendor |
| `expired` | No reply or not paid in time | Book another vendor |
| `cancelled_by_customer` / `cancelled_by_vendor` | `refundPaise`, if any | — |

- **Phones:** `vendor.phone` (customer side) and `customer.phone` (vendor side) stay null until `confirmed`.
- **Money shown:** `amountPaise` total, `advancePaise` paid in the app (25%), `balancePaise` paid to the vendor
  after the event.

**Saved, chat, help, notifications**

| Route | Notes |
|---|---|
| `GET /v1/shortlist` · `PUT /v1/shortlist/:vendorId` · `DELETE /v1/shortlist/:vendorId` | Saved vendors (heart) |
| `POST /v1/conversations` | `{vendorId}` → `{id}` (customer app only; get-or-create) |
| `GET /v1/conversations` | `{items: Conversation[]}` (both apps) |
| `GET /v1/conversations/:id/messages?beforeId=` | `{items: Message[] newest first, hasMore, phoneShared}`; marks as read |
| `POST /v1/conversations/:id/messages` | `{body}` → `Message` |
| `POST /v1/complaints` · `GET /v1/complaints` | `{bookingId?, subject, details}` (Help & support) |
| `GET /v1/notifications?beforeId=` | `{items, hasMore, unreadCount}` |
| `POST /v1/notifications/read` | `{ids?}`; no ids marks all as read |
| `POST /v1/devices` · `DELETE /v1/devices` | `{fcmToken, platform}` for push (when FCM is set up) |

- **Chat:** polls every 4–5 s while open. Phone numbers are masked (`••••••••••`) until a booking is confirmed
  (`phoneShared`). Show a hint: "Phone number is shared after booking".
- **Notifications:** `data.bookingId` or `data.conversationId` tells where tapping a notification opens.

## Partner app (all `/v1/partner/*` need a partner-app login)

| Route | Notes |
|---|---|
| `GET /v1/partner/vendor` | `OwnVendor` (all media with status, `missingForReview`). `VENDOR_NOT_FOUND` 404 = start onboarding |
| `POST /v1/partner/vendor` | `{businessName, categoryId, cityId, area?, address?, lat?, lng?, about?}` → `OwnVendor` (draft). `VENDOR_EXISTS` |
| `PATCH /v1/partner/vendor` | same fields, all optional. `VENDOR_UNDER_REVIEW` 409 while pending; `CATEGORY_LOCKED` once approved |
| `POST /v1/partner/vendor/submit` | draft or rejected → pending. `VENDOR_INCOMPLETE` with `missing[]` |
| `POST /v1/partner/services` · `PATCH`·`DELETE /v1/partner/services/:id` | `{title, description?, pricePaise ≥ 100, unit, minGuests?, maxGuests?}`, up to 30 |
| `POST /v1/partner/packages` · `PATCH`·`DELETE /v1/partner/packages/:id` | `{title, items: string[] (≤ 20), pricePaise}`, up to 20 |
| `GET /v1/partner/dashboard` | `PartnerDashboard` (home "Aaj") |
| `GET /v1/partner/bookings?status=` | `{items: Booking[]}` with `commissionPaise`, `payoutPaise`, `customer` |
| `GET /v1/partner/bookings/:id` | `Booking` |
| `POST /v1/partner/bookings/:id/accept` | holds the slot; customer then has 24 h to pay. `SLOT_TAKEN`, `BOOKING_EXPIRED`, `VENDOR_NOT_ACTIVE` |
| `POST /v1/partner/bookings/:id/reject` | `{reason}` |
| `POST /v1/partner/bookings/:id/cancel` | `{reason}`; accepted or confirmed; the customer gets 100% back |
| `GET /v1/partner/calendar?month=2026-11` | `{month, items: CalendarEntry[]}`; days not listed are free |
| `POST /v1/partner/calendar/block` · `DELETE …/block` | `{day, slot}` → 204. `SLOT_TAKEN`, `DATE_IN_PAST` |
| `GET /v1/partner/earnings?month=` | `Earnings` (Kamai screen) |
| `GET /v1/partner/reviews` · `POST /v1/partner/reviews/:id/reply` | `{reply}` |

- **Vendor statuses:**
  - `draft`: fill the profile, then Submit.
  - `pending`: "Under review", nothing editable.
  - `approved`: live.
  - `rejected`: show `rejectReason`, then edit and resubmit.
  - `on_hold`: hidden from customers; contact support.
- **Requests:** a vendor must answer a request within 24 h (`respondBy`), otherwise it expires.
- **Payout:** each payout is the advance minus EventSeva's commission. It is paid the day after the event,
  or 3 days after for new vendors. The rest of the price (`balancePaise`) is collected from the customer
  at the event.

## Admin panel (`/v1/admin/*`, admin token)

- **Login:** `POST /v1/admin/login {email, password, totp}` → `{accessToken, expiresInSec, admin{id, email, role}}`.
  Any wrong part returns `ADMIN_LOGIN_FAILED` 401. Create admins with `pnpm --filter @eventseva/backend create-admin`.
- **Roles:**
  - `super`: everything.
  - `verifier`: vendors and media.
  - `support`: bookings, complaints, users, reviews; can view vendors.
  - `finance`: bookings, payouts.
  - A route the role cannot use returns 403 `FORBIDDEN`. Hide nav items by role.

| Route | Roles | Notes |
|---|---|---|
| `GET /v1/admin/me` | all | |
| `GET /v1/admin/dashboard` | all | counts, `monthGmvPaise`, `monthCommissionPaise`, `bookingsByStatus`, `last14Days[{day, bookings}]`, `topCategories` |
| `GET /v1/admin/vendors?status=pending&page=` | verifier, support | approval queue (oldest first) |
| `GET /v1/admin/vendors/:id` | verifier, support | full vendor + `owner{phone}` + `history[]` + all media |
| `POST /v1/admin/vendors/:id/approve` · `/reject {reason}` · `/hold {reason}` | verifier | `VENDOR_BAD_STATUS` 409 |
| `GET /v1/admin/bookings?status=&q=&page=` · `GET /v1/admin/bookings/:id` | support, finance | `q` matches vendor name, phone or booking id; detail has `payments[]` and `payout` |
| `GET /v1/admin/payouts?status=&due=true&page=` | finance | |
| `POST /v1/admin/payouts/:id/mark-paid {reference}` · `/hold {reason}` | finance | records the bank UTR |
| `GET /v1/admin/complaints?status=&page=` · `POST /v1/admin/complaints/:id {status, resolution?}` | support | resolving requires `resolution` |
| `GET /v1/admin/users?q=&page=` · `POST …/:id/block {reason}` · `POST …/:id/unblock` | support | block logs the user out everywhere |
| `GET /v1/admin/media?status=pending&page=` · `POST …/:id/approve` · `POST …/:id/reject {reason}` | verifier | photo moderation |
| `POST /v1/admin/reviews/:id/hide {reason}` | support | |

## Running locally

```bash
# Postgres 16 running; then in apps/backend:
cp .env.example .env            # set DATABASE_URL
pnpm migrate
ADMIN_PASSWORD='a-long-password' pnpm create-admin you@example.com super   # prints the 2FA secret
pnpm build && pnpm start        # API on :3000; OTP codes print in this log
```
