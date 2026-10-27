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

## Not built yet

- Customer and partner screens for transport (cars), staffing, appointments and quotations.
  - The engine supports these types.
  - Only rentals have full app screens and fulfilment steps.
- Reschedule and extension requests. The `booking_changes` table and `moveAll` exist, but there are no
  endpoints yet.
- Multi-vendor cart / package checkout.
