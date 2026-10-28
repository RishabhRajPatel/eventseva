<!-- GENERATED FILE: do not edit. Run `pnpm --filter @eventseva/backend db:docs` after adding a migration. -->

# EventSeva database tables

49 tables in PostgreSQL. Money is always in paise (₹1 = 100); `day` columns are India dates.
Table descriptions come from `COMMENT ON TABLE` in the migrations.

## Contents

- **Accounts and login:** [users](#users), [otp_requests](#otp_requests), [sessions](#sessions), [device_tokens](#device_tokens), [admin_users](#admin_users)
- **Catalogue:** [cities](#cities), [categories](#categories)
- **Vendors:** [vendors](#vendors), [vendor_documents](#vendor_documents), [vendor_bank_accounts](#vendor_bank_accounts), [services](#services), [packages](#packages), [media](#media), [availability](#availability)
- **Events and bookings:** [events](#events), [bookings](#bookings), [reviews](#reviews), [shortlists](#shortlists)
- **Booking engine: resources, holds and changes:** [resources](#resources), [reservations](#reservations), [capacity_holds](#capacity_holds), [service_addons](#service_addons), [booking_addons](#booking_addons), [booking_inspections](#booking_inspections), [booking_charges](#booking_charges), [booking_changes](#booking_changes), [booking_events](#booking_events), [customer_licences](#customer_licences)
- **Rental stock:** [item_categories](#item_categories), [inventory_items](#inventory_items), [booking_lines](#booking_lines), [inventory_movements](#inventory_movements)
- **Money:** [payments](#payments), [refunds](#refunds), [payouts](#payouts), [coupons](#coupons), [coupon_redemptions](#coupon_redemptions), [featured_plans](#featured_plans), [featured_purchases](#featured_purchases)
- **Messages, notifications and support:** [conversations](#conversations), [messages](#messages), [notifications](#notifications), [complaints](#complaints), [admin_audit_log](#admin_audit_log), [system_alerts](#system_alerts)
- **Other:** [checkouts](#checkouts), [invoice_counters](#invoice_counters), [invoices](#invoices), [service_bundles](#service_bundles)

## Allowed values (enums)

- `admin_role`: `super`, `support`, `verifier`, `finance`
- `booking_status`: `requested`, `accepted`, `rejected`, `expired`, `confirmed`, `completed`, `cancelled_by_customer`, `cancelled_by_vendor`
- `media_type`: `photo`, `video`
- `payment_status`: `created`, `paid`, `failed`, `refunded`
- `payment_type`: `advance`, `final`, `refund`, `deposit`
- `payout_status`: `scheduled`, `processing`, `paid`, `failed`, `held`
- `pricing_unit`: `per_event`, `per_day`, `per_shift`, `per_plate`, `per_hour`, `per_km`, `per_room_night`, `per_person`, `package`
- `refund_status`: `pending`, `sending`, `sent`, `failed`, `processed`
- `review_status`: `uploading`, `pending`, `approved`, `rejected`
- `slot_status`: `free`, `booked`, `blocked`
- `vendor_status`: `draft`, `pending`, `approved`, `rejected`, `on_hold`

## Accounts and login

### users

Everyone who logs in with a phone number: customers and vendors (a vendor is a user with a row in vendors). Deleted accounts keep the row with the phone replaced, for old bookings.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `phone` | text | yes |  |  |
| `name` | text |  |  |  |
| `city_id` | integer |  |  | → [cities](#cities).id |
| `language` | text | yes | `'en'::text` |  |
| `is_blocked` | boolean | yes | `false` |  |
| `deleted_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((language = ANY (ARRAY['en'::text, 'hi'::text])))`
- Unique: `UNIQUE (phone)`

</details>

### otp_requests

One row per OTP sent. Only an HMAC of the code is stored; attempts and created_at drive the 5-wrong-tries lock and the resend limits.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `phone` | text | yes |  |  |
| `code_hash` | text | yes |  |  |
| `attempts` | integer | yes | `0` |  |
| `ip` | inet |  |  |  |
| `expires_at` | timestamp with time zone | yes |  |  |
| `used_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `sms_sent` | boolean | yes | `true` | false when no SMS went out (Play Store reviewer number) |

<details><summary>Rules and indexes</summary>

- Index: `CREATE INDEX ON otp_requests USING btree (ip, created_at DESC) WHERE (ip IS NOT NULL)`
- Index: `CREATE INDEX ON otp_requests USING btree (phone, created_at DESC)`
- Index: `CREATE INDEX ON otp_requests USING btree (created_at) WHERE sms_sent`

</details>

### sessions

One row per logged-in device. Holds only a hash of the refresh token; revoked_at ends the session at once (logout, block, token reuse).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `user_id` | uuid | yes |  | → [users](#users).id |
| `refresh_token_hash` | text | yes |  |  |
| `app` | text | yes |  |  |
| `device_name` | text |  |  |  |
| `expires_at` | timestamp with time zone | yes |  |  |
| `revoked_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))`
- Unique: `UNIQUE (refresh_token_hash)`
- Index: `CREATE INDEX ON sessions USING btree (user_id)`

</details>

### device_tokens

Firebase push tokens, per phone and app (customer or partner).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `user_id` | uuid | yes |  | → [users](#users).id |
| `fcm_token` | text | yes |  |  |
| `platform` | text | yes |  |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `app` | text | yes | `'customer'::text` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))`
- Unique: `UNIQUE (fcm_token)`
- Index: `CREATE INDEX ON device_tokens USING btree (user_id, app)`

</details>

### admin_users

EventSeva team logins for the admin panel: email, scrypt password hash, 2FA secret, role, and lockout state.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `email` | text | yes |  |  |
| `password_hash` | text | yes |  |  |
| `totp_secret` | text | yes |  | 2FA secret, encrypted with BANK_DETAILS_KEY (v1:…); old plain rows are encrypted at the next login |
| `role` | admin_role | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `failed_logins` | integer | yes | `0` |  |
| `locked_until` | timestamp with time zone |  |  |  |
| `tokens_valid_after` | timestamp with time zone |  |  |  |
| `totp_last_step` | bigint |  |  | Time step of the last 2FA code accepted; older or equal steps are refused |
| `recovery_codes` | text[] | yes | `'{}'::text[]` | HMAC hashes of unused one-time recovery codes; a used code is removed |
| `step_up_until` | timestamp with time zone |  |  | Money and personal-data actions need no new 2FA code until this time (5 minutes after one) |
| `step_up_session` | bigint |  |  | The login (token issue time, ms) the window belongs to: another login never inherits it |

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (email)`

</details>

## Catalogue

### cities

Cities EventSeva works in (English and Hindi names). New cities start hidden.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | integer | yes | `nextval('cities_id_seq'::regclass)` | primary key |
| `name` | text | yes |  |  |
| `state` | text | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `name_hi` | text | yes |  |  |

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (name)`

</details>

### categories

Service types (DJ & Sound, Cook & Catering …), managed by super admins. Hidden instead of deleted.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | integer | yes | `nextval('categories_id_seq'::regclass)` | primary key |
| `slug` | text | yes |  |  |
| `name_en` | text | yes |  |  |
| `name_hi` | text | yes |  |  |
| `icon` | text | yes |  |  |
| `default_unit` | pricing_unit | yes |  |  |
| `sort_order` | integer | yes | `0` |  |
| `is_active` | boolean | yes | `true` |  |
| `booking_type` | text | yes | `'slot'::text` | How new services in this category are booked (slot, time_window, rental, per_person, staffing, appointment, transport, quote) |
| `group_key` | text | yes | `'other'::text` |  |
| `template` | jsonb | yes | `'{}'::jsonb` | Vendor attributes, customer questions and default rules for this kind of service; checked by checkTemplate() |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((booking_type = ANY (ARRAY['slot'::text, 'time_window'::text, 'rental'::text, 'per_person'::text, 'staffing'::text, 'appointment'::text, 'transport'::text, 'quote'::text])))`
- Check: `CHECK ((group_key = ANY (ARRAY['wedding'::text, 'entertainment'::text, 'catering'::text, 'transport'::text, 'wedding_services'::text, 'other'::text])))`
- Unique: `UNIQUE (slug)`

</details>

## Vendors

### vendors

A business profile owned by one user. status: draft → pending → approved / rejected / on_hold. featured_until puts it first in search.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `user_id` | uuid | yes |  | → [users](#users).id |
| `business_name` | text | yes |  |  |
| `category_id` | integer | yes |  | → [categories](#categories).id |
| `city_id` | integer | yes |  | → [cities](#cities).id |
| `area` | text |  |  |  |
| `address` | text |  |  |  |
| `lat` | numeric(9,6) |  |  |  |
| `lng` | numeric(9,6) |  |  |  |
| `about` | text |  |  |  |
| `status` | vendor_status | yes | `'draft'::vendor_status` |  |
| `reject_reason` | text |  |  |  |
| `razorpay_account_id` | text |  |  |  |
| `rating_avg` | numeric(2,1) | yes | `0` |  |
| `rating_count` | integer | yes | `0` |  |
| `featured_until` | timestamp with time zone |  |  |  |
| `approved_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `service_radius_km` | integer |  |  | Usual travel range from the vendor's location; null = not set |
| `gstin` | text |  |  | The vendor's GST number, if registered; customer invoices are tax invoices only with it |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((service_radius_km >= 1) AND (service_radius_km <= 500)))`
- Check: `CHECK ((gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text))`
- Unique: `UNIQUE (user_id)`
- Index: `CREATE INDEX ON vendors USING gin (area gin_trgm_ops)`
- Index: `CREATE INDEX ON vendors USING gin (business_name gin_trgm_ops)`
- Index: `CREATE INDEX ON vendors USING btree (city_id, category_id, status)`

</details>

### vendor_documents

Private ID documents (Aadhaar, PAN, GST, shop photo) for verification; only the last 4 Aadhaar digits are stored.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `doc_type` | text | yes |  |  |
| `storage_key` | text | yes |  |  |
| `last4` | text |  |  |  |
| `status` | review_status | yes | `'pending'::review_status` |  |
| `reviewed_by` | uuid |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `format` | text | yes | `'jpg'::text` |  |
| `reject_reason` | text |  |  |  |
| `resource_id` | uuid |  |  | → [resources](#resources).id |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((last4 IS NULL) OR (last4 ~ '^\d{4}$'::text)))`
- Check: `CHECK ((doc_type = ANY (ARRAY['aadhaar'::text, 'pan'::text, 'gst'::text, 'shop_photo'::text, 'vehicle_rc'::text, 'vehicle_insurance'::text, 'vehicle_permit'::text, 'vehicle_puc'::text, 'driver_licence'::text, 'police_verification'::text])))`
- Index: `CREATE INDEX ON vendor_documents USING btree (vendor_id, created_at DESC)`

</details>

### vendor_bank_accounts

Where payouts go. The account number is AES-256-GCM encrypted (BANK_DETAILS_KEY); only the last 4 digits are readable.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `vendor_id` | uuid | yes |  | primary key; → [vendors](#vendors).id |
| `holder_name` | text | yes |  |  |
| `account_enc` | text | yes |  |  |
| `account_last4` | text | yes |  |  |
| `ifsc` | text | yes |  |  |
| `upi_id` | text |  |  |  |
| `status` | text | yes | `'pending'::text` |  |
| `reject_reason` | text |  |  |  |
| `verified_by` | uuid |  |  | → [admin_users](#admin_users).id |
| `updated_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((account_last4 ~ '^\d{4}$'::text))`
- Check: `CHECK ((ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'::text))`
- Check: `CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])))`

</details>

### services

What a vendor sells, priced per unit (per event, per plate, per day …). Soft-deleted with is_active.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `title` | text | yes |  |  |
| `description` | text |  |  |  |
| `price_paise` | integer | yes |  |  |
| `unit` | pricing_unit | yes |  |  |
| `min_guests` | integer |  |  |  |
| `max_guests` | integer |  |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `booking_type` | text | yes | `'slot'::text` | Copied from the category when the service is created; old services stay slot |
| `pricing` | jsonb | yes | `'{}'::jsonb` | Pricing model and rates for the engine (fixed, hourly, daily, per_unit, per_person, per_trip, quote) |
| `rules` | jsonb | yes | `'{}'::jsonb` | Vendor overrides of the category rule defaults (durations, buffers, quantities, advance, deposit, approval) |
| `attributes` | jsonb | yes | `'{}'::jsonb` |  |
| `resource_id` | uuid |  |  | → [resources](#resources).id; For a service that is one specific resource (a car, a hall): that resource |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((price_paise > 0))`
- Index: `CREATE INDEX ON services USING btree (vendor_id)`

</details>

### packages

Fixed-price bundles a vendor offers ("Gold: DJ + lights + 5 hours").

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `title` | text | yes |  |  |
| `items` | jsonb | yes | `'[]'::jsonb` |  |
| `price_paise` | integer | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((price_paise > 0))`
- Index: `CREATE INDEX ON packages USING btree (vendor_id)`

</details>

### media

Vendor photos and videos on Cloudinary. Customers see them only after admin approval.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `type` | media_type | yes |  |  |
| `public_id` | text | yes |  |  |
| `width` | integer | yes |  |  |
| `height` | integer | yes |  |  |
| `bytes` | integer | yes |  |  |
| `duration_sec` | integer |  |  |  |
| `blurhash` | text |  |  |  |
| `file_hash` | text | yes |  |  |
| `is_cover` | boolean | yes | `false` |  |
| `cover_crop` | jsonb |  |  |  |
| `sort_order` | integer | yes | `0` |  |
| `status` | review_status | yes | `'uploading'::review_status` |  |
| `reject_reason` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `resource_id` | uuid |  |  | → [resources](#resources).id |
| `addon_id` | uuid |  |  | → [service_addons](#service_addons).id |
| `inventory_item_id` | uuid |  |  | → [inventory_items](#inventory_items).id; Photo of a rental item (not shown in the vendor gallery) |

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (public_id)`
- Unique: `UNIQUE (vendor_id, file_hash)`
- Index: `CREATE INDEX ON media USING btree (inventory_item_id) WHERE (inventory_item_id IS NOT NULL)`
- Index: `CREATE INDEX ON media USING btree (resource_id) WHERE (resource_id IS NOT NULL)`
- Index: `CREATE INDEX ON media USING btree (status, created_at) WHERE (status = 'pending'::review_status)`
- Index: `CREATE INDEX ON media USING btree (vendor_id)`
- Index: `CREATE INDEX ON media USING btree (vendor_id, sort_order) WHERE (status = 'approved'::review_status)`

</details>

### availability

Busy slots on a vendor's calendar: booked (held by an accepted booking) or blocked by the vendor. Free days have no row.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `vendor_id` | uuid | yes |  | primary key; → [vendors](#vendors).id |
| `day` | date | yes |  | primary key |
| `slot` | text | yes | `'full'::text` | primary key |
| `status` | slot_status | yes | `'free'::slot_status` |  |
| `booking_id` | uuid |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text])))`

</details>

## Events and bookings

### events

A customer's occasion (wedding, birthday …) that bookings belong to.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `title` | text | yes |  |  |
| `event_type` | text | yes |  |  |
| `event_date` | date | yes |  |  |
| `city_id` | integer | yes |  | → [cities](#cities).id |
| `venue_address` | text |  |  |  |
| `guest_count` | integer |  |  |  |
| `budget_paise` | integer |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `venue_lat` | numeric(9,6) |  |  | Venue pin (with venue_lng); from the address or the phone's location |
| `venue_lng` | numeric(9,6) |  |  |  |
| `venue_landmark` | text |  |  | Nearby landmark to help the vendor find the venue |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((venue_lat IS NULL) = (venue_lng IS NULL)))`
- Index: `CREATE INDEX ON events USING btree (customer_id, event_date)`

</details>

### bookings

One vendor booked for one event and slot. requested → accepted → confirmed (advance paid) → completed; money in paise, priced by the server.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `event_id` | uuid | yes |  | → [events](#events).id |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `service_id` | uuid |  |  | → [services](#services).id |
| `package_id` | uuid |  |  | → [packages](#packages).id |
| `day` | date | yes |  |  |
| `slot` | text | yes | `'full'::text` |  |
| `details` | jsonb | yes | `'{}'::jsonb` |  |
| `amount_paise` | integer | yes |  |  |
| `advance_paise` | integer | yes |  |  |
| `commission_paise` | integer | yes |  |  |
| `status` | booking_status | yes | `'requested'::booking_status` |  |
| `respond_by` | timestamp with time zone | yes |  |  |
| `cancel_reason` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `quantity` | integer | yes | `1` |  |
| `pay_by` | timestamp with time zone |  |  |  |
| `refund_paise` | integer | yes | `0` |  |
| `discount_paise` | integer | yes | `0` |  |
| `payout_deduction_paise` | integer | yes | `0` |  |
| `progress` | text |  |  | Event day: on_the_way (with eta_at) or reached, set by the vendor |
| `progress_at` | timestamp with time zone |  |  |  |
| `eta_at` | timestamp with time zone |  |  |  |
| `reminder_sent_at` | timestamp with time zone |  |  | When the day-before reminder went to both sides |
| `booking_type` | text | yes | `'slot'::text` |  |
| `starts_at` | timestamp with time zone |  |  | When the service starts (pickup, dispatch, appointment); ends_at when it ends or is due back |
| `ends_at` | timestamp with time zone |  |  |  |
| `occupy_from` | timestamp with time zone |  |  | Resources are held from occupy_from to occupy_until: the service time plus setup, dismantling, cleaning and turnaround buffers |
| `occupy_until` | timestamp with time zone |  |  |  |
| `return_due_at` | timestamp with time zone |  |  |  |
| `snapshot` | jsonb | yes | `'{}'::jsonb` | Immutable copy of what was agreed: rules, pricing, the itemised quote, answers, add-ons and attributes |
| `cancellation_policy` | jsonb |  |  | Refund tiers agreed at booking time; later policy changes never apply to this booking |
| `tax_paise` | integer | yes | `0` |  |
| `deposit_paise` | integer | yes | `0` | Refundable security deposit; kept apart from booking revenue |
| `charges_paise` | integer | yes | `0` | Accepted extra charges (overtime, extra km, damage …) on top of amount_paise |
| `fulfilment` | text | yes | `'scheduled'::text` | Progress after confirmation. Rentals: scheduled → preparing → dispatched → delivered → return_pending → closed (returned and verified). Others: scheduled → assigned → ready → in_progress → return_pending → closed |
| `actual_start_at` | timestamp with time zone |  |  |  |
| `actual_end_at` | timestamp with time zone |  |  |  |
| `idempotency_key` | text |  |  |  |
| `deposit_settled_at` | timestamp with time zone |  |  | When agreed charges were taken from the security deposit and the rest refunded; rentals complete only after this |
| `group_id` | uuid |  |  | → [checkouts](#checkouts).id; The checkout this booking was made in, with the others booked at the same time |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((ends_at IS NULL) OR (ends_at > starts_at)))`
- Check: `CHECK (((service_id IS NOT NULL) OR (package_id IS NOT NULL)))`
- Check: `CHECK ((deposit_paise >= 0))`
- Check: `CHECK ((discount_paise >= 0))`
- Check: `CHECK ((fulfilment = ANY (ARRAY['scheduled'::text, 'preparing'::text, 'assigned'::text, 'ready'::text, 'dispatched'::text, 'delivered'::text, 'in_progress'::text, 'return_pending'::text, 'closed'::text])))`
- Check: `CHECK ((payout_deduction_paise >= 0))`
- Check: `CHECK ((progress = ANY (ARRAY['on_the_way'::text, 'reached'::text])))`
- Check: `CHECK ((quantity > 0))`
- Check: `CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text])))`
- Check: `CHECK ((tax_paise >= 0))`
- Index: `CREATE INDEX ON bookings USING btree (customer_id, created_at DESC)`
- Index: `CREATE INDEX ON bookings USING btree (customer_id) WHERE (status = 'requested'::booking_status)`
- Index: `CREATE INDEX ON bookings USING btree (group_id) WHERE (group_id IS NOT NULL)`
- Index: `CREATE UNIQUE INDEX ON bookings USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)`
- Index: `CREATE INDEX ON bookings USING btree (vendor_id, occupy_from, occupy_until) WHERE (status = ANY (ARRAY['requested'::booking_status, 'accepted'::booking_status, 'confirmed'::booking_status]))`
- Index: `CREATE UNIQUE INDEX ON bookings USING btree (event_id, vendor_id) WHERE ((status = ANY (ARRAY['requested'::booking_status, 'accepted'::booking_status, 'confirmed'::booking_status])) AND (booking_type = 'slot'::text))`
- Index: `CREATE INDEX ON bookings USING btree (package_id) WHERE (package_id IS NOT NULL)`
- Index: `CREATE INDEX ON bookings USING btree (day) WHERE ((status = 'confirmed'::booking_status) AND (reminder_sent_at IS NULL))`
- Index: `CREATE INDEX ON bookings USING btree (service_id) WHERE (service_id IS NOT NULL)`
- Index: `CREATE INDEX ON bookings USING btree (status, day) WHERE (status = 'confirmed'::booking_status)`
- Index: `CREATE INDEX ON bookings USING btree (status, pay_by) WHERE (status = 'accepted'::booking_status)`
- Index: `CREATE INDEX ON bookings USING btree (status, respond_by) WHERE (status = 'requested'::booking_status)`
- Index: `CREATE INDEX ON bookings USING btree (vendor_id, day)`

</details>

### reviews

One rating and comment per completed booking, with an optional vendor reply. Hidden reviews do not count in the rating.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `rating` | smallint | yes |  |  |
| `comment` | text |  |  |  |
| `vendor_reply` | text |  |  |  |
| `is_hidden` | boolean | yes | `false` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((rating >= 1) AND (rating <= 5)))`
- Unique: `UNIQUE (booking_id)`
- Index: `CREATE INDEX ON reviews USING btree (customer_id)`
- Index: `CREATE INDEX ON reviews USING btree (vendor_id, created_at DESC) WHERE (NOT is_hidden)`

</details>

### shortlists

Vendors a customer saved (the heart button).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `customer_id` | uuid | yes |  | primary key; → [users](#users).id |
| `vendor_id` | uuid | yes |  | primary key; → [vendors](#vendors).id |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Index: `CREATE INDEX ON shortlists USING btree (vendor_id)`

</details>

## Booking engine: resources, holds and changes

### resources

Vehicles, drivers, staff, artists, halls and equipment sets that one booking at a time can use; attributes validated per kind in code

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `kind` | text | yes |  |  |
| `name` | text | yes |  |  |
| `attributes` | jsonb | yes | `'{}'::jsonb` |  |
| `status` | text | yes | `'active'::text` |  |
| `verification` | text | yes | `'not_required'::text` |  |
| `reject_reason` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((kind = ANY (ARRAY['vehicle'::text, 'driver'::text, 'staff'::text, 'artist'::text, 'venue'::text, 'equipment'::text, 'crew'::text])))`
- Check: `CHECK ((status = ANY (ARRAY['active'::text, 'maintenance'::text, 'inactive'::text])))`
- Check: `CHECK ((verification = ANY (ARRAY['not_required'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])))`
- Index: `CREATE UNIQUE INDEX ON resources USING btree (upper((attributes ->> 'registration'::text))) WHERE (kind = 'vehicle'::text)`
- Index: `CREATE INDEX ON resources USING btree (vendor_id, kind)`

</details>

### reservations

Time a resource is taken: a hold (expires), active (booked or blocked by the vendor), then released

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `resource_id` | uuid | yes |  | → [resources](#resources).id |
| `booking_id` | uuid |  |  | → [bookings](#bookings).id |
| `period` | tstzrange | yes |  |  |
| `status` | text | yes |  |  |
| `reason` | text |  |  |  |
| `expires_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((status <> 'hold'::text) OR (expires_at IS NOT NULL)))`
- Check: `CHECK ((NOT isempty(period)))`
- Check: `CHECK ((status = ANY (ARRAY['hold'::text, 'active'::text, 'released'::text, 'expired'::text])))`
- Index: `CREATE INDEX ON reservations USING btree (booking_id)`
- Index: `CREATE INDEX ON reservations USING btree (expires_at) WHERE (status = 'hold'::text)`

</details>

### capacity_holds

Quantities taken from a pool for a time (item:<id> stock, staff:<kind> head-count, guests:<service> per day); checked under an advisory lock

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `pool_key` | text | yes |  |  |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `booking_id` | uuid |  |  | → [bookings](#bookings).id |
| `qty` | integer | yes |  |  |
| `period` | tstzrange | yes |  |  |
| `status` | text | yes |  |  |
| `expires_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `until_returned` | boolean | yes | `false` | Stock dispatched and not yet checked back in: blocks the pool past the end of its period |
| `note` | text |  |  | A vendor's own block (no booking): why the stock is unavailable |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((booking_id IS NOT NULL) OR (note IS NOT NULL)))`
- Check: `CHECK ((length(note) <= 200))`
- Check: `CHECK ((qty > 0))`
- Check: `CHECK ((status = ANY (ARRAY['hold'::text, 'active'::text, 'released'::text, 'expired'::text])))`
- Index: `CREATE INDEX ON capacity_holds USING btree (booking_id)`
- Index: `CREATE INDEX ON capacity_holds USING gist (pool_key, period) WHERE (status = ANY (ARRAY['hold'::text, 'active'::text]))`

</details>

### service_addons

Optional extras a vendor offers (car decoration packages, drone, album, makeup trial); custom ones need vendor approval

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `service_id` | uuid |  |  | → [services](#services).id |
| `name` | text | yes |  |  |
| `kind` | text | yes | `'extra'::text` |  |
| `inclusions` | text[] | yes | `'{}'::text[]` |  |
| `exclusions` | text[] | yes | `'{}'::text[]` |  |
| `price_paise` | integer | yes |  |  |
| `setup_minutes` | integer | yes | `0` |  |
| `requires_approval` | boolean | yes | `false` |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((price_paise >= 0))`
- Check: `CHECK ((setup_minutes >= 0))`
- Index: `CREATE INDEX ON service_addons USING btree (vendor_id)`

</details>

### booking_addons

Extras chosen with a booking, at the price agreed; ones needing approval are approved or declined when the vendor accepts

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `booking_id` | uuid | yes |  | primary key; → [bookings](#bookings).id |
| `addon_id` | uuid | yes |  | primary key; → [service_addons](#service_addons).id |
| `price_paise` | integer | yes |  |  |
| `request_note` | text |  |  |  |
| `status` | text | yes |  |  |
| `decided_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((status = ANY (ARRAY['included'::text, 'pending_approval'::text, 'approved'::text, 'declined'::text])))`

</details>

### booking_inspections

Condition at handover and return (odometer, fuel, damage, counts, photos) and the customer's agreement or dispute

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `phase` | text | yes |  |  |
| `readings` | jsonb | yes | `'{}'::jsonb` |  |
| `notes` | text |  |  |  |
| `photo_ids` | text[] | yes | `'{}'::text[]` |  |
| `recorded_by` | uuid | yes |  | → [users](#users).id |
| `recorded_at` | timestamp with time zone | yes | `now()` |  |
| `customer_ack` | text |  |  |  |
| `customer_note` | text |  |  |  |
| `acked_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((customer_ack = ANY (ARRAY['agreed'::text, 'disputed'::text])))`
- Check: `CHECK ((phase = ANY (ARRAY['handover'::text, 'return'::text, 'dispatch'::text, 'delivery'::text])))`
- Unique: `UNIQUE (booking_id, phase)`

</details>

### booking_charges

Extra charges after the service (km, hours, late return, damage …): proposed by the vendor, accepted or disputed by the customer, decided by an admin in a dispute

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `kind` | text | yes |  |  |
| `description` | text | yes |  |  |
| `qty` | numeric | yes | `1` |  |
| `amount_paise` | integer | yes |  |  |
| `status` | text | yes | `'proposed'::text` |  |
| `from_deposit` | boolean | yes | `false` |  |
| `evidence_ids` | text[] | yes | `'{}'::text[]` |  |
| `created_by` | uuid | yes |  | → [users](#users).id |
| `decided_by` | uuid |  |  |  |
| `decision_note` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `decided_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((amount_paise > 0))`
- Check: `CHECK ((kind = ANY (ARRAY['extra_km'::text, 'extra_hours'::text, 'late_return'::text, 'waiting'::text, 'toll'::text, 'parking'::text, 'fuel'::text, 'damage'::text, 'missing'::text, 'cleaning'::text, 'extension'::text, 'guest_change'::text, 'other'::text])))`
- Check: `CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'disputed'::text, 'waived'::text, 'resolved'::text])))`
- Index: `CREATE INDEX ON booking_charges USING btree (booking_id)`

</details>

### booking_changes

Requests to extend, reschedule or change the quantity of a booking; one open at a time

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `kind` | text | yes |  |  |
| `requested_by` | uuid | yes |  | → [users](#users).id |
| `new_starts_at` | timestamp with time zone |  |  |  |
| `new_ends_at` | timestamp with time zone |  |  |  |
| `new_qty` | integer |  |  |  |
| `price_diff_paise` | integer | yes | `0` |  |
| `status` | text | yes | `'requested'::text` |  |
| `reason` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `decided_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((kind = ANY (ARRAY['extension'::text, 'reschedule'::text, 'quantity'::text])))`
- Check: `CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))`
- Index: `CREATE INDEX ON booking_changes USING btree (booking_id)`
- Index: `CREATE UNIQUE INDEX ON booking_changes USING btree (booking_id) WHERE (status = 'requested'::text)`

</details>

### booking_events

Audit trail of every state change on a booking (who, when, what)

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('booking_events_id_seq'::regclass)` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `event` | text | yes |  |  |
| `actor_id` | uuid |  |  |  |
| `data` | jsonb | yes | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Index: `CREATE INDEX ON booking_events USING btree (booking_id, id)`

</details>

### customer_licences

Driving licence for self-drive cars: number encrypted (BANK_DETAILS_KEY), verified by an admin or by the vendor at handover

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `user_id` | uuid | yes |  | primary key; → [users](#users).id |
| `number_enc` | text | yes |  |  |
| `number_last4` | text | yes |  |  |
| `date_of_birth` | date | yes |  |  |
| `expires_on` | date | yes |  |  |
| `storage_key` | text |  |  |  |
| `status` | text | yes | `'pending'::text` |  |
| `reject_reason` | text |  |  |  |
| `verified_by` | uuid |  |  |  |
| `updated_at` | timestamp with time zone | yes | `now()` |  |
| `storage_format` | text |  |  | File type of the private licence photo in storage_key (for the expiring view link) |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])))`
- Check: `CHECK ((storage_format = ANY (ARRAY['jpg'::text, 'jpeg'::text, 'png'::text, 'pdf'::text])))`

</details>

## Rental stock

### item_categories

Groups for rental items: the defaults (tent, furniture, cooking, dining, serving, equipment) and categories vendors add themselves

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid |  |  | → [vendors](#vendors).id |
| `key` | text |  |  |  |
| `name_en` | text | yes |  |  |
| `name_hi` | text | yes |  |  |
| `examples_en` | text |  |  |  |
| `examples_hi` | text |  |  |  |
| `sort_order` | integer | yes | `100` |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((length(name_en) >= 2) AND (length(name_en) <= 40)))`
- Check: `CHECK (((length(name_hi) >= 1) AND (length(name_hi) <= 40)))`
- Check: `CHECK (((vendor_id IS NULL) = (key IS NOT NULL)))`
- Index: `CREATE UNIQUE INDEX ON item_categories USING btree (key) WHERE (vendor_id IS NULL)`
- Index: `CREATE UNIQUE INDEX ON item_categories USING btree (vendor_id, lower(name_en)) WHERE ((vendor_id IS NOT NULL) AND is_active)`

</details>

### inventory_items

Rental stock (plates, chairs, speakers, coolers …): how many exist, how many are in repair, price, deposit and damage charge per unit

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `name` | text | yes |  |  |
| `unit` | text | yes | `'piece'::text` |  |
| `total_qty` | integer | yes |  |  |
| `repair_qty` | integer | yes | `0` | Units out of use (damaged, being repaired or cleaned); not bookable |
| `rent_paise` | integer | yes | `0` |  |
| `rent_per` | text | yes | `'booking'::text` |  |
| `deposit_paise` | integer | yes | `0` |  |
| `damage_paise` | integer | yes | `0` |  |
| `min_qty` | integer | yes | `1` |  |
| `attributes` | jsonb | yes | `'{}'::jsonb` |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `category_id` | uuid |  |  | → [item_categories](#item_categories).id |
| `description` | text |  |  |  |
| `quality` | text | yes | `'standard'::text` | basic / standard / premium, or custom with quality_label |
| `quality_label` | text |  |  |  |
| `condition` | text | yes | `'good'::text` | Listing condition; needs_repair stops new bookings |
| `missing_paise` | integer | yes | `0` | Charge per unit not returned (0: use damage_paise) |
| `max_qty` | integer |  |  |  |
| `min_days` | integer | yes | `1` |  |
| `max_days` | integer |  |  |  |
| `deleted_at` | timestamp with time zone |  |  | Removed by the vendor but kept because bookings or stock records point to it |
| `updated_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((deleted_at IS NULL) OR (NOT is_active)))`
- Check: `CHECK (((length(unit) >= 1) AND (length(unit) <= 20)))`
- Check: `CHECK (((max_days IS NULL) OR ((max_days >= 1) AND (max_days <= 60))))`
- Check: `CHECK (((max_days IS NULL) OR (max_days >= min_days)))`
- Check: `CHECK (((max_qty IS NULL) OR (max_qty >= 1)))`
- Check: `CHECK (((min_days >= 1) AND (min_days <= 60)))`
- Check: `CHECK ((condition = ANY (ARRAY['new'::text, 'good'::text, 'used'::text, 'needs_repair'::text])))`
- Check: `CHECK ((damage_paise >= 0))`
- Check: `CHECK ((deposit_paise >= 0))`
- Check: `CHECK ((length(description) <= 1000))`
- Check: `CHECK ((length(quality_label) <= 30))`
- Check: `CHECK ((min_qty >= 1))`
- Check: `CHECK ((missing_paise >= 0))`
- Check: `CHECK ((quality = ANY (ARRAY['basic'::text, 'standard'::text, 'premium'::text, 'custom'::text])))`
- Check: `CHECK ((rent_paise >= 0))`
- Check: `CHECK ((rent_per = ANY (ARRAY['booking'::text, 'day'::text])))`
- Check: `CHECK ((repair_qty <= total_qty))`
- Check: `CHECK ((repair_qty >= 0))`
- Check: `CHECK ((total_qty >= 0))`
- Index: `CREATE INDEX ON inventory_items USING btree (vendor_id, category_id) WHERE is_active`
- Index: `CREATE INDEX ON inventory_items USING btree (vendor_id)`
- Index: `CREATE UNIQUE INDEX ON inventory_items USING btree (vendor_id, lower(name)) WHERE (deleted_at IS NULL)`

</details>

### booking_lines

Items a rental booking takes from stock and their trip: loaded → dispatched → delivered → returned / damaged / missing, then verified

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `inventory_item_id` | uuid | yes |  | → [inventory_items](#inventory_items).id |
| `qty` | integer | yes |  |  |
| `unit_paise` | integer | yes |  |  |
| `deposit_paise` | integer | yes | `0` |  |
| `dispatched_qty` | integer | yes | `0` |  |
| `returned_qty` | integer | yes | `0` |  |
| `damaged_qty` | integer | yes | `0` |  |
| `missing_qty` | integer | yes | `0` |  |
| `item_snapshot` | jsonb | yes | `'{}'::jsonb` | Item name, unit, quality, condition and charges as booked; later listing edits never change it |
| `damage_paise` | integer | yes | `0` |  |
| `missing_paise` | integer | yes | `0` |  |
| `loaded_qty` | integer | yes | `0` |  |
| `delivered_qty` | integer | yes | `0` |  |
| `note` | text |  |  |  |
| `verified_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((((returned_qty + damaged_qty) + missing_qty) <= dispatched_qty))`
- Check: `CHECK (((loaded_qty <= qty) AND (dispatched_qty <= loaded_qty) AND (delivered_qty <= dispatched_qty)))`
- Check: `CHECK ((damage_paise >= 0))`
- Check: `CHECK ((damaged_qty >= 0))`
- Check: `CHECK ((delivered_qty >= 0))`
- Check: `CHECK ((dispatched_qty >= 0))`
- Check: `CHECK ((length(note) <= 500))`
- Check: `CHECK ((loaded_qty >= 0))`
- Check: `CHECK ((missing_paise >= 0))`
- Check: `CHECK ((missing_qty >= 0))`
- Check: `CHECK ((qty > 0))`
- Check: `CHECK ((returned_qty >= 0))`
- Unique: `UNIQUE (booking_id, inventory_item_id)`

</details>

### inventory_movements

Every change to rental stock: dispatch, return, damage, missing, repair, write-off

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('inventory_movements_id_seq'::regclass)` | primary key |
| `inventory_item_id` | uuid | yes |  | → [inventory_items](#inventory_items).id |
| `booking_id` | uuid |  |  | → [bookings](#bookings).id |
| `kind` | text | yes |  |  |
| `qty` | integer | yes |  |  |
| `note` | text |  |  |  |
| `actor_id` | uuid |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((kind = ANY (ARRAY['dispatch'::text, 'return'::text, 'damaged'::text, 'missing'::text, 'repaired'::text, 'written_off'::text, 'added'::text, 'removed'::text])))`
- Check: `CHECK ((qty > 0))`
- Index: `CREATE INDEX ON inventory_movements USING btree (inventory_item_id, created_at DESC)`

</details>

## Money

### payments

Razorpay orders and payments for booking advances, and refunds (type = refund).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `type` | payment_type | yes |  |  |
| `amount_paise` | integer | yes |  |  |
| `razorpay_order_id` | text |  |  |  |
| `razorpay_payment_id` | text |  |  |  |
| `status` | payment_status | yes | `'created'::payment_status` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `paid_at` | timestamp with time zone |  |  |  |
| `razorpay_refund_id` | text |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((type = 'refund'::payment_type) = (razorpay_refund_id IS NOT NULL)))`
- Check: `CHECK (((type = 'refund'::payment_type) OR (razorpay_order_id IS NOT NULL)))`
- Unique: `UNIQUE (razorpay_order_id)`
- Unique: `UNIQUE (razorpay_payment_id)`
- Unique: `UNIQUE (razorpay_refund_id)`
- Index: `CREATE INDEX ON payments USING btree (booking_id)`

</details>

### refunds

Refund queue: every refund is recorded here first and sent to Razorpay after the booking change commits, with safe retries.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `razorpay_payment_id` | text | yes |  |  |
| `amount_paise` | integer | yes |  |  |
| `reason` | text | yes |  | cancellation, late_payment, replaced_order or admin |
| `status` | refund_status | yes | `'pending'::refund_status` | pending → sending → sent; failed after too many attempts (raises a system alert) |
| `attempts` | integer | yes | `0` |  |
| `next_attempt_at` | timestamp with time zone | yes | `now()` |  |
| `last_error` | text |  |  |  |
| `razorpay_refund_id` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `sent_at` | timestamp with time zone |  |  |  |
| `processed_at` | timestamp with time zone |  |  | When Razorpay said the money reached the customer (refund.processed webhook) |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((amount_paise > 0))`
- Unique: `UNIQUE (razorpay_refund_id)`
- Index: `CREATE INDEX ON refunds USING btree (booking_id)`
- Index: `CREATE INDEX ON refunds USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::refund_status, 'sending'::refund_status]))`

</details>

### payouts

What EventSeva owes a vendor for a completed booking (advance − commission − deductions), and when it was paid.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `amount_paise` | integer | yes |  |  |
| `release_after` | timestamp with time zone | yes |  |  |
| `razorpay_transfer_id` | text |  |  |  |
| `status` | payout_status | yes | `'scheduled'::payout_status` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (razorpay_transfer_id)`
- Index: `CREATE UNIQUE INDEX ON payouts USING btree (booking_id)`
- Index: `CREATE INDEX ON payouts USING btree (status, release_after)`
- Index: `CREATE INDEX ON payouts USING btree (vendor_id, release_after DESC)`

</details>

### coupons

Discount codes. EventSeva pays the discount; it lowers the advance paid online, never the vendor's payout.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | integer | yes | `nextval('coupons_id_seq'::regclass)` | primary key |
| `code` | text | yes |  |  |
| `title_en` | text | yes |  |  |
| `title_hi` | text | yes |  |  |
| `discount_type` | text | yes |  |  |
| `discount_value` | integer | yes |  |  |
| `max_discount_paise` | integer |  |  |  |
| `min_amount_paise` | integer | yes | `0` |  |
| `category_id` | integer |  |  | → [categories](#categories).id |
| `first_booking_only` | boolean | yes | `false` |  |
| `is_public` | boolean | yes | `true` |  |
| `max_uses` | integer |  |  |  |
| `per_customer_limit` | integer | yes | `1` |  |
| `valid_from` | timestamp with time zone | yes | `now()` |  |
| `valid_until` | timestamp with time zone |  |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((discount_type <> 'percent'::text) OR (discount_value <= 100)))`
- Check: `CHECK (((valid_until IS NULL) OR (valid_until > valid_from)))`
- Check: `CHECK ((code ~ '^[A-Z0-9]{3,20}$'::text))`
- Check: `CHECK ((discount_type = ANY (ARRAY['percent'::text, 'flat'::text])))`
- Check: `CHECK ((discount_value > 0))`
- Check: `CHECK ((max_discount_paise > 0))`
- Check: `CHECK ((max_uses > 0))`
- Check: `CHECK ((min_amount_paise >= 0))`
- Check: `CHECK ((per_customer_limit > 0))`
- Unique: `UNIQUE (code)`

</details>

### coupon_redemptions

A coupon on a booking: applied (held until payment), used (paid) or released (given back).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('coupon_redemptions_id_seq'::regclass)` | primary key |
| `coupon_id` | integer | yes |  | → [coupons](#coupons).id |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `discount_paise` | integer | yes |  |  |
| `status` | text | yes | `'applied'::text` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `used_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((discount_paise > 0))`
- Check: `CHECK ((status = ANY (ARRAY['applied'::text, 'used'::text, 'released'::text])))`
- Index: `CREATE INDEX ON coupon_redemptions USING btree (coupon_id, status)`
- Index: `CREATE INDEX ON coupon_redemptions USING btree (customer_id, coupon_id)`
- Index: `CREATE UNIQUE INDEX ON coupon_redemptions USING btree (booking_id) WHERE (status <> 'released'::text)`

</details>

### featured_plans

Paid featured-listing plans (days and price) that vendors can buy.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | integer | yes | `nextval('featured_plans_id_seq'::regclass)` | primary key |
| `name_en` | text | yes |  |  |
| `name_hi` | text | yes |  |  |
| `days` | integer | yes |  |  |
| `price_paise` | integer | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `sort_order` | integer | yes | `0` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((days >= 1) AND (days <= 365)))`
- Check: `CHECK ((price_paise >= 100))`

</details>

### featured_purchases

Each featured purchase or free grant, with its Razorpay payment and the period it covers.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `plan_id` | integer |  |  | → [featured_plans](#featured_plans).id |
| `days` | integer | yes |  |  |
| `amount_paise` | integer | yes | `0` |  |
| `razorpay_order_id` | text |  |  |  |
| `razorpay_payment_id` | text |  |  |  |
| `status` | text | yes | `'created'::text` |  |
| `granted_by` | uuid |  |  | → [admin_users](#admin_users).id |
| `reason` | text |  |  |  |
| `starts_at` | timestamp with time zone |  |  |  |
| `ends_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `paid_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((amount_paise >= 0))`
- Check: `CHECK ((days > 0))`
- Check: `CHECK ((status = ANY (ARRAY['created'::text, 'paid'::text, 'granted'::text])))`
- Unique: `UNIQUE (razorpay_order_id)`
- Unique: `UNIQUE (razorpay_payment_id)`
- Index: `CREATE INDEX ON featured_purchases USING btree (status, paid_at)`
- Index: `CREATE INDEX ON featured_purchases USING btree (vendor_id, created_at DESC)`

</details>

## Messages, notifications and support

### conversations

One chat thread per customer and vendor.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `last_message_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (customer_id, vendor_id)`
- Index: `CREATE INDEX ON conversations USING btree (customer_id, last_message_at DESC)`
- Index: `CREATE INDEX ON conversations USING btree (vendor_id, last_message_at DESC)`

</details>

### messages

Chat messages. Phone numbers are masked in the API until a booking between the two is confirmed.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('messages_id_seq'::regclass)` | primary key |
| `conversation_id` | uuid | yes |  | → [conversations](#conversations).id |
| `sender_id` | uuid |  |  | → [users](#users).id |
| `body` | text | yes |  |  |
| `read_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `kind` | text | yes | `'text'::text` | text = typed by a person; booking = an automatic booking update (data has the details) |
| `data` | jsonb |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((kind = 'booking'::text) OR (sender_id IS NOT NULL)))`
- Check: `CHECK (((length(body) >= 1) AND (length(body) <= 2000)))`
- Check: `CHECK ((kind = ANY (ARRAY['text'::text, 'booking'::text])))`
- Index: `CREATE INDEX ON messages USING btree (conversation_id, id DESC)`
- Index: `CREATE INDEX ON messages USING btree (sender_id, created_at DESC)`

</details>

### notifications

In-app notifications in the user's language. pushed_at is set when the push to the phone has gone out.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('notifications_id_seq'::regclass)` | primary key |
| `user_id` | uuid | yes |  | → [users](#users).id |
| `kind` | text | yes |  |  |
| `title` | text | yes |  |  |
| `body` | text | yes |  |  |
| `data` | jsonb | yes | `'{}'::jsonb` |  |
| `read_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `app` | text |  |  |  |
| `pushed_at` | timestamp with time zone |  |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))`
- Index: `CREATE INDEX ON notifications USING btree (id) WHERE (pushed_at IS NULL)`
- Index: `CREATE INDEX ON notifications USING btree (user_id, id DESC)`

</details>

### complaints

Help & support requests from customers or vendors, optionally about a booking.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid |  |  | → [bookings](#bookings).id |
| `raised_by` | uuid | yes |  | → [users](#users).id |
| `subject` | text | yes |  |  |
| `details` | text | yes |  |  |
| `status` | text | yes | `'open'::text` |  |
| `resolution` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text])))`
- Index: `CREATE INDEX ON complaints USING btree (raised_by, created_at DESC)`
- Index: `CREATE INDEX ON complaints USING btree (status, created_at)`

</details>

### admin_audit_log

Every admin action (approve, refund, block, export …) with who, when, and the before/after values.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('admin_audit_log_id_seq'::regclass)` | primary key |
| `admin_id` | uuid | yes |  | → [admin_users](#admin_users).id |
| `action` | text | yes |  |  |
| `target_type` | text | yes |  |  |
| `target_id` | text | yes |  |  |
| `before` | jsonb |  |  |  |
| `after` | jsonb |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Index: `CREATE INDEX ON admin_audit_log USING btree (created_at DESC)`
- Index: `CREATE INDEX ON admin_audit_log USING btree (target_type, target_id)`

</details>

### system_alerts

Problems the system raises for the team (e.g. the daily SMS budget running out), shown on the admin dashboard until someone marks them resolved.

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | bigint | yes | `nextval('system_alerts_id_seq'::regclass)` | primary key |
| `kind` | text | yes |  |  |
| `message` | text | yes |  |  |
| `data` | jsonb | yes | `'{}'::jsonb` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `resolved_at` | timestamp with time zone |  |  |  |
| `resolved_by` | uuid |  |  | → [admin_users](#admin_users).id |

<details><summary>Rules and indexes</summary>

- Index: `CREATE INDEX ON system_alerts USING btree (created_at DESC) WHERE (resolved_at IS NULL)`

</details>

## Other

### checkouts

One customer action that booked several services (possibly several vendors) at once

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `customer_id` | uuid | yes |  | → [users](#users).id |
| `event_id` | uuid | yes |  | → [events](#events).id |
| `idempotency_key` | text |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Index: `CREATE UNIQUE INDEX ON checkouts USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL)`

</details>

### invoice_counters

Next invoice number per series (a vendor or EventSeva, per financial year); numbers never repeat or skip

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `series` | text | yes |  | primary key |
| `last` | integer | yes | `0` |  |

### invoices

Invoices as issued: to the customer in the vendor's name, and EventSeva's commission invoice to the vendor

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `booking_id` | uuid | yes |  | → [bookings](#bookings).id |
| `kind` | text | yes |  |  |
| `number` | text | yes |  |  |
| `issued_at` | timestamp with time zone | yes | `now()` |  |
| `data` | jsonb | yes |  |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((kind = ANY (ARRAY['customer'::text, 'commission'::text])))`
- Unique: `UNIQUE (booking_id, kind)`
- Unique: `UNIQUE (number)`

</details>

### service_bundles

A vendor's package of several services (e.g. car + decoration): mandatory items, optional discount

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | primary key |
| `vendor_id` | uuid | yes |  | → [vendors](#vendors).id |
| `name` | text | yes |  |  |
| `description` | text |  |  |  |
| `discount_percent` | integer | yes | `0` |  |
| `items` | jsonb | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((discount_percent >= 0) AND (discount_percent <= 50)))`
- Check: `CHECK (((length(name) >= 2) AND (length(name) <= 80)))`
- Check: `CHECK ((length(description) <= 500))`
- Index: `CREATE INDEX ON service_bundles USING btree (vendor_id) WHERE is_active`

</details>
