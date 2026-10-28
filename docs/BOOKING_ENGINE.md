# Booking engine

The classic booking is one vendor, one day, one slot (`full` / `day` / `night`). Many wedding services do
not fit that: a tent house rents 300 chairs for two days, a car is booked from 4 pm to 2 am, a caterer
serves 500 guests. The booking engine handles these by **time and quantity**. It uses the same booking
life cycle as slot bookings: accept, advance, confirmed, completed, cancellations, refunds and payouts.

API details are in [API.md](API.md) ("Rentals"). Tables are in [`database/tables.md`](../database/tables.md)
("Booking engine", "Rental stock").

## Pieces

| File | What it does |
|---|---|
| `apps/backend/src/engine/types.ts` | Booking types, rules, pricing and quote shapes |
| `apps/backend/src/engine/rules.ts` | Default rules per type; checks for templates, vendor settings, times and quantities; refund tiers |
| `apps/backend/src/engine/booking-types.ts` | One pure handler per type. A handler turns a request into a plan: times, price lines, deposit and what must be held |
| `apps/backend/src/engine/reservations.ts` | Holding what a plan needs, safely when requests run at the same time |
| `apps/backend/src/engine/service-config.ts` | What a vendor configures on a service: own questions, event types, rate plans, price rules (checks and how they apply) |
| `apps/backend/src/engine/engine.service.ts` | Quote and request: load, price, check, hold, save the booking with a snapshot |
| `apps/backend/src/inventory/*` | Rental items, categories, blocks, settings, the customer catalogue, dispatch and return |

## Booking types

| Type | Used for | Held |
|---|---|---|
| `slot` | Classic day + slot bookings (unchanged) | The vendor's `availability` row |
| `rental` | Tent, furniture, utensils, coolers … | Quantity of each item (`item:<id>`) for the rental period |
| `time_window` | Decoration, lighting, a hall by the hour | The vendor's team (or the resource) exclusively |
| `per_person` | Catering | Guests per day, if the vendor sets a capacity |
| `staffing` | Waiters, helpers | Head-count from the staff pool |
| `appointment` | Makeup, mehendi | The artist, for people × minutes |
| `transport` | Wedding cars | The vehicle exclusively, plus a driver from the pool |
| `quote` | Anything priced on request | Nothing until the vendor sends a price |

## What a vendor configures

Booking types are the only code per kind of service. Everything else is configuration, so a new category
(an admin picks its booking type and template in the admin panel) books with no code change:

| Who | Sets | Where it applies |
|---|---|---|
| Admin, per category | Booking type, pricing models allowed, questions, attributes, default rules, minimum notice | Every service in the category |
| Vendor, per service | Price (model, rate, included hours / km, extras, GST) | Quote lines from the type's handler |
| | **Rate plans** (`plans`): 2–6 ways to book, each with its own price and rule overrides (DJ "per hour" / "full night"; car "local" / "outstation") | The customer picks one (`planId`); its price and rules replace the service's for that booking |
| | **Price rules** (`pricing.adjustments`): percent or amount by weekday, date range and event type | Extra lines on the service's own price, in order, never below zero |
| | **Own questions** (`questions`): text, long text, number, yes/no, choices (may add a price), date, time; help text; shown only after a given earlier answer (`showIf`) | Asked after the category's; keys may not clash; hidden ones are neither required nor kept |
| | **Event types** (`eventTypes`) | Others get `EVENT_TYPE_NOT_SERVED`; `?eventType=` hides the service from the listing |
| | **Availability** (rules): working hours, `workingDays`, `blockedDates`, `maxAdvanceDays`, `maxPerDay`, notice, durations, quantities, buffers | Checked on every quote, request and reschedule; `maxPerDay` under a lock per service and day. The customer app greys out days and start times from the day view (`…/engine-services/:id/day`) |
| Vendor, rentals | Delivery, minimum order, notice, set-up / pick-up / cleaning time, approval, cash, price rules, working days, blocked dates, how far ahead, bookings per day | The rent lines of each rental |
| Admin, per service | Take a service off the app with a reason, or put it back | New bookings refused; open ones go ahead; audited and in the history |
| | Approval (instant or vendor), deposit, cash accepted, extras (add-ons), bundles | As before |

