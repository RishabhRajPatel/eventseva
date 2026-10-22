-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE vendor_status   AS ENUM ('draft', 'pending', 'approved', 'rejected', 'on_hold');
CREATE TYPE pricing_unit    AS ENUM ('per_event', 'per_day', 'per_shift', 'per_plate', 'per_hour', 'per_km', 'per_room_night', 'per_person', 'package');
CREATE TYPE media_type      AS ENUM ('photo', 'video');
CREATE TYPE review_status   AS ENUM ('uploading', 'pending', 'approved', 'rejected');
CREATE TYPE slot_status     AS ENUM ('free', 'booked', 'blocked');
CREATE TYPE booking_status  AS ENUM ('requested', 'accepted', 'rejected', 'expired', 'confirmed', 'completed', 'cancelled_by_customer', 'cancelled_by_vendor');
CREATE TYPE payment_type    AS ENUM ('advance', 'final', 'refund');
CREATE TYPE payment_status  AS ENUM ('created', 'paid', 'failed', 'refunded');
CREATE TYPE payout_status   AS ENUM ('scheduled', 'processing', 'paid', 'failed', 'held');
CREATE TYPE admin_role      AS ENUM ('super', 'support', 'verifier', 'finance');

-- ---------- Login ----------
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL UNIQUE,              -- +91XXXXXXXXXX
  name         text,
  city_id      int,
  language     text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  is_blocked   boolean NOT NULL DEFAULT false,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  code_hash    text NOT NULL,
  attempts     int  NOT NULL DEFAULT 0,
  ip           inet,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_requests (phone, created_at DESC);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  refresh_token_hash  text NOT NULL UNIQUE,
  app                 text NOT NULL CHECK (app IN ('customer', 'partner')),
  device_name         text,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  fcm_token   text NOT NULL UNIQUE,
  platform    text NOT NULL,                     -- android / ios
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Setup ----------
CREATE TABLE cities (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,               -- Prayagraj
  state      text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true
);
ALTER TABLE users ADD FOREIGN KEY (city_id) REFERENCES cities(id);

CREATE TABLE categories (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,            -- dj, halwai, hall
  name_en       text NOT NULL,
  name_hi       text NOT NULL,
  icon          text NOT NULL,
  default_unit  pricing_unit NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true
);

-- ---------- Vendor ----------
CREATE TABLE vendors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES users(id),
  business_name    text NOT NULL,
  category_id      int  NOT NULL REFERENCES categories(id),
  city_id          int  NOT NULL REFERENCES cities(id),
  area             text,
  address          text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  about            text,
  status           vendor_status NOT NULL DEFAULT 'draft',
  reject_reason    text,
  razorpay_account_id text,                       -- Route linked account
  rating_avg       numeric(2,1) NOT NULL DEFAULT 0,
  rating_count     int NOT NULL DEFAULT 0,
  featured_until   timestamptz,
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vendors (city_id, category_id, status);

CREATE TABLE vendor_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    uuid NOT NULL REFERENCES vendors(id),
  doc_type     text NOT NULL,                     -- aadhaar, pan, gst, shop_photo
  storage_key  text NOT NULL,                     -- private bucket, public URL nahi
  last4        text,                              -- Aadhaar ke sirf last 4
  status       review_status NOT NULL DEFAULT 'pending',
  reviewed_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    uuid NOT NULL REFERENCES vendors(id),
  title        text NOT NULL,
  description  text,
  price_paise  int  NOT NULL CHECK (price_paise > 0),
  unit         pricing_unit NOT NULL,
  min_guests   int,
  max_guests   int,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    uuid NOT NULL REFERENCES vendors(id),
  title        text NOT NULL,
  items        jsonb NOT NULL DEFAULT '[]',       -- ["DJ", "Lights", "5 ghante"]
  price_paise  int  NOT NULL CHECK (price_paise > 0),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid NOT NULL REFERENCES vendors(id),
  type           media_type NOT NULL,
  public_id      text NOT NULL UNIQUE,
  width          int NOT NULL,
  height         int NOT NULL,
  bytes          int NOT NULL,
  duration_sec   int,
  blurhash       text,
  file_hash      text NOT NULL,
  is_cover       boolean NOT NULL DEFAULT false,
  cover_crop     jsonb,
  sort_order     int NOT NULL DEFAULT 0,
  status         review_status NOT NULL DEFAULT 'uploading',
  reject_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, file_hash)
);

