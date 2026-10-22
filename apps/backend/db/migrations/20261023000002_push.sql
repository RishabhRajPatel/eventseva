-- migrate:up
-- Which app a notification is for (a vendor can have both apps on one phone), and whether its
-- push has gone out. The dispatcher picks up rows where pushed_at is null.
ALTER TABLE notifications
  ADD COLUMN app text CHECK (app IN ('customer', 'partner')),
  ADD COLUMN pushed_at timestamptz;
UPDATE notifications SET pushed_at = created_at;
CREATE INDEX notifications_unpushed_idx ON notifications (id) WHERE pushed_at IS NULL;

ALTER TABLE device_tokens ADD COLUMN app text NOT NULL DEFAULT 'customer' CHECK (app IN ('customer', 'partner'));
CREATE INDEX ON device_tokens (user_id, app);

-- migrate:down
DROP INDEX IF EXISTS device_tokens_user_id_app_idx;
ALTER TABLE device_tokens DROP COLUMN app;
DROP INDEX IF EXISTS notifications_unpushed_idx;
ALTER TABLE notifications DROP COLUMN app, DROP COLUMN pushed_at;
