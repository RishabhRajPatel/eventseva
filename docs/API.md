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
- **Booking state:** every booking view has `state`, kept by the database: `pending_vendor`, `awaiting_payment`,
  `confirmed`, `in_progress`, `return_pending`, `completed`, `cancelled`, `expired` or `disputed` (`draft` is
  reserved). `status` and `stage` stay as before. A change that lost a race with another one gets
  `BOOKING_BAD_TRANSITION` 409: refresh and try again.
- **Data formats:**
  - **Money** is integer **paise** (₹1 = 100). Never send amounts for bookings; the server prices them.
  - **Days** are `YYYY-MM-DD` India dates. Timestamps are ISO strings.
- **Paging:** `?page=N` returns `{items, page, hasMore}`, 20 per page unless noted.
- **Caching:** public GETs send `Cache-Control: public` (cities and categories 5 min; vendor search and
  vendor page 30 s; reviews and offers 1 min) with `Vary: Accept-Language` and an ETag, so repeat fetches are
  tiny 304s. Answers over 1 KB are gzipped.
- **Images:**
  - Media come as Cloudinary `publicId` with `width`, `height` and `blurhash`. Build URLs with
    `cardImage / wideImage / zoomImage / videoPoster / videoStream` from app-shared.
  - Cards must use `cardImage`, which fits the whole photo with a blurred fill and never crops.
  - Uploading is a signed direct upload to Cloudinary (see "Photos, videos and documents" under Partner app).
    The API secret stays on the server.

## Auth (both apps)

| Route | Body → Response |
|---|---|
| `POST /v1/auth/otp/send` | `{phone}` → `{sent, expiresInSec: 300, resendAfterSec}`. `resendAfterSec` grows with each code: 30, 60, 120, 300, 600; it is back to 30 after a successful login. Use it for the resend countdown |
| `POST /v1/auth/otp/verify` | `{phone, code, app: 'customer'\|'partner', deviceName?}` → `LoginResult` |
| `POST /v1/auth/refresh` | `{refreshToken}` → `TokenPair` (rotation) |
| `POST /v1/auth/logout` · `/logout-all` | → 204 |

- **Phone input:** `9876543210`, `+91 98765 43210` or `919876543210`. Only Indian mobiles are accepted (`INVALID_PHONE`).
- **otp/send errors:**
  - `OTP_TOO_SOON` 429 with `retryAfterSec`
  - `OTP_LIMIT` 429 with `retryAfterSec` and `retryAt`.
    - Limits (defaults, set in `.env`): per phone 5 per hour and 5 per 24 hours; per IP 5 per hour and 5 per
      24 hours.
    - All windows are **rolling** ("the last 24 hours"), not calendar days, so midnight resets nothing.
    - `retryAt` is when the oldest counted code leaves the window.
    - Behind a proxy, set `TRUST_PROXY` so the real user IP is counted.
  - `OTP_LOCKED` 429 (15 minutes after 5 wrong codes)
  - `OTP_SERVICE_BUSY` 503: the daily SMS budget is used up. New numbers wait; registered users can still log in until 150% of the budget.
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
| `DELETE /v1/me` | `{confirm: 'DELETE'}` → 204. Deletes the account (Google Play requirement). `ACCOUNT_HAS_ACTIVE_BOOKINGS` 409 (with `bookings` count), `ACCOUNT_HAS_PENDING_PAYOUT` 409 |
| `GET /v1/cities` | `{items: City[]}` (only Prayagraj for now) |
| `GET /v1/categories` | `{items: Category[], language}`, active categories in admin order. Today: DJ & Sound, Lighting & Decoration, Cook & Catering, Bartan & Kitchen Equipment, Tent & Furniture, Wedding & Event Planners, Photography & Entertainment. Draw `icon` (one of `CATEGORY_ICONS` in `@eventseva/core`, unknown → `other`); never hard-code slugs, because admins add categories |

## Customer app

**Browse (no login needed)**

| Route | Notes |
|---|---|
| `GET /v1/vendors?category=dj&cityId=1&q=raj&page=1&limit=20&lat=&lng=&sort=` | `Paged<VendorCard>`, approved only. `q` searches name and area. Featured first, then by rating. With the event venue's `lat`/`lng`, every card has `distanceKm` (estimated by road, nearest 0.5 km; null when the vendor has no pin) and `serviceRadiusKm`, and `sort=nearest` puts the closest first |
| `GET /v1/vendors/:id` | `VendorDetail` (address and `location` hidden: customers only ever see a distance; `serviceRadiusKm` = how far they usually travel; approved media only). `VENDOR_NOT_FOUND` 404 |
| `GET /v1/vendors/:id/reviews?page=` | `Paged<Review>` |
| `GET /v1/vendors/:id/travel?lat=&lng=` | `{travel: Travel \| null}`: how far this vendor would travel to the venue, before booking (null when the vendor has no pin) |
| `GET /v1/vendors/:id/availability?month=2026-11` | `{month, busy: [{day, slot}]}` for the date picker |

**Events and bookings (login)**

