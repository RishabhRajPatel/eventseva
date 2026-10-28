-- migrate:up
-- Cash bookings: a vendor may accept cash for a service or package; the customer then chooses to pay
-- the whole booking to the vendor in person. The vendor records the cash they take or give back, and
-- EventSeva's commission becomes a due the vendor owes, taken from their next online payouts or settled
-- with finance.
ALTER TABLE services ADD COLUMN cash_allowed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN services.cash_allowed IS 'The vendor accepts cash for this service: customers may choose to pay the whole booking to the vendor';
ALTER TABLE packages ADD COLUMN cash_allowed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN packages.cash_allowed IS 'The vendor accepts cash for this package';

ALTER TABLE bookings ADD COLUMN pay_mode text NOT NULL DEFAULT 'online' CHECK (pay_mode IN ('online', 'cash'));
COMMENT ON COLUMN bookings.pay_mode IS 'online: advance, balance and deposit through Razorpay. cash: everything is paid to the vendor in person; confirmed when the vendor accepts';

-- A cash booking is confirmed straight from the vendor's acceptance (no advance to wait for).
INSERT INTO booking_state_moves (from_state, to_state) VALUES ('pending_vendor', 'confirmed');

CREATE TABLE cash_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  kind text NOT NULL CHECK (kind IN ('advance', 'balance', 'deposit', 'deposit_return', 'refund')),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  note text CHECK (length(note) <= 300),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE cash_receipts IS 'Cash the vendor took from the customer (advance, balance, deposit) or gave back (deposit_return, refund), as the vendor recorded it; the customer is told each time';
CREATE INDEX cash_receipts_booking_idx ON cash_receipts (booking_id, created_at);

CREATE TABLE commission_dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  remaining_paise integer NOT NULL CHECK (remaining_paise >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'waived')),
  reference text CHECK (length(reference) <= 200),
  settled_by uuid REFERENCES admin_users(id),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining_paise <= amount_paise),
  CHECK ((status = 'open') = (settled_at IS NULL)),
  CHECK (status <> 'settled' OR remaining_paise = 0)
);
COMMENT ON TABLE commission_dues IS 'EventSeva commission on completed cash bookings, owed by the vendor: taken from their next online payouts, or settled / waived by finance';
COMMENT ON COLUMN commission_dues.reference IS 'How it was settled: a payout id, a UPI/bank reference from finance, or the reason it was waived';
CREATE INDEX commission_dues_open_idx ON commission_dues (vendor_id, created_at) WHERE status = 'open';

ALTER TABLE payouts ADD COLUMN dues_deducted_paise integer NOT NULL DEFAULT 0 CHECK (dues_deducted_paise >= 0);
COMMENT ON COLUMN payouts.dues_deducted_paise IS 'Commission owed on cash bookings taken off this payout';

-- migrate:down
ALTER TABLE payouts DROP COLUMN dues_deducted_paise;
DROP TABLE commission_dues;
DROP TABLE cash_receipts;
DELETE FROM booking_state_moves WHERE from_state = 'pending_vendor' AND to_state = 'confirmed';
ALTER TABLE bookings DROP COLUMN pay_mode;
ALTER TABLE packages DROP COLUMN cash_allowed;
ALTER TABLE services DROP COLUMN cash_allowed;
