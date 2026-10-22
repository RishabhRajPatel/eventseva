-- migrate:up

-- Slots are a whole day, or the day (10–4) or night (6–11) half.
ALTER TABLE availability ADD CHECK (slot IN ('full', 'day', 'night'));

ALTER TABLE bookings
  ADD CHECK (slot IN ('full', 'day', 'night')),
  ADD COLUMN quantity     int NOT NULL DEFAULT 1 CHECK (quantity > 0),  -- plates, hours, km, rooms …
  ADD COLUMN pay_by       timestamptz,                                  -- set on accept: pay the advance before this
  ADD COLUMN refund_paise int NOT NULL DEFAULT 0;

-- One open booking per vendor per event (a second request would be a duplicate).
CREATE UNIQUE INDEX bookings_one_open_per_event_vendor ON bookings (event_id, vendor_id)
  WHERE status IN ('requested', 'accepted', 'confirmed');
-- The sweeper looks these up every minute.
CREATE INDEX ON bookings (status, respond_by) WHERE status = 'requested';
CREATE INDEX ON bookings (status, pay_by) WHERE status = 'accepted';
CREATE INDEX ON bookings (status, day) WHERE status = 'confirmed';

-- Refunds have a refund id but no order id of their own.
ALTER TABLE payments
  ALTER COLUMN razorpay_order_id DROP NOT NULL,
  ADD COLUMN razorpay_refund_id text UNIQUE,
  ADD CHECK ((type = 'refund') = (razorpay_refund_id IS NOT NULL)),
  ADD CHECK ((type = 'refund') OR (razorpay_order_id IS NOT NULL));
CREATE INDEX ON payments (booking_id);

CREATE UNIQUE INDEX payouts_one_per_booking ON payouts (booking_id);

-- migrate:down
DROP INDEX payouts_one_per_booking;
DROP INDEX payments_booking_id_idx;
ALTER TABLE payments DROP COLUMN razorpay_refund_id, DROP CONSTRAINT IF EXISTS payments_check, DROP CONSTRAINT IF EXISTS payments_check1;
DELETE FROM payments WHERE razorpay_order_id IS NULL;
ALTER TABLE payments ALTER COLUMN razorpay_order_id SET NOT NULL;
DROP INDEX bookings_one_open_per_event_vendor;
DROP INDEX bookings_status_respond_by_idx;
DROP INDEX bookings_status_pay_by_idx;
DROP INDEX bookings_status_day_idx;
ALTER TABLE bookings DROP COLUMN quantity, DROP COLUMN pay_by, DROP COLUMN refund_paise, DROP CONSTRAINT IF EXISTS bookings_slot_check;
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_slot_check;