| Route | Notes |
|---|---|
| `POST /v1/events` | `{title, eventType, eventDate, cityId, venueAddress?, venueLandmark?, venueLat?, venueLng?, guestCount?, budgetPaise?}` → `EventSummary` (with `venueLocation {lat, lng}` and `venueLandmark`). The pin comes from the address (geocoded on the phone) or the phone's location; send both numbers. `EVENT_IN_PAST`, `DATE_TOO_FAR` (more than 2 years ahead, with `lastDay`) |
| `GET /v1/events` | `{items: EventSummary[]}` with `confirmedCount`, `pendingCount`, `committedPaise` |
| `GET /v1/events/:id` | `EventSummary & {bookings: Booking[]}` |
| `PATCH /v1/events/:id` | `{title?, venueAddress?, venueLandmark?, venueLat?, venueLng?, guestCount?, budgetPaise?}`; `null` clears. The date cannot change (400). A venue change adds a chat line for every open booking and pushes `venue_updated` to confirmed vendors |
| `POST /v1/bookings` | `{eventId, vendorId, serviceId \| packageId, slot: 'full'\|'day'\|'night', quantity?, note?, arriveBy?: 'HH:MM'}` → `Booking`. Opens the chat with the vendor (a "Booking requested" line) |
| `GET /v1/bookings?eventId=&status=` | `{items: Booking[]}` |
| `GET /v1/bookings/:id` | `Booking` |
| `POST /v1/bookings/:id/pay` | → `PaymentOrder` for the Razorpay checkout |
| `POST /v1/bookings/:id/pay/verify` | `{razorpayOrderId, razorpayPaymentId, razorpaySignature}` → `Booking` (confirmed). `PAYMENT_INVALID` |
| `POST /v1/bookings/:id/pay/dev` | **Development only** (`PAYMENT_PROVIDER=fake`, 404 otherwise): pays without a checkout → `Booking` |
| `POST /v1/bookings/:id/cancel` | `{reason}` → `Booking` with `refundPaise` |
| `POST /v1/bookings/:id/coupon` · `DELETE /v1/bookings/:id/coupon` | `{code}` (any case) → `Booking` with `discountPaise`, `couponCode`, `payNowPaise`. Only before paying. Errors: `COUPON_INVALID`, `COUPON_NOT_APPLICABLE` (`reason`: `min_amount` with `minAmountPaise`, `category`, `first_booking`, `zero`), `COUPON_ALREADY_USED`, `COUPON_USED_UP`, `COUPON_NOT_ALLOWED` |
| `GET /v1/offers` | No login. `{items: Offer[]}`: public coupons that can still be used, for the home banner and an "Offers" list on the payment screen |
| `POST /v1/bookings/:id/review` | `{rating 1–5, comment?}`. Only when `completed`. `REVIEW_NOT_ALLOWED`, `REVIEW_EXISTS` |

- **Slot:** `full` = whole day, `day` = 10–4, `night` = 6–11. `quantity` is required for `COUNTED_UNITS`
  (`QUANTITY_REQUIRED`).
- **Booking request errors:** `SLOT_TAKEN` 409, `BOOKING_EXISTS` 409, `OWN_VENDOR`, `ITEM_NOT_FOUND`, `EVENT_NOT_FOUND`, and:
  - `TOO_LATE_TO_BOOK` 409: the event day starts in less than 2 hours, so the vendor could not reply in time.
  - `TOO_MANY_OPEN_REQUESTS` 429 (`max`, 15): too many requests still waiting for a reply.
  - `QUANTITY_OUT_OF_RANGE` 400 (`min`, `max`, either may be null): the guest count is outside the service's min / max guests (per plate / per person only).
- **Deadlines:** `respondBy` is 24 h after the request and `payBy` 24 h after acceptance, but both are cut short so that
  everything finishes before the event day starts (midnight, India); the vendor's reply deadline ends 1 hour before that.
- **Vendor paused or blocked:** requests waiting for a reply become `rejected` and unpaid acceptances `cancelled_by_vendor`,
  with a notification; confirmed bookings stay.
- **Distance and event day (both apps):** every `Booking` has
  - `travel {roadKm, minutes, serviceRadiusKm, outsideServiceArea}` (null until both pins exist): estimated from
    the vendor's pin and the venue pin (straight line × 1.3, 25 km/h); show "about".
  - `event.venueLocation` and `event.venueLandmark` (the vendor sees them, like the address, only once paid),
    and for the vendor `directionsUrl` (Google Maps directions from wherever the phone is).
  - `arriveBy` ('HH:MM') and `progress {status: on_the_way | reached, at, etaAt}`.
  - The evening before (from 5 pm), both sides get one `booking_reminder` push with the trip and arrival time.
- **Text fields:** every string in a request body is trimmed first (except passwords), so a reason or title made of spaces fails validation.
- **Payment:** the app shows the checkout with `keyId`, `orderId` and `amountPaise`, then calls verify.
  - With a coupon, `amountPaise` is `payNowPaise`: the advance minus the discount.
  - EventSeva pays the discount. The vendor's payout and the balance paid at the event do not change.
  - Changing the coupon after opening the checkout makes a new order; an old order that still gets paid is refunded automatically.
  - Cancellation refunds are worked out on what was actually paid.
  - Errors from `pay`: `BOOKING_BAD_STATUS` 409, `PAYMENT_TIME_OVER` 409.
  - Razorpay checkout needs a native build (`react-native-razorpay`). In Expo Go or with
    `EXPO_PUBLIC_PAYMENTS=dev`, show a "Test payment" button that calls `pay/dev`.
