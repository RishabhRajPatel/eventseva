-- migrate:up
-- Indexes for lookups that scanned whole tables (found by checking foreign keys and hot queries).
CREATE INDEX IF NOT EXISTS otp_requests_ip_created_at_idx ON otp_requests (ip, created_at DESC) WHERE ip IS NOT NULL; -- per-IP OTP limit
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);                -- log out everywhere, block
CREATE INDEX IF NOT EXISTS services_vendor_id_idx ON services (vendor_id);            -- vendor page, partner catalogue
CREATE INDEX IF NOT EXISTS packages_vendor_id_idx ON packages (vendor_id);
CREATE INDEX IF NOT EXISTS media_vendor_id_idx ON media (vendor_id);                  -- owner gallery and photo limits
CREATE INDEX IF NOT EXISTS events_customer_id_idx ON events (customer_id, event_date); -- "My events"
CREATE INDEX IF NOT EXISTS payouts_vendor_id_idx ON payouts (vendor_id, release_after DESC); -- partner earnings
CREATE INDEX IF NOT EXISTS reviews_customer_id_idx ON reviews (customer_id);
CREATE INDEX IF NOT EXISTS shortlists_vendor_id_idx ON shortlists (vendor_id);
CREATE INDEX IF NOT EXISTS complaints_raised_by_idx ON complaints (raised_by, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_service_id_idx ON bookings (service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_package_id_idx ON bookings (package_id) WHERE package_id IS NOT NULL;

-- Vendor search ("raj dj", "civil lines") uses ILIKE '%…%'; trigram indexes make that fast at any size.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS vendors_business_name_trgm_idx ON vendors USING gin (business_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vendors_area_trgm_idx ON vendors USING gin (area gin_trgm_ops);

-- migrate:down
DROP INDEX IF EXISTS vendors_area_trgm_idx;
DROP INDEX IF EXISTS vendors_business_name_trgm_idx;
DROP INDEX IF EXISTS bookings_package_id_idx;
DROP INDEX IF EXISTS bookings_service_id_idx;
DROP INDEX IF EXISTS complaints_raised_by_idx;
DROP INDEX IF EXISTS shortlists_vendor_id_idx;
DROP INDEX IF EXISTS reviews_customer_id_idx;
DROP INDEX IF EXISTS payouts_vendor_id_idx;
DROP INDEX IF EXISTS events_customer_id_idx;
DROP INDEX IF EXISTS media_vendor_id_idx;
DROP INDEX IF EXISTS packages_vendor_id_idx;
DROP INDEX IF EXISTS services_vendor_id_idx;
DROP INDEX IF EXISTS sessions_user_id_idx;
DROP INDEX IF EXISTS otp_requests_ip_created_at_idx;
