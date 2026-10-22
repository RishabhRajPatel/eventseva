-- migrate:up
-- Lock an admin for 15 minutes after 5 wrong logins, and let logout end tokens already issued.
ALTER TABLE admin_users
  ADD COLUMN failed_logins int NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN tokens_valid_after timestamptz;

-- migrate:down
ALTER TABLE admin_users DROP COLUMN failed_logins, DROP COLUMN locked_until, DROP COLUMN tokens_valid_after;
