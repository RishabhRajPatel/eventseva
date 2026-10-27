-- migrate:up
-- Refunds are written here inside the booking transaction, then sent to Razorpay after it commits
-- (and retried until they go through). A refund can never be sent twice: before a retry, the sender
-- asks Razorpay whether a refund carrying this row's id already exists.
CREATE TYPE refund_status AS ENUM ('pending', 'sending', 'sent', 'failed');

CREATE TABLE refunds (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  razorpay_payment_id text NOT NULL,
  amount_paise        integer NOT NULL CHECK (amount_paise > 0),
  reason              text NOT NULL,
  status              refund_status NOT NULL DEFAULT 'pending',
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  last_error          text,
  razorpay_refund_id  text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
CREATE INDEX refunds_due_idx ON refunds (next_attempt_at) WHERE status IN ('pending', 'sending');
CREATE INDEX refunds_booking_idx ON refunds (booking_id);
COMMENT ON TABLE refunds IS 'Refund queue: every refund is recorded here first and sent to Razorpay after the booking change commits, with safe retries.';
COMMENT ON COLUMN refunds.reason IS 'cancellation, late_payment, replaced_order or admin';
COMMENT ON COLUMN refunds.status IS 'pending → sending → sent; failed after too many attempts (raises a system alert)';

-- A used 2FA code cannot be used again (someone watching the screen or a phishing page).
ALTER TABLE admin_users ADD COLUMN totp_last_step bigint;
COMMENT ON COLUMN admin_users.totp_last_step IS 'Time step of the last 2FA code accepted; older or equal steps are refused';

-- migrate:down
ALTER TABLE admin_users DROP COLUMN IF EXISTS totp_last_step;
DROP TABLE IF EXISTS refunds;
DROP TYPE IF EXISTS refund_status;