**Snapshots.** A booking keeps what was agreed: the price (the plan's, with its rules), the rules, the
plan (`snapshot.plan`), the event type, and the questions as answered (`snapshot.questions` with a short
`version` hash and the fields). A later change by the vendor never changes an existing booking, and a
reschedule is priced with the snapshot.

**History.** Every change a vendor makes to the price, rules, questions, plans or event types raises
`services.config_version` and is kept in `service_config_history` (only the settings that changed, before
and after). The vendor sees it at `GET /v1/partner/engine-services/:id/history`, admins (verifier, support)
at `GET /v1/admin/services/:id/history` and on the vendor page.

**Adding a setting later.** Add its type to `types.ts`, a check in `service-config.ts` (or `rules.ts` for a
rule) used when the vendor saves, the step that applies it in `EngineService.load` / `price`, the field in
the catalog service, and tests. Old services simply do not have it set.

## Holds

- **Exclusive things** (a car, a hall, the vendor's team) are rows in `reservations`. A `btree_gist`
  exclusion constraint refuses two live rows for the same resource whose times overlap. Two transactions
  can never both win.
- **Quantities** (chairs, plates, guests, workers) are rows in `capacity_holds`. The check takes a
  transaction advisory lock on the pool. Then it adds up every live hold overlapping the time and inserts
  only if the result fits.
  - The sum counts every overlapping hold, even holds that do not overlap each other. So it can be
    cautious, but never too generous.
- **Live** means `active`, or a `hold` whose `expires_at` has not passed. An expired hold stops blocking at
  once, even before the sweep marks it.

Holds over a booking's life:

| Step | Holds |
|---|---|
| Request | `hold` until the vendor's reply deadline (or the payment deadline with automatic approval) |
| Accept | Renewed until the payment deadline |
| Advance paid | `active` with no expiry. If a hold ran out and someone else took it meanwhile, the payment is refunded in full and the booking expires |
| Cancel, reject, expire | `released` |

Each item's period includes the vendor's setup time before, and pickup and cleaning time after.

## Rentals

| Topic | How it works |
|---|---|
| Items | Name, category (six defaults or the vendor's own), unit (piece, set, pair, dozen or any word), rent per booking or per day, stock, units in repair, least / most per booking, shortest / longest rental, deposit, damage and missing charges, quality, condition, description, photos |
| Edits | Apply to new bookings only. Every booking line keeps an `item_snapshot` with the agreed name, unit, quality and prices |
| Stock cuts | Stock cannot drop below the busiest moment ahead: the peak of overlapping holds, taken under the pool's lock (`STOCK_COMMITTED`) |
| Deleting | An item with bookings or stock history is archived, not deleted. Bookings already made still go ahead |
| Blocks | A vendor can keep stock back for chosen times. These are pool holds with no booking |

### Delivery steps

These are kept in `bookings.fulfilment`:

1. `scheduled`
2. `preparing`
3. `dispatched`
4. `delivered`
5. `return_pending`: the sweep sets this when the rental period ends
6. `closed`: the return has been verified

What happens on the stock side:

- **Dispatch** marks the booking's holds `until_returned`. The stock then stays taken past the booking's
  end until the return is verified, so a late return can never be double-booked.
- **Return count** records returned, damaged and missing units per line. Charges come from the rates in the
  booking, and the vendor may only lower them. Stock does not change yet.
- **Verify** puts stock back:
  - Returned units become free.
  - Damaged units go to `repair_qty`.
  - Missing units leave `total_qty`.
  - Every change goes into `inventory_movements`.

### Charges and the deposit

1. The customer accepts or disputes each charge. No answer in 48 h counts as accepted.
2. An admin settles disputes, and may lower a charge but never raise it.
3. When nothing is open, agreed charges come off the online deposit (`charges_paise`, paid to the vendor
   with the payout). The rest is refunded.
4. Charges larger than the deposit are shown as due between the customer and the vendor.
5. The booking completes after that. The payout is advance + kept charges − commission.

### Status chip

The API's `stage` field drives the status chip in the apps:

1. `pending_confirmation`
2. `awaiting_payment`
3. `confirmed`
4. `preparing`
5. `dispatched`
6. `delivered`
7. `return_pending`
8. `returned_verified`
9. `completed`

A booking can also end as `cancelled`, `rejected` or `expired`.

## Money

- **Quote:** item rent (× days for per-day items), delivery fee, distance charge and minimum order make the
  subtotal. GST from the vendor's rate is added to it.
- **Advance:** the vendor's percent or fixed amount, else the platform default.
- **Deposit:** kept apart from the price and paid separately (`/pay?part=deposit`).
- **Commission:** charged on the subtotal.
- **Refunds:** follow the cancellation tiers saved with the booking (`cancellation_policy`). A paid balance
  follows the same tier, and the deposit always comes back in full.
- **Sending refunds:** they go through the refund queue (`refunds`), which retries failures.

## Booking state machine

Each booking has one `state`, set by the database (trigger `booking_state_guard`) from its `status`,
`fulfilment` step and any disputed charge. The code keeps updating `status` and `fulfilment` as before; the
database works out the state and refuses any move that is not in `booking_state_moves`, whichever code path
(API, admin, job, a manual SQL fix) tries it. The API answers such a refusal with `BOOKING_BAD_TRANSITION` 409.

| State | When | Can move to |
|---|---|---|
| `draft` | Reserved (the cart lives on the phone until checkout) | pending_vendor, awaiting_payment, cancelled, expired |
| `pending_vendor` | `requested`: waiting for the vendor | awaiting_payment, confirmed (cash booking), cancelled, expired |
| `awaiting_payment` | `accepted`: waiting for the advance | confirmed, cancelled, expired |
| `confirmed` | Advance paid, nothing handed over yet | in_progress, return_pending, completed, cancelled, disputed |
| `in_progress` | Dispatched, delivered, or the car is out | return_pending, completed, cancelled, disputed |
| `return_pending` | Back, being counted or settled | completed, disputed, cancelled |
| `disputed` | A charge is disputed and not decided yet | confirmed, in_progress, return_pending, completed, cancelled |
| `completed` | Done; payout created | disputed (a late dispute) |
| `cancelled` | Rejected, or cancelled by either side | — |
| `expired` | No reply, no payment, or no longer available when the money came | — |

Every move is written to `booking_state_history`: from, to, the status and step, who (`customer`, `vendor`,
`admin`, `system` for jobs, `gateway` for payment webhooks and reconciliation), their id and the reason. The API
sets the actor for each request's transaction (`src/db/actor.ts`). Admins see it on the booking page.

Payment, refund and payout statuses are separate columns on their own tables and do not follow this machine.

## Reliability

- **No double booking:** cars, halls and teams are rows in `reservations` with an exclusion constraint on
  the time range; quantities (rental stock, driver pools) are counted under row locks. Requests, accepts and
  payments lock the booking row (`FOR UPDATE`) and run in one transaction. Holds expire; an expired hold
  can be taken by someone else.
- **Payment confirmation:** never from the app alone. The app's verify call needs Razorpay's signature;
  the webhook needs the webhook signature, the `captured` status and the exact order amount (else nothing
  is confirmed and finance gets a `payment_amount_mismatch` alert).
- **Webhook log:** every webhook is stored once in `webhook_events` by Razorpay's event id. A repeat is
  answered without running again; one that fails is marked `failed` with the error and answered with 500,
  so Razorpay retries it.
- **Reconciliation:** every 5 sweeps (5 minutes by default) the API asks Razorpay about orders still unpaid
  after 10 minutes (for up to 3 days) and confirms the ones that were paid but whose webhook never came.
- **Payment after the hold ran out:** if the slot is still free the booking is confirmed; if someone else
  took it, the whole payment is refunded and the booking expires.
- **Refunds:** queued in `refunds` inside the same transaction, then sent and retried with backoff; Razorpay's
  `refund.processed` / `refund.failed` webhooks close them.
- **Notifications (outbox):** written to `notifications` in the same transaction as the change, then pushed by
  a dispatcher woken by `pg_notify` and a 30-second poll, claiming rows with `SKIP LOCKED`.
- **Payouts:** created at completion and paid by bank transfer outside the app; finance records the UTR
  (`mark-paid`), can hold a payout, and can record it again if a transfer failed. There is no automatic
  payout API yet, so there is nothing to retry automatically.

## Cash bookings

Vendors choose per service or package whether cash is accepted. A cash booking is paid to the vendor in
person: the vendor's accept confirms it, no money passes through Razorpay, and the vendor records what
they take or give back (`cash_receipts`; the customer is told each time). Cancellations and deposits are
settled in cash, with both sides told the amount. On completion the commission becomes a
`commission_dues` row: the booking sweep takes it off the vendor's next scheduled online payouts, or finance
records the vendor's direct payment or waives it. Too much open commission (`CASH_DUES_LIMIT_PAISE`) or any
older than 30 days turns cash off for that vendor until it is paid.

## Handover code

Car handovers and returns, and rental deliveries and returns, can be confirmed with the customer's
6-digit code (`GET /v1/bookings/:id/handover-code` → `{code, phase, expiresAt}`, shown on the booking in
the customer app). Each step (handover, delivery, return) gets its own random code, valid for 30 minutes
and once only; opening a new code makes the old one stop working. Only a keyed hash is stored
(`handover_codes`). The vendor types it in; the record is then agreed by the customer (`confirmedBy: "code"`).
Five wrong tries lock that code. Without a code the step is still recorded and the customer agrees or
disputes it in the app.

## Disputes

Customers dispute a charge with a reason. Support or finance decides it (2FA re-check). Keeping money for
damage, missing items or cleaning needs the vendor's photos on the charge or the return record
(`EVIDENCE_REQUIRED`); otherwise the charge can only be waived. A decision can lower a charge but never raise it,
and it is written to the admin audit log.
