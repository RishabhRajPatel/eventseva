-- migrate:up
-- Several services booked together: vendor bundles (some services mandatory, an optional discount)
-- and checkouts that create all their bookings at once or none (docs/BOOKING_ENGINE.md, "Checkout").

CREATE TABLE service_bundles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid NOT NULL REFERENCES vendors(id),
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description      text CHECK (length(description) <= 500),
  discount_percent integer NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 50),
  -- [{serviceId, mandatory}]: services of this vendor; mandatory ones must all be booked together.
  items            jsonb NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_bundles_vendor_idx ON service_bundles (vendor_id) WHERE is_active;
COMMENT ON TABLE service_bundles IS 'A vendor''s package of several services (e.g. car + decoration): mandatory items, optional discount';

CREATE TABLE checkouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES users(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX checkouts_idempotency_key ON checkouts (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON TABLE checkouts IS 'One customer action that booked several services (possibly several vendors) at once';

ALTER TABLE bookings ADD COLUMN group_id uuid REFERENCES checkouts(id);
CREATE INDEX bookings_group_idx ON bookings (group_id) WHERE group_id IS NOT NULL;
COMMENT ON COLUMN bookings.group_id IS 'The checkout this booking was made in, with the others booked at the same time';

-- migrate:down
DROP INDEX IF EXISTS bookings_group_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS checkouts;
DROP TABLE IF EXISTS service_bundles;
