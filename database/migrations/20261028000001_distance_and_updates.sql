-- migrate:up
-- Where the event is, so both sides know how far the vendor travels (the exact pin is shared with
-- the vendor only after the advance is paid, like the address).
ALTER TABLE events ADD COLUMN venue_lat numeric(9,6), ADD COLUMN venue_lng numeric(9,6), ADD COLUMN venue_landmark text;
ALTER TABLE events ADD CONSTRAINT events_venue_pin CHECK ((venue_lat IS NULL) = (venue_lng IS NULL));
COMMENT ON COLUMN events.venue_lat IS 'Venue pin (with venue_lng); from the address or the phone''s location';
COMMENT ON COLUMN events.venue_landmark IS 'Nearby landmark to help the vendor find the venue';

-- How far a vendor usually travels; requests from further away are allowed but flagged.
ALTER TABLE vendors ADD COLUMN service_radius_km integer CHECK (service_radius_km BETWEEN 1 AND 500);
COMMENT ON COLUMN vendors.service_radius_km IS 'Usual travel range from the vendor''s location; null = not set';

-- Event-day updates from the vendor, and the day-before reminder.
ALTER TABLE bookings
  ADD COLUMN progress text CHECK (progress IN ('on_the_way', 'reached')),
  ADD COLUMN progress_at timestamptz,
  ADD COLUMN eta_at timestamptz,
  ADD COLUMN reminder_sent_at timestamptz;
COMMENT ON COLUMN bookings.progress IS 'Event day: on_the_way (with eta_at) or reached, set by the vendor';
COMMENT ON COLUMN bookings.reminder_sent_at IS 'When the day-before reminder went to both sides';
CREATE INDEX bookings_reminder_due_idx ON bookings (day) WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

-- Booking updates appear in the chat as small system lines ("Booking confirmed", "On the way, ~25 min").
ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'booking')),
                     ADD COLUMN data jsonb;
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages ADD CONSTRAINT messages_sender_for_text CHECK (kind = 'booking' OR sender_id IS NOT NULL);
COMMENT ON COLUMN messages.kind IS 'text = typed by a person; booking = an automatic booking update (data has the details)';

-- migrate:down
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_for_text;
DELETE FROM messages WHERE sender_id IS NULL;
ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;
ALTER TABLE messages DROP COLUMN IF EXISTS data, DROP COLUMN IF EXISTS kind;
DROP INDEX IF EXISTS bookings_reminder_due_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS reminder_sent_at, DROP COLUMN IF EXISTS eta_at, DROP COLUMN IF EXISTS progress_at, DROP COLUMN IF EXISTS progress;
ALTER TABLE vendors DROP COLUMN IF EXISTS service_radius_km;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_venue_pin;
ALTER TABLE events DROP COLUMN IF EXISTS venue_landmark, DROP COLUMN IF EXISTS venue_lng, DROP COLUMN IF EXISTS venue_lat;