- **Cancel refunds:** before payment, nothing to refund. After payment the advance is refunded by days to the
  event: 15+ days 90%, 7–14 days 50%, under 7 days 0%. If the vendor cancels, the refund is 100%.
  - **Refunds are queued:** they are saved with the cancellation and sent to Razorpay right after it,
    retried for about a day if Razorpay is down (never twice: each refund carries its queue id in
    `notes.refund_ref`). After 8 failed tries the team gets a `refund_failed` system alert.
  - **The vendor's share of a late cancellation:** the part of the advance the customer does not get back,
    minus EventSeva's commission, is paid to the vendor on the normal schedule after the original event day.

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
- **Venue:** `event.guestCount` is always shown. The vendor sees `event.venueAddress` only once the booking is
  `confirmed`.
- **Chat:** `conversationId` is the chat between the two, or null if there is none yet.
- **Other fields:** `vendor.categorySlug` is used for the icon. `reviewed` tells whether a completed booking already has a review.
- **Money shown:** `amountPaise` total, `advancePaise` paid in the app (25%), `balancePaise` paid to the vendor
  after the event.

**Saved, chat, help, notifications**

| Route | Notes |
|---|---|
| `GET /v1/shortlist` · `PUT /v1/shortlist/:vendorId` · `DELETE /v1/shortlist/:vendorId` | Saved vendors (heart) |
| `POST /v1/conversations` | Customer app: `{vendorId}`. Partner app: `{bookingId}` (only its own customers). → `{id}` (get-or-create) |
| `GET /v1/conversations` | `{items: Conversation[]}` (both apps); `lastKind` / `lastData` say when the last line is a booking update |
| `GET /v1/conversations/:id/messages?beforeId=` | `{items: Message[] newest first, hasMore, phoneShared}`; marks as read. `kind: 'booking'` lines are automatic booking updates: show them centred, translated from `data.event` (`requested`, `accepted`, `confirmed`, `rejected`, `cancelled_by_customer`, `cancelled_by_vendor`, `expired`, `on_the_way` with `minutes`/`etaAt`, `reached`, `venue_updated`) and `data.bookingId`; `senderId` is null for system lines |
| `POST /v1/conversations/:id/messages` | `{body}` → `Message`. At most 20 per minute per person: `TOO_MANY_MESSAGES` 429. Before a confirmed booking, phone numbers (also in Hindi digits or split up), e-mails and WhatsApp / Telegram links are hidden |
| `POST /v1/complaints` · `GET /v1/complaints` | `{bookingId?, subject, details}` (Help & support) |
| `GET /v1/notifications?beforeId=` | `{items, hasMore, unreadCount}` |
| `POST /v1/notifications/read` | `{ids?}`; no ids marks all as read |
| `POST /v1/devices` · `DELETE /v1/devices` | `{fcmToken, platform}`. Registers the phone's FCM token for this app (customer or partner, from the login). Pushes carry `data.kind`, `data.bookingId` / `data.conversationId`, `data.notificationId`; Android channels `bookings` and `chat` |

- **Chat:** polls every 4–5 s while open. Phone numbers are masked (`••••••••••`) until a booking is confirmed
  (`phoneShared`). Show a hint: "Phone number is shared after booking".
- **Notifications:** `data.bookingId` or `data.conversationId` tells where tapping a notification opens.

## Partner app (all `/v1/partner/*` need a partner-app login)

| Route | Notes |
|---|---|
| `GET /v1/partner/vendor` | `OwnVendor` (all media with status, `missingForReview`). `VENDOR_NOT_FOUND` 404 = start onboarding |
| `POST /v1/partner/vendor` | `{businessName, categoryId, cityId, area?, address?, lat?, lng?, about?, serviceRadiusKm?}` → `OwnVendor` (draft). `VENDOR_EXISTS`. `lat`/`lng` = where the vendor starts from (never shown to customers); `serviceRadiusKm` 1–500 or null |
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
| `POST /v1/partner/bookings/:id/progress` | `{status: 'on_the_way'\|'reached', etaMinutes?}` → `Booking`. Confirmed bookings, on the event day or the evening before (`PROGRESS_NOT_ALLOWED` 409). Without `etaMinutes` the estimate is used. The customer gets a push and a chat line |
| `GET /v1/partner/calendar?month=2026-11` | `{month, items: CalendarEntry[]}`; days not listed are free |
| `POST /v1/partner/calendar/block` · `DELETE …/block` | `{day, slot}` → 204. `SLOT_TAKEN`, `DATE_IN_PAST`, `DATE_TOO_FAR` |
| `GET /v1/partner/earnings?month=` | `Earnings` (Kamai screen) |
| `GET /v1/partner/featured` | `FeaturedOverview`: current featured end date, plans (7 days ₹499 and 30 days ₹1,499 by default, set by admin), history |
| `POST /v1/partner/featured/plans/:planId/order` | → `FeaturedOrder` for the Razorpay checkout. Live vendors only (`VENDOR_NOT_ACTIVE`) |
| `POST /v1/partner/featured/verify` | `{razorpayOrderId, razorpayPaymentId, razorpaySignature}` → `FeaturedOverview`. Days add on top of any current featured period |
| `POST /v1/partner/featured/purchases/:id/pay/dev` | **Development only** (`PAYMENT_PROVIDER=fake`) |
| `GET /v1/partner/reviews` · `POST /v1/partner/reviews/:id/reply` | `{reply}` |
| `GET /v1/partner/bank-account` · `PUT /v1/partner/bank-account` | `{holderName, accountNumber (9–18 digits), ifsc, upiId?}` → `{account: BankAccount}`. Only the last 4 digits come back; saving resets `status` to `pending` |

