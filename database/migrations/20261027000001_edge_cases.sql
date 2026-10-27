-- migrate:up
-- The chat send limit counts one person's messages in the last minute.
CREATE INDEX messages_sender_recent_idx ON messages (sender_id, created_at DESC);
-- The open-request limit counts one customer's unanswered requests.
CREATE INDEX bookings_customer_requested_idx ON bookings (customer_id) WHERE status = 'requested';

-- migrate:down
DROP INDEX IF EXISTS bookings_customer_requested_idx;
DROP INDEX IF EXISTS messages_sender_recent_idx;
