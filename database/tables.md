<!-- GENERATED FILE: do not edit. Run `pnpm --filter @eventseva/backend db:docs` after adding a migration. -->

# EventSeva database tables

30 tables in PostgreSQL. Money is always in paise (₹1 = 100); `day` columns are India dates.
Table descriptions come from `COMMENT ON TABLE` in the migrations.

## Contents

- **Accounts and login:** [users](#users), [otp_requests](#otp_requests), [sessions](#sessions), [device_tokens](#device_tokens), [admin_users](#admin_users)
- **Catalogue:** [cities](#cities), [categories](#categories)
- **Vendors:** [vendors](#vendors), [vendor_documents](#vendor_documents), [vendor_bank_accounts](#vendor_bank_accounts), [services](#services), [packages](#packages), [media](#media), [availability](#availability)
- **Events and bookings:** [events](#events), [bookings](#bookings), [reviews](#reviews), [shortlists](#shortlists)
- **Money:** [payments](#payments), [payouts](#payouts), [coupons](#coupons), [coupon_redemptions](#coupon_redemptions), [featured_plans](#featured_plans), [featured_purchases](#featured_purchases)
- **Messages, notifications and support:** [conversations](#conversations), [messages](#messages), [notifications](#notifications), [complaints](#complaints), [admin_audit_log](#admin_audit_log)
- **Other:** [system_alerts](#system_alerts)

## Allowed values (enums)

- `admin_role`: `super`, `support`, `verifier`, `finance`
- `booking_status`: `requested`, `accepted`, `rejected`, `expired`, `confirmed`, `completed`, `cancelled_by_customer`, `cancelled_by_vendor`
- `media_type`: `photo`, `video`
- `payment_status`: `created`, `paid`, `failed`, `refunded`
- `payment_type`: `advance`, `final`, `refund`
- `payout_status`: `scheduled`, `processing`, `paid`, `failed`, `held`
- `pricing_unit`: `per_event`, `per_day`, `per_shift`, `per_plate`, `per_hour`, `per_km`, `per_room_night`, `per_person`, `package`
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
| `totp_secret` | text | yes |  |  |
| `role` | admin_role | yes |  |  |
| `is_active` | boolean | yes | `true` |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |
| `failed_logins` | integer | yes | `0` |  |
| `locked_until` | timestamp with time zone |  |  |  |
| `tokens_valid_after` | timestamp with time zone |  |  |  |

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

<details><summary>Rules and indexes</summary>

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

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (user_id)`
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

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((last4 IS NULL) OR (last4 ~ '^\d{4}$'::text)))`
- Check: `CHECK ((doc_type = ANY (ARRAY['aadhaar'::text, 'pan'::text, 'gst'::text, 'shop_photo'::text])))`
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

<details><summary>Rules and indexes</summary>

- Check: `CHECK ((price_paise > 0))`

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

<details><summary>Rules and indexes</summary>

- Unique: `UNIQUE (public_id)`
- Unique: `UNIQUE (vendor_id, file_hash)`
- Index: `CREATE INDEX ON media USING btree (status, created_at) WHERE (status = 'pending'::review_status)`
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

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((service_id IS NOT NULL) OR (package_id IS NOT NULL)))`
- Check: `CHECK ((discount_paise >= 0))`
- Check: `CHECK ((payout_deduction_paise >= 0))`
- Check: `CHECK ((quantity > 0))`
- Check: `CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text])))`
- Index: `CREATE INDEX ON bookings USING btree (customer_id, created_at DESC)`
- Index: `CREATE INDEX ON bookings USING btree (customer_id) WHERE (status = 'requested'::booking_status)`
- Index: `CREATE UNIQUE INDEX ON bookings USING btree (event_id, vendor_id) WHERE (status = ANY (ARRAY['requested'::booking_status, 'accepted'::booking_status, 'confirmed'::booking_status]))`
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
- Index: `CREATE INDEX ON reviews USING btree (vendor_id, created_at DESC) WHERE (NOT is_hidden)`

</details>

### shortlists

Vendors a customer saved (the heart button).

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `customer_id` | uuid | yes |  | primary key; → [users](#users).id |
| `vendor_id` | uuid | yes |  | primary key; → [vendors](#vendors).id |
| `created_at` | timestamp with time zone | yes | `now()` |  |

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
| `sender_id` | uuid | yes |  | → [users](#users).id |
| `body` | text | yes |  |  |
| `read_at` | timestamp with time zone |  |  |  |
| `created_at` | timestamp with time zone | yes | `now()` |  |

<details><summary>Rules and indexes</summary>

- Check: `CHECK (((length(body) >= 1) AND (length(body) <= 2000)))`
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

## Other

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
