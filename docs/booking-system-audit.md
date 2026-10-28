# Booking system audit

Date: 3 November 2026. Commit audited: `a8f5803` (main). Scope: the customer app, the Partner app where it
takes part in a booking, the API and the database, against the "production-ready booking system" brief.
The brief listed the app's features; each was checked in the code, not assumed.

## 1. Architecture

| Part | What it is |
|---|---|
| API | NestJS 11 (`apps/backend`), one process; plain SQL through `pg` (no ORM) via `Db` (`src/db/db.service.ts`) with `tx()` for transactions |
| Database | PostgreSQL 16; dbmate-style SQL migrations in `database/migrations` (`-- migrate:up` / `-- migrate:down`), applied in a transaction each; `database/schema.sql` and `tables.md` generated and checked in CI |
| Apps | Expo SDK 58 customer app and Partner app; Next.js 16 admin panel; shared types and API client in `packages/app-shared` |
| Jobs | In-process timers: booking sweep (`BOOKING_SWEEP_SEC`, default 60 s), refund queue, payment reconciliation (every 5 sweeps), push dispatcher (`pg_notify` + 30 s poll, `SKIP LOCKED`) |
| Payments | Razorpay Orders API behind `PaymentGateway` (`src/payments/gateway.ts`); `FakeGateway` for development and tests; production refuses the fake provider |

Secrets: `apps/backend/.env` is git-ignored and was never committed (history checked); only placeholder values are
in `.env.example`. No production database URL is in the repository.

## 2. Booking flow as built

1. **Request.** Day/slot bookings: `POST /v1/bookings` (`BookingsService.request`). Bookings by time or
   quantity (cars, rentals, staff, makeup, catering, quotations): `POST /v1/engine-bookings`
   (`EngineService.create`), priced by `booking-types.ts` from the service's pricing and the category's rules.
   Cart: `POST /v1/checkouts` makes every line in one transaction or none.
2. **Hold.** Engine bookings hold what they need in `reservations` (exclusive things: cars, halls, crews) and
   `capacity_holds` (quantities: rental stock, driver and staff pools) with `expires_at` = the reply deadline.
   Slot bookings take an `availability` row when accepted.
3. **Vendor answer** (24 h, never into the event day). Accept renews the holds until the payment deadline
   (24 h); a cash booking is confirmed by the accept itself.
4. **Payment.** `POST /v1/bookings/:id/pay` creates (or reuses) one Razorpay order; the booking is confirmed
   only by a verified checkout signature, a verified webhook (signature, `captured`, amount) or the
   reconciliation job asking Razorpay. Holds become permanent in the same transaction.
5. **Service.** Fulfilment steps (rentals: prepare → load → dispatch → deliver → return → verify; cars:
   driver → handover → return), handover code, photos, charges, disputes, deposit settlement.
6. **Completion.** The sweep completes bookings and creates payouts (or commission dues for cash bookings).
7. **Cancellation / change.** Refund by the policy saved on the booking; reschedule and extension move the
   holds atomically (savepoint) and charge or refund the difference.

## 3. Entities (main tables)

Accounts: `users`, `otp_requests`, `sessions`, `device_tokens`, `admin_users`. Catalogue: `categories` (with a
booking template), `services` (price, `pricing`, `rules`, `cash_allowed`), `packages`, `service_addons`,
`service_bundles`, `media`. Resources and stock: `resources`, `reservations` (`tstzrange` + exclusion
constraint), `capacity_holds`, `inventory_items`, `inventory_movements`, `item_categories`. Bookings: `events`,
`bookings` (`snapshot` with the agreed quote, `cancellation_policy`, `state`, `pay_mode`), `booking_lines`,
`booking_addons`, `booking_changes`, `booking_events`, `booking_state_history`, `booking_inspections`,
`booking_charges`, `customer_licences`, `checkouts`. Money: `payments`, `refunds`, `payouts`, `invoices`,
`coupons`, `coupon_redemptions`, `cash_receipts`, `commission_dues`, `webhook_events`. Messages:
`notifications` (outbox for push), `conversations`, `messages`, `complaints`, `admin_audit_log`, `system_alerts`.

## 4. What the brief asks and what exists

