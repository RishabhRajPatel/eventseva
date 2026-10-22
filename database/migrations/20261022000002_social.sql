-- migrate:up
CREATE INDEX ON reviews (vendor_id, created_at DESC) WHERE NOT is_hidden;
CREATE INDEX ON conversations (vendor_id, last_message_at DESC);
CREATE INDEX ON conversations (customer_id, last_message_at DESC);
CREATE INDEX ON complaints (status, created_at);
CREATE INDEX ON payouts (status, release_after);
CREATE INDEX ON media (vendor_id, sort_order) WHERE status = 'approved';
CREATE INDEX ON media (status, created_at) WHERE status = 'pending';
ALTER TABLE complaints ADD CHECK (status IN ('open', 'in_progress', 'resolved'));
ALTER TABLE messages ADD CHECK (length(body) BETWEEN 1 AND 2000);

-- migrate:down
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
DROP INDEX IF EXISTS media_status_created_at_idx;
DROP INDEX IF EXISTS media_vendor_id_sort_order_idx;
DROP INDEX IF EXISTS payouts_status_release_after_idx;
DROP INDEX IF EXISTS complaints_status_created_at_idx;
DROP INDEX IF EXISTS conversations_customer_id_last_message_at_idx;
DROP INDEX IF EXISTS conversations_vendor_id_last_message_at_idx;
DROP INDEX IF EXISTS reviews_vendor_id_created_at_idx;
