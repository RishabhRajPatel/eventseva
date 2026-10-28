-- migrate:up
-- One lifecycle state per booking, derived from its status, fulfilment step and open disputes.
-- The database enforces the allowed moves, so no code path (API, admin, job) can skip or reverse one,
-- and every move is written to booking_state_history with who made it and why.
-- `status`, `fulfilment`, payment, refund and payout statuses stay as they are; apps keep working.
CREATE TYPE booking_state AS ENUM (
  'draft', 'pending_vendor', 'awaiting_payment', 'confirmed', 'in_progress', 'return_pending',
  'completed', 'cancelled', 'expired', 'disputed');

ALTER TABLE bookings ADD COLUMN state booking_state;
COMMENT ON COLUMN bookings.state IS 'Lifecycle state, set by the database from status, fulfilment and disputed charges; see booking_state_moves';

-- Allowed moves. NULL from_state = how a booking may start.
CREATE TABLE booking_state_moves (
  from_state booking_state,
  to_state booking_state NOT NULL,
  UNIQUE NULLS NOT DISTINCT (from_state, to_state)
);
COMMENT ON TABLE booking_state_moves IS 'The booking state machine: every allowed move (from_state NULL = a new booking)';
INSERT INTO booking_state_moves (from_state, to_state) VALUES
  (NULL, 'draft'), (NULL, 'pending_vendor'), (NULL, 'awaiting_payment'),
  ('draft', 'pending_vendor'), ('draft', 'awaiting_payment'), ('draft', 'cancelled'), ('draft', 'expired'),
  ('pending_vendor', 'awaiting_payment'), ('pending_vendor', 'cancelled'), ('pending_vendor', 'expired'),
  ('awaiting_payment', 'confirmed'), ('awaiting_payment', 'cancelled'), ('awaiting_payment', 'expired'),
  ('confirmed', 'in_progress'), ('confirmed', 'return_pending'), ('confirmed', 'completed'), ('confirmed', 'cancelled'), ('confirmed', 'disputed'),
  ('in_progress', 'return_pending'), ('in_progress', 'completed'), ('in_progress', 'cancelled'), ('in_progress', 'disputed'),
  ('return_pending', 'completed'), ('return_pending', 'disputed'), ('return_pending', 'cancelled'),
  ('disputed', 'confirmed'), ('disputed', 'in_progress'), ('disputed', 'return_pending'), ('disputed', 'completed'), ('disputed', 'cancelled'),
  ('completed', 'disputed');

CREATE TABLE booking_state_history (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  from_state booking_state,
  to_state booking_state NOT NULL,
  status booking_status NOT NULL,
  fulfilment text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('customer', 'vendor', 'admin', 'system', 'gateway')),
  actor_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE booking_state_history IS 'Every booking state change: from, to, who (customer, vendor, admin, system job or payment gateway) and why';
CREATE INDEX booking_state_history_booking_idx ON booking_state_history (booking_id, id);

-- Status + fulfilment + an open disputed charge → state.
CREATE FUNCTION booking_state_of(s booking_status, f text, disputed boolean) RETURNS booking_state
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s = 'requested' THEN 'pending_vendor'
    WHEN s = 'accepted' THEN 'awaiting_payment'
    WHEN s IN ('rejected', 'cancelled_by_customer', 'cancelled_by_vendor') THEN 'cancelled'
    WHEN s = 'expired' THEN 'expired'
    WHEN disputed THEN 'disputed'
    WHEN s = 'completed' THEN 'completed'
    WHEN f IN ('dispatched', 'delivered', 'in_progress') THEN 'in_progress'
    WHEN f IN ('return_pending', 'closed') THEN 'return_pending'
    ELSE 'confirmed'
  END::booking_state
$$;

-- Who is acting comes from the transaction (set by the API for each request); jobs count as system.
CREATE FUNCTION booking_actor_kind() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('eventseva.actor_kind', true), ''), 'system')
$$;

CREATE FUNCTION booking_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  disputed boolean;
BEGIN
  disputed := TG_OP = 'UPDATE' AND NEW.status IN ('confirmed', 'completed')
    AND EXISTS (SELECT 1 FROM booking_charges c WHERE c.booking_id = NEW.id AND c.status = 'disputed');
  NEW.state := booking_state_of(NEW.status, NEW.fulfilment, disputed);
  IF TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state THEN
    -- OLD.state is NULL only while existing rows are filled in by this migration.
    IF NOT (TG_OP = 'UPDATE' AND OLD.state IS NULL) AND NOT EXISTS (
      SELECT 1 FROM booking_state_moves m
       WHERE m.from_state IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END) AND m.to_state = NEW.state
    ) THEN
      RAISE EXCEPTION 'booking % cannot move from % to %', NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'new' ELSE OLD.state::text END, NEW.state
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_state_move';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION booking_state_log() RETURNS trigger LANGUAGE plpgsql AS $$
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

-- Fill in existing bookings before the guard is armed.
UPDATE bookings b SET state = booking_state_of(b.status, b.fulfilment,
  b.status IN ('confirmed', 'completed') AND EXISTS (SELECT 1 FROM booking_charges c WHERE c.booking_id = b.id AND c.status = 'disputed'));
ALTER TABLE bookings ALTER COLUMN state SET NOT NULL;
CREATE INDEX bookings_state_idx ON bookings (state) WHERE state IN ('disputed', 'return_pending', 'in_progress');

CREATE TRIGGER bookings_state_guard BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION booking_state_guard();
-- Not "UPDATE OF state": that only fires when the statement names the column, and the guard sets it.
CREATE TRIGGER bookings_state_log AFTER INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION booking_state_log();

-- A charge disputed or settled moves its booking into or out of "disputed".
CREATE FUNCTION booking_charge_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE bookings SET updated_at = now() WHERE id = NEW.booking_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER booking_charges_state AFTER INSERT OR UPDATE OF status ON booking_charges FOR EACH ROW EXECUTE FUNCTION booking_charge_touch();

-- migrate:down
DROP TRIGGER booking_charges_state ON booking_charges;
DROP FUNCTION booking_charge_touch();
DROP TRIGGER bookings_state_log ON bookings;
DROP TRIGGER bookings_state_guard ON bookings;
DROP FUNCTION booking_state_log();
DROP FUNCTION booking_state_guard();
DROP FUNCTION booking_actor_kind();
DROP FUNCTION booking_state_of(booking_status, text, boolean);
DROP TABLE booking_state_history;
DROP TABLE booking_state_moves;
ALTER TABLE bookings DROP COLUMN state;
DROP TYPE booking_state;