| Brief | Status before this change |
|---|---|
| Booking types with typed rules | **Exists**: `slot`, `time_window`, `rental`, `per_person`, `staffing`, `appointment`, `transport`, `quote`, validated in `rules.ts` / `booking-types.ts` |
| State machine with history and actor | **Exists** (DB trigger, `booking_state_moves`, `booking_state_history`); payment, refund and payout statuses are separate tables |
| Exclusive resources without overlap | **Exists**: exclusion constraint on `reservations`; capacity checked under row locks |
| Rental stock never oversold | **Exists**: per-item lock, peak-usage check across the period, stock cannot drop below holds |
| Multi-vendor cart, all or none | **Exists**: one transaction; `itemIndex` on the failing line |
| Server-side pricing, snapshot per booking | **Exists**: quote in `bookings.snapshot`, item snapshots on lines, policy snapshot |
| Price change during checkout | **Missing**: the server reprices, but the customer is never asked to accept a different total |
| One payment for several vendor bookings | **Missing**: each vendor booking is paid separately after acceptance |
| Holds with expiry; payment after expiry | **Exists**: holds expire; late money is refunded unless the booking can still be confirmed |
| Webhook verification, dedupe, reconciliation | **Exists** (`webhook_events`, amount check, reconciliation job) |
| Payment failure then retry | **Partly**: retry works on the same order, but a `payment.failed` event is only logged as ignored and the customer is not told |
| Payment and refund state per booking, ledger | **Partly**: in the tables, not as one answer for the app or admin |
| Server-generated refund estimate | **Missing**: the app computes the estimate itself (`refundPreview`) |
| Cash bookings | **Exists** (receipts capped, notifications, commission dues) |
| Handover code | **Weak**: one fixed HMAC code per booking, no expiry, reusable for every step |
| Disputes with evidence, deposit as transactions | **Exists** (evidence rule, kept / returned amounts) |
| Outbox for notifications | **Exists** (`notifications` + dispatcher); SMS and push need provider credentials |
| Correlation ids | **Missing** |
| OpenAPI | **Not present**; `docs/API.md` is the maintained contract |

## 5. Risks found

- **Price drift (medium):** a customer could be charged a total they did not see if a vendor changed the price
  between quote and request (the server is right, but the customer did not agree to the new number).
- **Handover code (medium):** the same code works forever and for every step, so a code seen once (a
  screenshot, a past delivery) confirms later records.
- **Cart payments (product):** a cart of five vendors means five separate payments.
- **Refund estimate (low):** client and server could disagree when the policy differs per category.
- **Traceability (low):** no request id ties a log line to a booking or payment.
- No SQL built from user input, no missing ownership check, no secrets in logs were found.

## 6. Commercial policy for carts (decided here, matching the existing product)

- Money is **captured** (Razorpay Orders, auto-capture); authorisation-only payment is not used, because the
  account's capabilities are not verified.
- A cart sends one **request per vendor**. Nothing is charged before a vendor accepts, so a vendor rejecting a
  line never needs a refund, and the rest of the cart stays booked (partial acceptance is normal).
- Accepted lines of one checkout can be paid **together in one Razorpay order**; the payment is allocated to
  each booking (one payment row per booking in `payments`, linked to `payment_orders`). A line that can no
  longer be confirmed when the money arrives (expired, cancelled, slot lost) is refunded for its own share
  only; later refunds of one booking are partial refunds of the shared payment.

## 7. Implementation plan (this change)

1. Handover codes: random, one per step (handover / delivery / return), 30-minute expiry, one use, 5 tries.
2. Price-change protection: `expectedTotalPaise` on requests and checkouts; `PRICE_CHANGED` 409 with old and new
   totals and the difference.
3. Server refund estimate: `GET /v1/bookings/:id/cancel-preview`; the app shows it.
4. One payment for a checkout: `payment_orders`, allocations, `POST /v1/checkouts/:id/pay` (+ verify / dev),
   webhook, reconciliation and refunds aware of shared payments.
5. Payment failure: `payment.failed` recorded and the customer told; retry stays on the same order.
6. Money summary per booking: `GET /v1/bookings/:id/money` (due, paid, deposit, refunded, refundable, cash) and
   `paymentState` / `refundState` on booking views.