**Photos, videos and documents (signed Cloudinary upload)**

| Route | Notes |
|---|---|
| `POST /v1/partner/uploads/sign` | `{kind: 'photo'\|'video'\|'document'}` → `UploadSignature`. `UPLOAD_NOT_CONFIGURED` 503 when the server has no `CLOUDINARY_URL` |
| `GET /v1/partner/media` | `{items: Media[], limits: {photos: 30, videos: 5}}` |
| `POST /v1/partner/media` | `{publicId, version, signature, type, width, height, bytes, etag, durationSec?, blurhash?}` (from Cloudinary's response) → `Media` (pending) |
| `DELETE /v1/partner/media/:id` · `POST /v1/partner/media/:id/cover` · `PUT /v1/partner/media/order {ids}` | |
| `GET /v1/partner/documents` · `POST /v1/partner/documents` | `{publicId, version, signature, docType: aadhaar\|pan\|gst\|shop_photo, format, last4?}`; Aadhaar needs `last4`. `format` is `jpg`, `jpeg`, `png` or `pdf` (a PDF is uploaded as is, up to 10 MB) |

- **Upload steps:**
  1. Call `sign`.
  2. POST multipart to `uploadUrl` with `file`, `api_key` = `apiKey`, `signature`, and every key/value in
     `params` unchanged.
  3. Send Cloudinary's `public_id`, `version`, `signature`, `width`, `height`, `bytes`, `etag` (and `duration`
     for video) to `POST /v1/partner/media`.
- **Server checks:** the server verifies Cloudinary's response signature and that the file is in the vendor's
  own folder.
- **Errors:** `UPLOAD_INVALID`, `MEDIA_DUPLICATE` 409 (same file again), `FILE_TOO_BIG` (photo 15 MB, video
  100 MB, document 10 MB), `VIDEO_TOO_LONG` (2 min), `LIMIT_REACHED`.
- **Moderation:** new media is `pending` until an admin approves it. The first photo becomes the cover.
  At least one photo (not rejected) is needed before Submit (`missingForReview` has `photos`).
- **Documents** are private files. Only the server can make a 10-minute link, for admin verifiers.

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

## Rentals: tent house, bartan, furniture, equipment

Vendors list their own rental items; customers pick items and quantities for their dates. Stock is
counted per item over time (setup, pickup and cleaning time included), so two customers can never get
the same units. A rental booking then goes through the usual accept → advance → confirmed flow, plus
delivery steps.

**Partner app: items** (only the vendor's own; another vendor's id is 404)

| Route | Notes |
|---|---|
| `GET /v1/partner/item-categories` | `{items: ItemCategory[]}`: six defaults (`tent_decor`, `furniture`, `cooking`, `dining`, `serving`, `equipment`) and the vendor's own |
| `POST /v1/partner/item-categories` · `DELETE …/:id` | `{nameEn, nameHi?}` (up to 30). `CATEGORY_EXISTS` 409. Deleting moves its items to "Other event equipment" |
| `GET /v1/partner/inventory?q=&categoryId=` | `{items: InventoryItem[]}` with `availableNow` (free right now) and `openBookings` |
| `POST /v1/partner/inventory` | `{name, categoryId, rentPaise ≥ 100, totalQty, unit?, rentPer?: booking\|day, repairQty?, depositPaise?, damagePaise?, missingPaise?, minQty?, maxQty?, minDays?, maxDays?, quality?: basic\|standard\|premium\|custom, qualityLabel?, condition?: new\|good\|used\|needs_repair, description?, attributes?, isActive?}` → `InventoryItem`. `ITEM_EXISTS` 409 (same name), `CATEGORY_NOT_FOUND`, `LIMIT_REACHED` (2,000 items) |
| `GET`·`PATCH /v1/partner/inventory/:id` | Same fields, all optional. Changes apply to new bookings only; booked lines keep their own copy (`item_snapshot`). Lowering stock below what bookings hold at the busiest moment ahead: `STOCK_COMMITTED` 409 with `committed` and `minTotalQty`. `needs_repair` or `isActive: false` stops new bookings |
| `DELETE /v1/partner/inventory/:id` | → `{result: 'deleted'\|'archived', openBookings}`. An item that bookings or stock records point to is archived (hidden, history kept); its bookings still go ahead |
| `GET /v1/partner/inventory/:id/movements` | Stock history: `dispatch`, `return`, `damaged`, `missing`, `repaired`, `added`, `removed` |
| `GET`·`POST /v1/partner/inventory/:id/blocks` · `DELETE …/blocks/:blockId` | `{from, until, qty, note}` (ISO with time zone): keep stock back for those times. `NOT_AVAILABLE` 409 when that much is not free |
| `GET`·`PUT /v1/partner/rental-settings` | `{deliveryFeePaise, travelFreeKm?, travelPerKmPaise?, minOrderPaise?, taxPercent?, leadTimeHours?, setupMin?, dismantleMin?, bufferAfterMin?, approval?: vendor\|auto, instructions?}` |
| `POST /v1/partner/media` with `itemId` | A photo of that item (up to 8 per item, reviewed like gallery photos, never the cover) |

