-- migrate:up
-- EventSeva-curated packages that span several vendors ("full wedding": tent + DJ + catering).
--
-- These are the same thing as a vendor's own bundle — a set of services booked together, some of
-- them required, with a discount — so they reuse service_bundles rather than a parallel table, and
-- with it the whole checkout path: one transaction, all bookings or none, BUNDLE_INCOMPLETE when a
-- required service is left out. A NULL vendor_id is what makes a row ours instead of a vendor's.
ALTER TABLE service_bundles ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE service_bundles
  -- Customers see these, and the apps are bilingual; vendor bundles stay English-only as today.
  ADD COLUMN name_hi        text CHECK (name_hi IS NULL OR length(name_hi) BETWEEN 2 AND 80),
  ADD COLUMN description_hi text CHECK (description_hi IS NULL OR length(description_hi) <= 500),
  -- Which occasion it is sold for, so the app can show wedding packages on a wedding event.
  ADD COLUMN event_type     text,
  ADD COLUMN sort_order     integer NOT NULL DEFAULT 0,
  -- The admin who created it. No foreign key on purpose: the package outlives the admin account.
  ADD COLUMN created_by     uuid,
  -- Ours needs Hindi and an occasion; a vendor's needs neither.
  ADD CONSTRAINT admin_package_is_bilingual
    CHECK (vendor_id IS NOT NULL OR (name_hi IS NOT NULL AND event_type IS NOT NULL));

COMMENT ON COLUMN service_bundles.vendor_id IS 'The vendor who owns this bundle; NULL for an EventSeva package, which may span vendors';
COMMENT ON COLUMN service_bundles.event_type IS 'Occasion an EventSeva package is sold for (wedding, birthday …); NULL for vendor bundles';
COMMENT ON COLUMN service_bundles.created_by IS 'Admin who created an EventSeva package; vendor bundles leave it NULL';

-- Customers browsing packages for an occasion.
CREATE INDEX service_bundles_admin_idx ON service_bundles (event_type, sort_order) WHERE vendor_id IS NULL AND is_active;

-- migrate:down
DROP INDEX service_bundles_admin_idx;
ALTER TABLE service_bundles
  DROP CONSTRAINT admin_package_is_bilingual,
  DROP COLUMN created_by, DROP COLUMN sort_order, DROP COLUMN event_type,
  DROP COLUMN description_hi, DROP COLUMN name_hi;
DELETE FROM service_bundles WHERE vendor_id IS NULL;
ALTER TABLE service_bundles ALTER COLUMN vendor_id SET NOT NULL;
