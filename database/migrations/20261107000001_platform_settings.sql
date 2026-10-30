-- migrate:up
-- Commission, advance, cash-dues limit, the default cancellation policy and the invoice identity
-- used to live only in .env: changing one needed a restart and left no record of who changed it.
-- They move into one row here, seeded from the current environment so nothing changes on deploy.
-- .env stays the bootstrap: the seed below reads it through the migration runner's defaults.
CREATE TABLE platform_settings (
  id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  advance_percent      integer NOT NULL CHECK (advance_percent > 0 AND advance_percent <= 100),
  commission_percent   integer NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  cash_dues_limit_paise integer NOT NULL CHECK (cash_dues_limit_paise >= 0),
  cancellation         jsonb NOT NULL,
  platform_name        text NOT NULL CHECK (length(platform_name) BETWEEN 2 AND 120),
  platform_address     text CHECK (platform_address IS NULL OR length(platform_address) <= 300),
  platform_gstin       text CHECK (platform_gstin IS NULL OR platform_gstin ~ '^[0-9A-Z]{15}$'),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Deliberately not a foreign key: this row must outlive the admin who last touched it. With a
  -- reference, removing an admin (or a TRUNCATE ... CASCADE) would take the platform's money
  -- settings with it. Who changed what is kept in admin_audit_log, which does reference the admin.
  updated_by           uuid,
  -- The commission comes out of the advance, so it can never be the larger of the two.
  CONSTRAINT commission_within_advance CHECK (commission_percent <= advance_percent)
);

COMMENT ON TABLE platform_settings IS 'One row (id = 1): the money and invoice settings super admins can change without a deploy';
COMMENT ON COLUMN platform_settings.cancellation IS 'Default cancellation policy for categories that do not set their own; bookings keep their own snapshot';
COMMENT ON COLUMN platform_settings.updated_by IS 'The admin who last saved; every change is also in admin_audit_log';

-- Defaults match apps/backend/.env.example, so an existing deployment behaves exactly as before.
INSERT INTO platform_settings (id, advance_percent, commission_percent, cash_dues_limit_paise, cancellation, platform_name)
VALUES (1, 25, 10, 500000,
        '{"customer": [{"minDays": 15, "percent": 90}, {"minDays": 7, "percent": 50}, {"minDays": 0, "percent": 0}], "vendorPercent": 100}'::jsonb,
        'EventSeva')
ON CONFLICT (id) DO NOTHING;

-- migrate:down
DROP TABLE platform_settings;