**Customer app**

| Route | Notes |
|---|---|
| `GET /v1/vendors/:id/rentals?from=&until=&q=&categoryId=` | Public. `RentalCatalogue`: `serviceId` to book under, settings, categories, active items with approved photos; with `from`/`until` each item has `available` for those times |
| `POST /v1/quotes` | `{eventId, serviceId, startsAt, endsAt, lines: [{itemId, qty}]}` → `Quote`: rent × qty (× days for per-day items), delivery, GST, total, advance, balance and the refundable deposit (paid apart). Nothing is held |
| `POST /v1/engine-bookings` | Same body (+ `note`), header `Idempotency-Key` (8–64 letters, digits, `-`, `_`): the same key returns the same booking. → `{id}`. Holds the stock until the vendor answers |
| `GET /v1/bookings/:id/rental` | `RentalView`: lines as booked, counts at each step, photos, charges, deposit |
| `POST /v1/bookings/:id/pay?part=deposit` · `?part=balance` | Confirmed rentals and car trips: the security deposit / the balance through the same checkout (`/pay/verify`, `/pay/dev` take `part` too). The balance is the rest of the price plus agreed charges the deposit did not cover (`balanceDuePaise` in the rental / trip view); it can still be paid after the booking completed, and is then added to the vendor's payout. `NOTHING_TO_PAY` 409 |
| `POST /v1/bookings/:id/charges/:chargeId` | `{decision: 'accept'\|'dispute', note}` (a dispute needs a note). `CHARGE_ALREADY_ANSWERED` 409. Unanswered charges count as accepted after 48 h |

Times are ISO with a time zone. Rules: notice (`TOO_SOON`), shortest and longest rental
(`DURATION_TOO_SHORT`, `DURATION_TOO_LONG`), working hours (`OUTSIDE_WORKING_HOURS`), within a week of the
event (`OUTSIDE_EVENT_DATES`), end after start (`TIME_ORDER`), at least one item (`ITEMS_REQUIRED`), per-item
quantity (`QUANTITY_OUT_OF_RANGE`) and days (`RENTAL_DAYS_OUT_OF_RANGE`), and stock (`NOT_AVAILABLE` 409 with
`what`, `available`, `requested`).

**Partner app: delivery and return** (`/v1/partner/bookings/:id/rental`, confirmed rentals; each returns `RentalView`)

| Route | Notes |
|---|---|
| `GET …/rental` | Items, counts, photos, charges, deposit |
| `POST …/rental/prepare` · `POST …/rental/load {lines: [{lineId, qty}]}` | Getting the order ready |
| `POST …/rental/dispatch` | `{lines: [{lineId, qty}], note?, photos?}`. From now on the stock counts as out until the return is verified, even past the booking's end |
| `POST …/rental/deliver` | `{lines: [{lineId, qty}], note?, photos?, customerCode?}`: delivered at the venue; the customer is told about any shortfall |
| `POST …/rental/return` | `{lines: [{lineId, returned, damaged, missing, note?, chargePaise?}], note?, photos?, customerCode?}`: the three must add up to what was sent (`RETURN_COUNT_MISMATCH`). Charges come from the rates agreed in the booking; `chargePaise` may only lower them (`CHARGE_TOO_HIGH`). Stock does not change yet |
| `POST …/rental/verify` | After counting (`RETURN_NOT_COUNTED`): returned units are free again, damaged ones go to repair, missing ones leave the stock. Agreed charges come off the deposit and the rest is refunded |

- Steps out of order: `FULFILMENT_BAD_STEP` 409. `photos` are `[{publicId, version, signature}]` exactly as
  Cloudinary returned them for the vendor's own evidence upload; a wrong folder or a forged signature is
  refused (`UPLOAD_INVALID` 403). The same applies to car handover / return photos.
- **Handover code:** `customerCode` is the 6 digits the customer reads out from their app
  (`GET /v1/bookings/:id/handover-code`). With it the delivery / return record counts as agreed by the customer
  (`confirmedBy: "code"`). A wrong code: `CODE_INVALID` 400; after 5 wrong codes in an hour: `TOO_MANY_ATTEMPTS` 429.
  Without a code the step is still recorded and the customer answers it in the app.
- Cancelling once items are on the way: `BOOKING_IN_PROGRESS` 409 (customers from `preparing`, vendors from
  `dispatched`).
- **Booking fields:** `bookingType` (`slot` or `rental` …), `stage` (`pending_confirmation`,
  `awaiting_payment`, `confirmed`, `preparing`, `dispatched`, `delivered`, `return_pending` = event over,
  `returned_verified`, `completed`, `cancelled`, `rejected`, `expired`), `startsAt`/`endsAt`, `depositPaise`,
  `taxPaise`, `depositSettledAt`.
- **Completion and payout:** a rental completes once the return is verified and the deposit settled. The
  payout is the advance plus charges kept from the deposit and any balance paid in the app, minus commission.
