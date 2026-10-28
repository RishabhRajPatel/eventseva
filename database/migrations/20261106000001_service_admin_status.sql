-- migrate:up
-- An admin can take a service off the app (unsafe, misleading or broken settings) with a reason the
-- vendor sees. Only additions.
ALTER TABLE services
  ADD COLUMN admin_disabled_at timestamptz,
  ADD COLUMN admin_disabled_reason text CHECK (admin_disabled_reason IS NULL OR length(admin_disabled_reason) BETWEEN 3 AND 500);
COMMENT ON COLUMN services.admin_disabled_at IS 'Set when an admin took the service off the app; the vendor cannot switch it back on';

-- migrate:down
ALTER TABLE services DROP COLUMN admin_disabled_reason, DROP COLUMN admin_disabled_at;
