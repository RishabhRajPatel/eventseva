-- migrate:up
-- 1. Handover codes: a new random code for each step (car handover, rental delivery, return), shown in the
--    customer's app, valid 30 minutes, used once, 5 tries. Only a keyed hash is stored.
CREATE TABLE handover_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  phase text NOT NULL CHECK (phase IN ('handover', 'delivery', 'return')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE handover_codes IS 'One-time codes the customer reads out at a handover, delivery or return; a new one replaces the unused one';
CREATE UNIQUE INDEX handover_codes_open_idx ON handover_codes (booking_id, phase) WHERE used_at IS NULL;

-- 2. One Razorpay order for several bookings of one checkout. Each booking still has its own payment row
--    (its share of the order), so confirmation, refunds and payouts stay per booking.
CREATE TABLE payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  checkout_id uuid NOT NULL REFERENCES checkouts(id),
  razorpay_order_id text NOT NULL UNIQUE,
  razorpay_payment_id text UNIQUE,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'replaced')),
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
COMMENT ON TABLE payment_orders IS 'A Razorpay order paying several bookings of one checkout at once; payments rows with order_group_id are its share per booking';
CREATE INDEX payment_orders_checkout_idx ON payment_orders (checkout_id);
CREATE INDEX payment_orders_open_idx ON payment_orders (created_at) WHERE status = 'created';

ALTER TABLE payments ADD COLUMN order_group_id uuid REFERENCES payment_orders(id);
COMMENT ON COLUMN payments.order_group_id IS 'Set when this booking was paid as part of one order for its checkout; razorpay_payment_id is then shared';
ALTER TABLE payments DROP CONSTRAINT payments_check1;
ALTER TABLE payments ADD CONSTRAINT payments_order_check CHECK (type = 'refund' OR razorpay_order_id IS NOT NULL OR order_group_id IS NOT NULL);
ALTER TABLE payments DROP CONSTRAINT payments_razorpay_payment_id_key;
CREATE UNIQUE INDEX payments_razorpay_payment_id_key ON payments (razorpay_payment_id) WHERE order_group_id IS NULL;
CREATE UNIQUE INDEX payments_group_booking_idx ON payments (order_group_id, booking_id) WHERE order_group_id IS NOT NULL;

-- 3. The request id (X-Request-Id) of the change, so a state move can be traced to its log lines.
ALTER TABLE booking_state_history ADD COLUMN request_id text;

CREATE OR REPLACE FUNCTION booking_state_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (OLD.state IS NOT NULL AND OLD.state IS DISTINCT FROM NEW.state) THEN
    INSERT INTO booking_state_history (booking_id, from_state, to_state, status, fulfilment, actor_kind, actor_id, reason, request_id)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END, NEW.state, NEW.status, NEW.fulfilment,
            booking_actor_kind(), NULLIF(current_setting('eventseva.actor_id', true), '')::uuid,
            COALESCE(NULLIF(current_setting('eventseva.reason', true), ''),
                     CASE WHEN NEW.state IN ('cancelled', 'expired') THEN NEW.cancel_reason END),
            NULLIF(current_setting('eventseva.request_id', true), ''));
  END IF;
  RETURN NULL;
END $$;

-- migrate:down
CREATE OR REPLACE FUNCTION booking_state_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (OLD.state IS NOT NULL AND OLD.state IS DISTINCT FROM NEW.state) THEN
    INSERT INTO booking_state_history (booking_id, from_state, to_state, status, fulfilment, actor_kind, actor_id, reason)
    VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END, NEW.state, NEW.status, NEW.fulfilment,
            booking_actor_kind(), NULLIF(current_setting('eventseva.actor_id', true), '')::uuid,
            COALESCE(NULLIF(current_setting('eventseva.reason', true), ''),
                     CASE WHEN NEW.state IN ('cancelled', 'expired') THEN NEW.cancel_reason END));
  END IF;
  RETURN NULL;
END $$;
ALTER TABLE booking_state_history DROP COLUMN request_id;
DROP INDEX payments_group_booking_idx;
DROP INDEX payments_razorpay_payment_id_key;
ALTER TABLE payments ADD CONSTRAINT payments_razorpay_payment_id_key UNIQUE (razorpay_payment_id);
ALTER TABLE payments DROP CONSTRAINT payments_order_check;
ALTER TABLE payments ADD CONSTRAINT payments_check1 CHECK (type = 'refund' OR razorpay_order_id IS NOT NULL);
ALTER TABLE payments DROP COLUMN order_group_id;
DROP TABLE payment_orders;
DROP TABLE handover_codes;