- **Admin:** `GET /v1/admin/bookings/:id/rental`; `POST /v1/admin/bookings/:id/charges/:chargeId/resolve`
  `{amountPaise, note}` (support / finance, 2FA re-check) settles a disputed charge (0 waives it; never more
  than asked). Keeping money for `damage`, `missing` or `cleaning` needs the vendor's photos on the charge or the
  return record: `EVIDENCE_REQUIRED` 409 otherwise (it can only be waived).
- **Admin disputes and refunds:** `GET /v1/admin/disputes` (support / finance) → `{charges, inspections}`
  the customer disputes, oldest first. `GET /v1/admin/refunds?status=` (finance) → `{items}` with the
  Razorpay result; `POST /v1/admin/refunds/:id/retry` (finance, 2FA re-check) sends a failed refund once more
  (`NOT_FOUND` 404 when it is not failed or was already retried).
- **Payment events:** `GET /v1/admin/payment-events?status=` (finance; `received`, `processed`, `ignored`,
  `failed`, or `problems` = failed plus payments not confirmed because of a wrong amount or no capture) →
  `{items: [{eventId, event, status, result, attempts, lastError, receivedAt, processedAt, orderId, paymentId,
  amountPaise, bookingId}]}`, last 200. `POST /v1/admin/payment-events/reconcile` (finance) asks Razorpay now
  about unpaid orders older than 10 minutes → `{confirmed}`. The dashboard has `paymentProblems` (last 7 days).

## Services booked by time or quantity (DJ, decor, catering, cars, staff, makeup, planners)

How each kind is priced and held is in docs/BOOKING_ENGINE.md. The vendor page says when to use these:
`category.bookingType` (anything but `slot` / `rental`) and `engineServiceCount` > 0.

**Partner app**

| Route | What it does |
|---|---|
| `GET /v1/partner/service-setup` | The category's form: `bookingType`, `pricingModels`, `attributes`, `questions`, `resourceKind`, `defaultRules`, `vendorRuleKeys`, `resourceFields` |
| `GET/POST /v1/partner/engine-services` · `PATCH/DELETE …/:id` | `{title, description?, pricing, rules?, attributes?, resourceId?}`. Slot and rental categories: `WRONG_SERVICE_KIND` 409. GST on a service needs the vendor's GST number (`GSTIN_REQUIRED`). Car services need their car (`RESOURCE_REQUIRED`, `RESOURCE_NOT_FOUND`). Up to 30 (`LIMIT_REACHED`) |
| `GET/POST /v1/partner/resources` · `PATCH/DELETE …/:id` | Cars, drivers, staff, artists, halls: `{kind, name, attributes}`; `status` `active` / `maintenance`. Same registration twice: `VEHICLE_EXISTS` 409; a driver's licence already expired: `LICENCE_EXPIRED`; removing one with bookings ahead: `RESOURCE_BOOKED` 409 |
| `POST /v1/partner/resources/:id/documents` | RC, insurance, permit, PUC; licence, police verification. Same signed upload as KYC documents (`UPLOAD_INVALID`) |
| `GET/POST /v1/partner/addons` · `PATCH/DELETE …/:id` | Extras: `{name, kind?, pricePaise, serviceId?, inclusions?, exclusions?, setupMinutes?, requiresApproval?}` |
| `GET/POST /v1/partner/bundles` · `PATCH/DELETE …/:id` | Packages: `{name, discountPercent?, items: [{serviceId, mandatory}]}` (own active services only: `SERVICE_NOT_FOUND`) |
| `POST /v1/partner/bookings/:id/accept` | Engine bookings may need `{pricePaise}` (quotation: `QUOTE_PRICE_REQUIRED`) and `{addons: [{addonId, approve}]}` for every extra asked for (`ADDON_DECISION_REQUIRED`) |
| `GET /v1/partner/bookings/:id/trip` | Car trip: mode, car, driver, route, handover / return records, charges, deposit |
| `POST …/trip/driver {driverId}` | An approved, free driver (`DRIVER_NOT_FOUND`, `DRIVER_BUSY` 409); not for self-drive (`SELF_DRIVE`) |
| `POST …/trip/handover {odometerKm, fuelEighths, notes?, photos?, customerCode?}` | From 24 hours before the start (`TOO_EARLY`); with a driver assigned (`DRIVER_REQUIRED`); self-drive needs the customer's verified licence (`LICENCE_NOT_VERIFIED`) and the deposit paid (`DEPOSIT_REQUIRED`) |
| `POST …/trip/return {odometerKm, fuelEighths, fuelPaise?, tollsPaise?, parkingPaise?, damage?: [{description, amountPaise}], notes?, photos?, customerCode?}` | Extra km and late return are charged at the agreed rates; the odometer cannot go back (`ODOMETER_BELOW_START`). The customer accepts or disputes the charges like rental charges |
| `GET /v1/partner/bookings/:id/changes` · `POST …/:changeId/approve` · `POST …/:changeId/reject {reason}` | Reschedules and extensions asked by the customer |
| `GET /v1/partner/bookings/:id/invoice` · `…/commission-invoice` | The invoice in the vendor's name, and EventSeva's commission invoice (`INVOICE_NOT_READY` 409 before confirmation). While the booking can still change it is a `Proforma invoice` with number `PROFORMA` and today's amounts; on completion the final one is numbered once and never changes |

**Customer app**