CREATE TABLE availability (
  vendor_id   uuid NOT NULL REFERENCES vendors(id),
  day         date NOT NULL,
  slot        text NOT NULL DEFAULT 'full',       -- full / day / night
  status      slot_status NOT NULL DEFAULT 'free',
  booking_id  uuid,
  PRIMARY KEY (vendor_id, day, slot)
);

-- ---------- Booking ----------
CREATE TABLE events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES users(id),
  title          text NOT NULL,                   -- Rahul ki Shaadi
  event_type     text NOT NULL,                   -- wedding, birthday, puja
  event_date     date NOT NULL,
  city_id        int  NOT NULL REFERENCES cities(id),
  venue_address  text,
  guest_count    int,
  budget_paise   int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id),
  customer_id     uuid NOT NULL REFERENCES users(id),
  vendor_id       uuid NOT NULL REFERENCES vendors(id),
  service_id      uuid REFERENCES services(id),
  package_id      uuid REFERENCES packages(id),
  day             date NOT NULL,
  slot            text NOT NULL DEFAULT 'full',
  details         jsonb NOT NULL DEFAULT '{}',    -- category ke hisaab se: guests, menu, route
  amount_paise    int NOT NULL,                    -- server ne tay kiya
  advance_paise   int NOT NULL,
  commission_paise int NOT NULL,
  status          booking_status NOT NULL DEFAULT 'requested',
  respond_by      timestamptz NOT NULL,            -- vendor itne time me jawab de
  cancel_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (service_id IS NOT NULL OR package_id IS NOT NULL)
);
CREATE INDEX ON bookings (customer_id, created_at DESC);
CREATE INDEX ON bookings (vendor_id, day);

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES bookings(id),
  type                 payment_type NOT NULL,
  amount_paise         int NOT NULL,
  razorpay_order_id    text NOT NULL UNIQUE,
  razorpay_payment_id  text UNIQUE,               -- ek payment do baar count nahi
  status               payment_status NOT NULL DEFAULT 'created',
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);

CREATE TABLE payouts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  vendor_id           uuid NOT NULL REFERENCES vendors(id),
  amount_paise        int NOT NULL,
  release_after       timestamptz NOT NULL,        -- event + 1 ya 3 din
  razorpay_transfer_id text UNIQUE,
  status              payout_status NOT NULL DEFAULT 'scheduled',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL UNIQUE REFERENCES bookings(id),   -- ek booking = ek review
  customer_id   uuid NOT NULL REFERENCES users(id),
  vendor_id     uuid NOT NULL REFERENCES vendors(id),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text,
  vendor_reply  text,
  is_hidden     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shortlists (
  customer_id  uuid NOT NULL REFERENCES users(id),
  vendor_id    uuid NOT NULL REFERENCES vendors(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, vendor_id)
);

-- ---------- Chat / support ----------
CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES users(id),
  vendor_id     uuid NOT NULL REFERENCES vendors(id),
  last_message_at timestamptz,
  UNIQUE (customer_id, vendor_id)
);

CREATE TABLE messages (
  id               bigserial PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES conversations(id),
  sender_id        uuid NOT NULL REFERENCES users(id),
  body             text NOT NULL,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, id DESC);

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL,                     -- booking_confirmed, payment_due ...
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, id DESC);

CREATE TABLE complaints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid REFERENCES bookings(id),
  raised_by    uuid NOT NULL REFERENCES users(id),
  subject      text NOT NULL,
  details      text NOT NULL,
  status       text NOT NULL DEFAULT 'open',      -- open / in_progress / resolved
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- Admin ----------
CREATE TABLE admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,                   -- argon2
  totp_secret    text NOT NULL,                   -- 2FA
  role           admin_role NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES admin_users(id),
  action      text NOT NULL,                     -- vendor.approve, refund.create
  target_type text NOT NULL,
  target_id   text NOT NULL,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