7. Correlation id: `X-Request-Id` on every request and response, in error logs and the state history.
8. Tests for each item, plus the brief's missing cases (two workers expiring one hold, concurrent coupon use).
9. App screens: price-change prompt, server refund estimate, code with expiry, "pay all together".

## 7a. Done in this change

All nine plan items are in. `test/checkout-pay.spec.ts` (11 tests) and the rewritten handover tests in
`booking-lifecycle.spec.ts` cover them. Migration: `20261104000001_booking_hardening.sql`. It only adds tables,
columns and indexes, and swaps two constraints on `payments` for wider ones. It has a full `migrate:down`.

## 8. Test coverage map (brief § 17)

| Brief case | Test |
|---|---|
| Two customers, same exclusive slot | `concurrency.spec` "two requests for the same slot accepted at the same moment"; `car.spec` "three customers asking for the same car" |
| Last rental units | `rental.spec` "two customers grabbing the last stock at the same moment" |
| Cart with one unavailable line | `checkout.spec` "books a DJ and a decorator together, or neither" |
| Price changed during checkout | `checkout-pay.spec` "price changed before the customer confirmed" (engine, cart, slot) |
| Hold expires while the webhook arrives | `concurrency.spec` "payment and expiry at the same moment" |
| Two workers expire the same hold | `checkout-pay.spec` "two sweeps expiring the same booking close it once" |
| Retried checkout | `rental.spec` / `checkout.spec` Idempotency-Key cases |
| Signatures, duplicate and out-of-order webhooks | `bookings.spec`, `car.spec`, `booking-lifecycle.spec` |
| Payment after expiry | `bookings.spec` "money that arrives after the booking closed is refunded" |
| Failure then retry | `checkout-pay.spec` "a failed attempt tells the customer …" |
| Refund pending / failed / reconciled | `edge-cases.spec` refund queue cases |
| Amount manipulation | `booking-lifecycle.spec` "never confirms a wrong amount" |
| One payment, several vendors; one rejects | `checkout-pay.spec` "pays every accepted booking in one order", "one vendor rejects", "a vendor who declines" |
| State transitions, approvals, cancellations, reschedule, extension | `booking-lifecycle.spec`, `bookings.spec`, `engine-types.spec`, `rental.spec` |
| Cash partial and duplicate entries | `cash.spec` |
| Handover code expiry and replay | `booking-lifecycle.spec` handover code cases |
| Unauthorised access | `url-security.spec`, ownership cases in every spec |
| Concurrent coupon use | `checkout-pay.spec` "two customers taking the last use of a coupon" |
| Price snapshots and invoices | `rental.spec` "keeps the agreed price", `invoices-reports.spec` |

Needs credentials (not testable here): live Razorpay, SMS OTP, Firebase push.

## 9. Vendor-configurable engine (second brief)

Audited before building. What already existed:
- 8 booking types, each a pure handler;
- category templates (questions, attributes, pricing models, default rules), editable by an admin without code;
- vendor rules (durations, quantities, working hours, notice, buffers, deposit, approval);
- add-ons, bundles, resources, rental stock;
- snapshots of the price and rules on each booking;
- per-category cancellation policy.

What was missing, and was added:

| Brief | Added |
|---|---|
| Several booking modes per service | Rate plans (`services.plans`, request `planId`): own price and rule overrides per plan |
| Dynamic pricing rules | `pricing.adjustments`: percent or amount by weekday, date range and event type |
| Vendor's own questions, versioned | `services.questions`, asked after the category's; the booking keeps `{version, fields}` |
| Event types per service | `services.event_types`; `EVENT_TYPE_NOT_SERVED`; listing filter `?eventType=` |
| Availability | `workingDays`, `blockedDates`, `maxAdvanceDays`, `maxPerDay` (locked per service and day) |
| Admin review, change audit | `service_config_history` with version, before and after; partner and admin history routes; admin vendor page |
| New category without code | Covered by `dynamic-engine.spec` (admin creates a category, sets its template; a vendor sets plans and questions; a customer books) |

Rentals keep their per-item price (`inventory_items`). Plans and price rules apply to services booked by
time or quantity. Migration: `20261105000001_service_config.sql` only adds columns and one table; existing
services behave as before.

