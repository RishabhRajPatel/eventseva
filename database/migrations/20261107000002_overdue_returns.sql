-- migrate:up
-- Rentals and vehicles have a return_due_at, but nothing ever chased a late one: stock stayed out,
-- the deposit stayed held and neither side was told. The sweep now reminds both, once a day while
-- the booking is still open, and the admin panel can list what is out.
ALTER TABLE bookings ADD COLUMN overdue_reminded_at timestamptz;
COMMENT ON COLUMN bookings.overdue_reminded_at IS 'Last time both sides were reminded that the return is late; null until the first reminder';

-- The claim looks for open rentals and vehicles past their return time. Partial, because only
-- these two booking types have a return at all.
CREATE INDEX bookings_overdue_return_idx ON bookings (return_due_at)
  WHERE booking_type IN ('rental', 'transport') AND status = 'confirmed' AND fulfilment <> 'closed';

-- migrate:down
DROP INDEX bookings_overdue_return_idx;
ALTER TABLE bookings DROP COLUMN overdue_reminded_at;
