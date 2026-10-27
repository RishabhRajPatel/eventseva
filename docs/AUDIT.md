# EventSeva: audit against the master prompt

Date: 27 Oct 2026. Branch state: commit `c60619f` plus `test/concurrency.spec.ts` (new).
Stack (kept as it is):
- **Backend:** NestJS 11 API, PostgreSQL 16 with plain SQL, dbmate-style migrations in `database/migrations`.
- **Apps:** two Expo SDK 58 apps (customer, Partner) and a Next.js 16 admin panel, in one pnpm monorepo.
- **Integrations:** Razorpay (through `PaymentGateway`, with `FakeGateway` in development and tests), Cloudinary signed
  uploads, FCM push, and SMS OTP (the provider is still to be chosen).

## Phase 1: what exists (verified)

Checks run on 27 Oct 2026, all passing:

| Package | Tests | Other checks |
|---|---|---|
| backend | 170 (incl. 4 new concurrency tests) | tsc, `db:docs --check` |
| customer | 103 | tsc, Android export |
| partner | 117 | tsc, Android export |
| admin | 68 | eslint + tsc, Next build |
| app-shared | 14 | |

### Data model (31 tables, `database/tables.md`)

| Area | Tables | Notes |
|---|---|---|
| Accounts | users, otp_requests, sessions, device_tokens, admin_users | OTP login with rolling limits and SMS budget; admin password + TOTP + recovery codes + step-up |
| Catalogue | cities, categories | Categories are admin-managed (add, rename, hide, reorder). 7 visible and 8 hidden today |
| Vendors | vendors, vendor_documents, vendor_bank_accounts, services, packages, media, availability | Services priced per unit (`per_event`, `per_day`, `per_plate`, `per_hour`, `per_km`, `per_room_night`, `per_person`, `per_shift`) with min/max guests; vendor packages = a list of item names at one price; calendar by day × slot (full/day/night) |
| Events and bookings | events, bookings, reviews, shortlists | One event, many bookings (one per vendor item). Venue pin, arrive-by time, event-day progress |
| Money | payments, refunds, payouts, coupons, coupon_redemptions, featured_plans, featured_purchases | Advance only; queued idempotent refunds; payouts after the event; coupons; paid featured listings |
| Messages and support | conversations, messages, notifications, complaints, admin_audit_log, system_alerts | Chat with booking timeline lines; push; complaints (support tickets); full audit log |

### Booking flow today

`requested` → vendor `accepted` (slot held, 24 h to pay) → advance paid → `confirmed` → `completed` (payout scheduled).
Side exits: `rejected`, `expired`, `cancelled_by_customer`, `cancelled_by_vendor`.

- **Price:** the server prices every booking (unit price × quantity). The advance is 25 % and the commission 10 %
  (from `.env`).
- **Cancellation refunds:** fixed tiers in code (90 / 50 / 0 % for the customer, 100 % when the vendor cancels).
  The vendor gets the kept part minus commission.
- **Already safe** (tests prove it):
  - one active booking per event and vendor;
  - slot clashes, with accepts serialised by a row lock on the vendor (new concurrency test);
  - duplicate webhooks credit once (new test);
  - payment vs expiry race: either confirmed, or expired with a full refund (new test);
  - refunds never sent twice;
  - deadlines never cross the event day;
  - IDOR on every :id route returns 404.

### API (121 routes in 19 controllers, `docs/API.md`)

- **Customer:** catalogue, vendor search (distance), events, bookings, coupons, payment (Razorpay checkout + verify +
  webhook), cancel, reviews, chat, notifications, complaints, account deletion.
- **Partner:** profile, services, packages, media, documents, bank account, calendar block/unblock, bookings
  (accept/reject/cancel/progress), earnings, featured plans.
- **Admin:**
  - vendors (approve/hold/reject), documents, media moderation, bookings, refunds;
  - payouts, users, complaints, categories, cities, coupons, featured, alerts, audit log, CSV exports;
  - role-based access, with step-up 2FA on money and personal data.

### Not present

- **No deployment configuration:** no Dockerfile and no CI. Hosting is still undecided (README, "Before going live").
- **No SMS provider adapter yet:** OTP goes to the console in development.

## Phase 2: gaps against the master prompt

Legend: **missing** = nothing exists; **partial** = something exists but does not meet the requirement.

### Catalogue (§2)
| Requirement | State |
|---|---|
| Admin can add categories without code changes | ✓ exists |
| The full list (venues, tent/mandap, decoration, DJ/LED, bands/artists, catering/staff, bartan/crockery, transport, makeup/mehendi, outfits/jewellery, photo/video/drone, invitations, pandit, security/valet, generator/coolers/toilets, accommodation …) | **partial**: 15 categories, 8 hidden |
| Category-specific item attributes (seats, AC, capacity, driver mode …) | **missing** |
| Configurable pricing rules (minimums, per-km beyond a radius, overtime) | **missing**: only unit × quantity |

