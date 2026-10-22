-- migrate:up

-- Coupons. EventSeva pays the discount: it lowers what the customer pays online (the advance),
-- never the vendor's payout.
CREATE TABLE coupons (
  id                  serial PRIMARY KEY,
  code                text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{3,20}$'),
  title_en            text NOT NULL,
  title_hi            text NOT NULL,
  discount_type       text NOT NULL CHECK (discount_type IN ('percent', 'flat')),
  discount_value      int  NOT NULL CHECK (discount_value > 0),   -- percent, or paise when flat
  max_discount_paise  int  CHECK (max_discount_paise > 0),
  min_amount_paise    int  NOT NULL DEFAULT 0 CHECK (min_amount_paise >= 0),
  category_id         int  REFERENCES categories(id),
  first_booking_only  boolean NOT NULL DEFAULT false,
  is_public           boolean NOT NULL DEFAULT true,               -- shown on the app's offers banner
  max_uses            int  CHECK (max_uses > 0),
  per_customer_limit  int  NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_until         timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_type <> 'percent' OR discount_value <= 100),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- 'applied' holds a use while the booking waits for payment; 'used' once paid; 'released' if the
-- booking ends unpaid or the customer removes the coupon.
CREATE TABLE coupon_redemptions (
  id              bigserial PRIMARY KEY,
  coupon_id       int  NOT NULL REFERENCES coupons(id),
  booking_id      uuid NOT NULL REFERENCES bookings(id),
  customer_id     uuid NOT NULL REFERENCES users(id),
  discount_paise  int  NOT NULL CHECK (discount_paise > 0),
  status          text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'used', 'released')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz
);
CREATE UNIQUE INDEX coupon_redemptions_one_live_per_booking ON coupon_redemptions (booking_id) WHERE status <> 'released';
CREATE INDEX ON coupon_redemptions (coupon_id, status);
CREATE INDEX ON coupon_redemptions (customer_id, coupon_id);

ALTER TABLE bookings
  ADD COLUMN discount_paise int NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  -- Taken off the vendor's payout by an admin refund (e.g. the vendor came late).
  ADD COLUMN payout_deduction_paise int NOT NULL DEFAULT 0 CHECK (payout_deduction_paise >= 0);

-- Featured listings: vendors pay to appear first in search for a number of days.
CREATE TABLE featured_plans (
  id           serial PRIMARY KEY,
  name_en      text NOT NULL,
  name_hi      text NOT NULL,
  days         int  NOT NULL CHECK (days BETWEEN 1 AND 365),
  price_paise  int  NOT NULL CHECK (price_paise >= 100),
  is_active    boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO featured_plans (name_en, name_hi, days, price_paise, sort_order) VALUES
  ('Featured for 7 days',  '7 दिन फ़ीचर्ड',  7,  49900, 1),
  ('Featured for 30 days', '30 दिन फ़ीचर्ड', 30, 149900, 2);

CREATE TABLE featured_purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id            uuid NOT NULL REFERENCES vendors(id),
  plan_id              int REFERENCES featured_plans(id),          -- null when an admin grants days
  days                 int NOT NULL CHECK (days > 0),
  amount_paise         int NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  razorpay_order_id    text UNIQUE,
  razorpay_payment_id  text UNIQUE,
  status               text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'granted')),
  granted_by           uuid REFERENCES admin_users(id),
  reason               text,
  starts_at            timestamptz,
  ends_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
CREATE INDEX ON featured_purchases (vendor_id, created_at DESC);
CREATE INDEX ON featured_purchases (status, paid_at);

-- Cities show in Hindi too.
ALTER TABLE cities ADD COLUMN name_hi text;
UPDATE cities SET name_hi = 'प्रयागराज' WHERE name = 'Prayagraj';
UPDATE cities SET name_hi = name WHERE name_hi IS NULL;
ALTER TABLE cities ALTER COLUMN name_hi SET NOT NULL;

CREATE INDEX ON admin_audit_log (created_at DESC);
CREATE INDEX ON admin_audit_log (target_type, target_id);

-- migrate:down
DROP INDEX IF EXISTS admin_audit_log_target_type_target_id_idx;
DROP INDEX IF EXISTS admin_audit_log_created_at_idx;
ALTER TABLE cities DROP COLUMN name_hi;
DROP TABLE featured_purchases;
DROP TABLE featured_plans;
ALTER TABLE bookings DROP COLUMN discount_paise, DROP COLUMN payout_deduction_paise;
DROP TABLE coupon_redemptions;
DROP TABLE coupons;