Brief test list:

| Case | Test |
|---|---|
| DJ hourly and full night | `dynamic-engine.spec` "DJ: per hour or full night …" |
| Car hourly and outstation | `dynamic-engine.spec` "car: local by the hour or outstation by the day" |
| Rental quantity and days | `rental.spec` (unchanged, still passing) |
| New category with no code | `dynamic-engine.spec` "a category an admin adds today …" |
| Price edit after booking | `dynamic-engine.spec` "editing the price keeps the booked price …" |
| Invalid plan, missing answers | `dynamic-engine.spec` plan and question cases |
| Concurrency (day limit) | `dynamic-engine.spec` "a limit of bookings per day …"; existing `concurrency.spec`, `car.spec`, `rental.spec` |
| Cart rollback | `dynamic-engine.spec` "a cart line with a wrong plan rolls the whole checkout back" |
| Duplicate webhooks, cancel, reschedule, refund | Existing `booking-lifecycle.spec`, `checkout-pay.spec`, `bookings.spec`, `engine-types.spec` |
| Unauthorised access | History routes in `dynamic-engine.spec`; `url-security.spec` |

## 10. Third brief (same spec, re-checked against the code)

Each line of the spec was checked against what was built. Gaps found and closed:

| Spec | Before | Now |
|---|---|---|
| Question types: long text, date / time, display order, conditional visibility | text, number, yes/no, choices | + `longtext`, `date`, `time`, `help`, `showIf` (earlier question only); order is the list order; hidden answers dropped; labels and text are plain text (`<`, `>` and control characters refused) |
| Customer gets only valid options for a date | Server refused bad times after a quote | Day view `GET …/engine-services/:id/day`; the app greys out closed days and start times (notice, working hours, busy times including set-up and clean-up) |
| Event types hide services | Server refused | The booking form lists only services offered for the event |
| Rentals configurable like services | Delivery, notice, timings | + price rules (on rent only), working days, blocked dates, advance window, per-day limit, change history |
| Booking limits per day on reschedule | Not checked | Checked; the booking itself is not counted twice |
| Admin disables unsafe services | No control | `PATCH /v1/admin/services/:id/status` with reason; audit log, history, vendor notified; vendor cannot edit until put back |
| Admin reviews configurations | Only slot services on the vendor page | "Booking settings" section: price, ways to book, events, questions, version, status, changes |
| Booking keeps what was answered | Answers kept; labels from today's category | Labels from the booking's own question snapshot; plan shown in both apps |

Not built, and why:
- **File or image answers.** These need a signed upload tied to a booking that does not exist yet, plus
  moderation. Customers can share files in chat after booking.
- **Breaks inside a working day.** Vendors can block whole dates. A break needs a time-range rule, which can
  be added as a new rule key (see "Adding a setting later" in BOOKING_ENGINE.md).
- **Several simultaneous bookings of one service.** Capacity is modelled per resource: several cars or
  crews, staff pools, catering capacity per day. There is no separate per-service count.

## 11. Fourth round: what was left

| Item | Done |
|---|---|
| Flaky CI failure | The cause could not be found. The logs cannot be downloaded from this environment, and many local runs passed: full suites on a CI-like postgres:16 and repeated concurrency tests. Backend tests now also report as GitHub annotations (`github-actions` reporter), so the next failure names its test |
| Breaks within a day | `rules.breaks`, enforced on quote, booking and reschedule; shown in the day view; editor in the Partner app (services and rentals) |
| File / photo answers | `photo` question type: private signed upload, signature and folder checked, only id and format kept, 10-minute links for the customer and the vendor only |
| Conditional questions in the Partner app | "Ask this only when" picks an earlier yes/no or choice question and its answers; kept through edits and removals |
| Several bookings at once | `rules.maxConcurrent` for team services: a pool per service, under the pool lock; day view shows when every team is out; vendor calendar blocks still apply |
| Date and time pickers | Date questions open the calendar; time questions show half-hour chips |
| Phone checklist | No phone or emulator in this environment, and the apps do not include react-native-web. Instead `pnpm smoke` now walks the new checklist items against a real running API (55 checks, run in this round); the on-phone list is updated in PHONE_TEST.md |