### Booking model (§3, §4)
| Requirement | State |
|---|---|
| One event, many bookings | ✓ |
| Packages across several vendors (admin-curated wedding packages) | **missing**: only single-vendor packages |
| Cart / one checkout for several services | **missing**: each booking is requested and paid separately |
| Start/end times, multi-day, cross-midnight, setup/dismantle/cleaning buffers | **missing**: day × 3 fixed slots only |
| Pickup and return schedules | **missing** |
| Quantity-based availability (chairs, plates) | **missing**: availability is one slot per vendor |
| Temporary hold before acceptance | **partial**: the slot is held from acceptance until payment (24 h) |
| Package blocked when a mandatory item is unavailable | **missing** (no multi-item packages) |
| Rescheduling | **missing** |
| Booking status and payment status shown separately | **partial**: payments are stored separately, but the API has no `paymentStatus` |
| Historical prices kept | ✓ (amounts stored on the booking) |
| Historical cancellation terms kept | **missing**: tiers live in code, so a policy change would change old bookings |

### Vehicles and rental inventory (§5)
**Missing entirely:**
- vehicles, drivers, self-drive;
- km and hour allowances, overtime, handover and return inspection;
- stock quantities (reserved / dispatched / returned / damaged / missing), partial and late returns;
- maintenance, and a movement history.

### Payments (§6)
| Requirement | State |
|---|---|
| Existing Razorpay integration, test mode in development | ✓ |
| Webhook signature check, idempotent credits | ✓ |
| Client-side success never trusted | ✓ (server verifies the signature or the webhook) |
| Duplicate refunds prevented | ✓ |
| Remaining balance through the platform | **missing**: the balance is paid to the vendor at the event (`payment_type 'final'` is unused) |
| Refundable security deposit | **missing** |
| Configurable cancellation policies | **missing** (hard-coded tiers) |
| Refund reconciliation with Razorpay's own refund status (`refund.processed` / `refund.failed` webhooks) | **missing**: refunds count as "sent" when the API call succeeds |
| Tax (GST) and invoices | **missing** |

### Customer / vendor / admin features (§7, §8)
| Requirement | State |
|---|---|
| Search, filters, booking history, cancellation, notifications, reviews | ✓ |
| Quotations, cart, invoices, booking changes | **missing** |
| Vendor catalogue, pricing, calendar, accept/reject, revenue (earnings) | ✓ |
| Vendor inventory, dispatch and return management | **missing** (event-day "on the way / reached" exists) |
| Admin vendor approval, commissions (one global rate), coupons, refunds, payouts, audit, reports (dashboard + CSV) | ✓ |
| Platform settings screen (commission, advance %, tax, policies) | **missing**: `.env` only |
| Disputes (beyond complaints with a free-text resolution) | **partial** |
| Booking / revenue / utilisation analytics | **partial**: dashboard counts and CSV only |
| Reminders for overdue returns and balance due | **missing**; event reminders exist |

### Bugs and risks found
1. **No deployment or CI config**, so nothing runs the checks automatically. *(Out of scope until hosting is chosen.)*
2. **Refunds count as done once Razorpay accepts the call.** Razorpay can still fail a refund later.
   **Fix:** handle the `refund.processed` and `refund.failed` webhooks (Phase 5).
3. **Changing the refund tiers in code would apply to bookings already confirmed.**
   **Fix:** snapshot the policy on each booking (Phase 3A).
4. **Commission and advance % come from `.env`.** Changing them needs a restart and is not audited.
   **Fix:** platform settings with an audit log (Phase 3A).
5. **No concurrency tests existed** for accept races, duplicate webhooks or payment vs expiry. Added today; all pass.

## Plan (incremental, existing architecture)

| Phase | What | Migration risk |
|---|---|---|
| **3A** (this round) | Full catalogue + category groups; category attributes on services; platform settings (commission, advance, GST, cancellation policy) editable by super admins with step-up + audit; booking snapshots of price, commission, advance and cancellation policy; `paymentStatus` on bookings; GST + numbered invoices (receipts) | Additive only: new columns with defaults, new tables, `INSERT … ON CONFLICT DO NOTHING` for categories. Existing bookings get a snapshot equal to today's rules, so their refunds do not change |
| 3B | Time-range scheduling (start/end, buffers, cross-midnight) with a database exclusion constraint against overlaps; rescheduling | Adds `starts_at` / `ends_at` to bookings and availability, back-filled from day + slot. Existing slots keep working; needs `btree_gist` |
| 3C | Rental inventory: stock per item, quantity holds per time range, dispatch / return / damage / missing movements | New tables only |
| 3D | Vehicles: fleet, driver or self-drive, km/hour allowances, overtime, handover / return inspection, deposits | New tables only |
| 3E | Cart checkout for several services; admin multi-vendor wedding packages with mandatory items | New tables; existing single bookings unchanged |
| 5 | Balance and deposit payments; refund webhooks and reconciliation; return / overdue / balance reminders; disputes | New payment types; webhook additions |
| 4 / 6 | UI in the three apps for each slice, as it lands, with tests and builds each time | — |

The project is **not production-ready**. Hosting, the SMS provider, the Firebase and Razorpay live keys, CI and a
device test are still open, as are the gaps above.