| Route | What it does |
|---|---|
| `GET /v1/vendors/:id/engine-services` · `GET /v1/vendors/:id/bundles` | What can be booked, with questions, extras and the car (registration masked) |
| `POST /v1/quotes` | Any engine request → `Quote`; nothing is held |
| `POST /v1/engine-bookings` (`Idempotency-Key`) | `{eventId, serviceId, startsAt, endsAt?, quantity? / guestCount? / people?, answers?, addons?, route?, mode?, note?}` → `{id}`. Errors: `SERVICE_NOT_FOUND`, `USE_SLOT_BOOKING`, `SERVICE_NOT_CONFIGURED`, `ANSWER_REQUIRED`, `ANSWER_INVALID`, `ADDON_NOT_FOUND`, `NOT_AVAILABLE` 409, `DATE_IN_PAST`. Cars: `ROUTE_REQUIRED`, `MODE_NOT_OFFERED`, `VEHICLE_NOT_AVAILABLE`, `NO_DRIVER`; self-drive: `LICENCE_REQUIRED`, `LICENCE_EXPIRED`, `TOO_YOUNG` |
| `POST /v1/checkouts/quote` · `POST /v1/checkouts` (`Idempotency-Key`) · `GET /v1/checkouts/:id` | Up to 10 requests for one event, booked all or none; `details.itemIndex` says which line failed. A package: `bundleId` (`BUNDLE_NOT_FOUND`, `BUNDLE_INCOMPLETE`) |
| `GET /v1/me/licence` · `POST /v1/me/licence/upload` · `PUT /v1/me/licence {number, dateOfBirth, expiresOn, photo?}` | Driving licence for self-drive; EventSeva verifies it. The photo is a private upload signed by `POST …/upload` (into the customer's own folder); send Cloudinary's reply as `photo: {publicId, version, signature, format}` (`UPLOAD_INVALID` otherwise). `hasPhoto` says one is on file |
| `GET /v1/bookings/:id/trip` · `POST …/inspections/:phase/ack {decision: agreed / disputed, note?}` | The car trip and its handover / return records (`confirmedBy: "code"` when the customer's code was entered) |
| `GET /v1/bookings/:id/handover-code` | `{code}`: 6 digits for confirmed car and rental bookings, read out to the vendor at the handover / delivery and the return (see "Handover code" under Rentals) |
| `GET/POST /v1/bookings/:id/changes` · `POST …/:changeId/cancel` | `{kind: reschedule / extension, startsAt?, endsAt, reason?}`; one open change at a time (`CHANGE_PENDING` 409); day + slot bookings: `CHANGE_NOT_SUPPORTED` |
| `GET /v1/bookings/:id/invoice` · `…/invoice.html` | Invoice in the vendor's name |

**Admin:** `GET /v1/admin/resources/pending`, `GET …/:id/documents`, `POST …/:id/verify {decision, reason?}` (verifier;
approving needs the RC and insurance, or the licence: `DOCUMENTS_MISSING` 409). `GET /v1/admin/licences/pending`,
`POST /v1/admin/licences/:userId/verify {decision, reason?}` (pending licences carry `photoUrl`, a 10-minute link). `GET /v1/admin/reports/summary?from&to`. `GET /v1/admin/dashboard` also counts `pendingChecks` and `openDisputes`. `GET /v1/admin/bookings/:id` has `bookingType`, `startsAt`, `endsAt`, `fulfilment`, `taxPaise`, `depositPaise`, `depositSettledAt`, `state` and `history` (every state move: `{from, to, status, fulfilment, actorKind, actorId, reason, at}`). Booking views carry `questions` (labels of the category's questions) next to `answers`.

## Admin panel (`/v1/admin/*`, admin token)

- **Login:** `POST /v1/admin/login {email, password, totp}` (or `recoveryCode` instead of `totp`, if the phone is lost)
  → `{accessToken, expiresInSec, admin{id, email, role}, recoveryCodesLeft, usedRecoveryCode}`.
  - Any wrong part returns `ADMIN_LOGIN_FAILED` 401. After 5 wrong attempts the account is locked for 15 min
    (`ADMIN_LOCKED` 429).
  - Each 2FA code works only once: a code (or an older one) that was already used is refused.
  - Each recovery code works once. 2FA secrets are stored encrypted with `BANK_DETAILS_KEY`.
  - `POST /v1/admin/logout` (204) ends every token already issued to that admin.
- **Fresh 2FA for sensitive actions:**
  - Refunds, marking or holding payouts, viewing or verifying bank details, CSV exports, blocking and unblocking
    users, granting featured days, and new recovery codes answer `ADMIN_2FA_REQUIRED` 403 (with `windowMinutes`)
    until the admin sends a fresh, unused code in the `X-Admin-2FA` header (`ADMIN_2FA_INVALID` 403 if it is wrong or used).
  - After one good code, such actions need no code for 5 minutes in that same login.
  - Wrong codes count towards the lock.
- `GET /v1/admin/me` → `{id, email, role, recoveryCodesLeft, stepUpUntil}`.
  `POST /v1/admin/me/recovery-codes` (fresh 2FA) → `{codes}`: 8 new codes, shown once; the old ones stop working.
  Create admins with `pnpm --filter @eventseva/backend create-admin`.
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
| `GET /v1/admin/vendors/:id` | verifier, support | full vendor + `owner{phone}` + `history[]` + all media + `documents[]` (`viewUrl` for verifier/super only, valid 10 min) |
| `POST /v1/admin/documents/:id/approve` · `/reject {reason}` | verifier | ID document review |
| `POST /v1/admin/vendors/:id/approve` · `/reject {reason}` · `/hold {reason}` | verifier | `VENDOR_BAD_STATUS` 409. `/hold` closes the vendor's open requests and returns `closedBookings` and `confirmedBookings` (customers to call) |
| `GET /v1/admin/bookings?status=&q=&page=` · `GET /v1/admin/bookings/:id` | support, finance | `q` matches vendor name, phone or booking id; detail has `payments[]`, `refunds[]` (the refund queue: `status` pending / sending / sent / failed, `attempts`, `lastError`) and `payout` |
| `GET /v1/admin/payouts?status=&due=true&page=` | finance | each payout has `bankStatus` (`null` = no bank account) |
| `GET /v1/admin/vendors/:id/bank-account` | finance | full account number; each view is audit-logged |
| `POST /v1/admin/vendors/:id/bank-account/verify` · `/reject {reason}` | finance | the vendor is notified |
| `POST /v1/admin/payouts/:id/mark-paid {reference}` · `/hold {reason}` | finance | records the bank UTR |
| `GET /v1/admin/complaints?status=&page=` · `POST /v1/admin/complaints/:id {status, resolution?}` | support | resolving requires `resolution` |
| `GET /v1/admin/users?q=&page=` · `POST …/:id/block {reason}` · `POST …/:id/unblock` | support | block logs the user out everywhere; a vendor owner's profile goes `on_hold` with its open requests closed (`vendorOnHold`, `closedBookings`, `confirmedBookings`). Unblocking does not make the profile live again |
| `GET /v1/admin/media?status=pending&page=` · `POST …/:id/approve` · `POST …/:id/reject {reason}` | verifier | photo moderation |
| `POST /v1/admin/reviews/:id/hide {reason}` | support | |
| `GET /v1/admin/alerts` · `POST /v1/admin/alerts/:id/resolve` | all view, support resolves | system alerts (SMS budget at 80%, used up, hard stop). The dashboard has `smsLast24h`, `smsBudgetPerDay`, `openAlerts` |
| `GET /v1/admin/coupons?page=` · `POST /v1/admin/coupons` · `PATCH /v1/admin/coupons/:id` | finance | create `{code, titleEn, titleHi, discountType: percent\|flat, discountValue (percent or paise), maxDiscountPaise?, minAmountPaise?, categoryId?, firstBookingOnly?, isPublic?, maxUses?, perCustomerLimit?, validFrom?, validUntil?}`; the list has `usedCount`, `heldCount`, `discountGivenPaise`; update `{titleEn?, titleHi?, isActive?, isPublic?, maxUses?, validUntil?}` (code and discount are fixed) |
| `GET /v1/admin/featured-plans` · `POST` · `PATCH /:id` | finance views, super edits | `{nameEn, nameHi, days, pricePaise}`; update `{nameEn?, nameHi?, pricePaise?, isActive?}` |
| `GET /v1/admin/featured-purchases?page=` | finance | sales and free grants |
| `POST /v1/admin/vendors/:id/feature {days, reason}` · `POST …/unfeature {reason}` | super | free featured days / stop featuring |
| `POST /v1/admin/bookings/:id/refund` | finance | `{amountPaise, reason, fromVendorPayout?}`: partial refund of any amount up to what is left (`REFUND_TOO_HIGH` with `maxPaise`). With `fromVendorPayout`, the vendor's payout is cut by the same amount (`PAYOUT_ALREADY_PAID` if already sent, `NO_VENDOR_PAYOUT` if the booking is not confirmed or completed). A payout cut to ₹0 is not created |
| `GET /v1/admin/cities` · `POST` · `PATCH /:id` | super | `{name, nameHi, state}`; new cities start hidden; `{isActive}` shows or hides; `LAST_CITY` |
| `GET /v1/admin/audit?action=&targetType=&targetId=&adminId=&page=` | super | 50 per page, newest first, plus `admins` for the filter |
| `GET /v1/admin/export/:kind?from=&to=` | by kind | CSV download. `kind`: bookings, payouts (finance), users (support), vendors (verifier, support), coupons, featured (finance). Dates are inclusive India days |
| `GET /v1/admin/categories` | super | all categories (hidden too) with vendor counts, plus allowed `icons` and `units` |
| `POST /v1/admin/categories` | super | `{nameEn, nameHi, icon, defaultUnit, slug?}`; added at the end. `CATEGORY_EXISTS` 409 |
| `PATCH /v1/admin/categories/:id` | super | `{nameEn?, nameHi?, icon?, defaultUnit?, isActive?}`; hide instead of delete |
| `PUT /v1/admin/categories/order` | super | `{ids}`: the order shown in the apps |

## Running locally

```bash
# Postgres 16 running; then in apps/backend:
cp .env.example .env            # set DATABASE_URL
pnpm migrate
ADMIN_PASSWORD='a-long-password' pnpm create-admin you@example.com super   # prints the 2FA secret
pnpm build && pnpm start        # API on :3000; OTP codes print in this log
```
