-- migrate:up
-- What each table is for. These comments are the source of database/tables.md and appear in any
-- database tool (psql \d+, DBeaver, pgAdmin).

-- Accounts and login
COMMENT ON TABLE users IS 'Everyone who logs in with a phone number: customers and vendors (a vendor is a user with a row in vendors). Deleted accounts keep the row with the phone replaced, for old bookings.';
COMMENT ON TABLE otp_requests IS 'One row per OTP sent. Only an HMAC of the code is stored; attempts and created_at drive the 5-wrong-tries lock and the resend limits.';
COMMENT ON TABLE sessions IS 'One row per logged-in device. Holds only a hash of the refresh token; revoked_at ends the session at once (logout, block, token reuse).';
COMMENT ON TABLE device_tokens IS 'Firebase push tokens, per phone and app (customer or partner).';
COMMENT ON TABLE admin_users IS 'EventSeva team logins for the admin panel: email, scrypt password hash, 2FA secret, role, and lockout state.';

-- Catalogue
COMMENT ON TABLE cities IS 'Cities EventSeva works in (English and Hindi names). New cities start hidden.';
COMMENT ON TABLE categories IS 'Service types (DJ & Sound, Cook & Catering …), managed by super admins. Hidden instead of deleted.';

-- Vendors
COMMENT ON TABLE vendors IS 'A business profile owned by one user. status: draft → pending → approved / rejected / on_hold. featured_until puts it first in search.';
COMMENT ON TABLE vendor_documents IS 'Private ID documents (Aadhaar, PAN, GST, shop photo) for verification; only the last 4 Aadhaar digits are stored.';
COMMENT ON TABLE vendor_bank_accounts IS 'Where payouts go. The account number is AES-256-GCM encrypted (BANK_DETAILS_KEY); only the last 4 digits are readable.';
COMMENT ON TABLE services IS 'What a vendor sells, priced per unit (per event, per plate, per day …). Soft-deleted with is_active.';
COMMENT ON TABLE packages IS 'Fixed-price bundles a vendor offers ("Gold: DJ + lights + 5 hours").';
COMMENT ON TABLE media IS 'Vendor photos and videos on Cloudinary. Customers see them only after admin approval.';
COMMENT ON TABLE availability IS 'Busy slots on a vendor''s calendar: booked (held by an accepted booking) or blocked by the vendor. Free days have no row.';

-- Events and bookings
COMMENT ON TABLE events IS 'A customer''s occasion (wedding, birthday …) that bookings belong to.';
COMMENT ON TABLE bookings IS 'One vendor booked for one event and slot. requested → accepted → confirmed (advance paid) → completed; money in paise, priced by the server.';
COMMENT ON TABLE reviews IS 'One rating and comment per completed booking, with an optional vendor reply. Hidden reviews do not count in the rating.';
COMMENT ON TABLE shortlists IS 'Vendors a customer saved (the heart button).';

-- Money
COMMENT ON TABLE payments IS 'Razorpay orders and payments for booking advances, and refunds (type = refund).';
COMMENT ON TABLE payouts IS 'What EventSeva owes a vendor for a completed booking (advance − commission − deductions), and when it was paid.';
COMMENT ON TABLE coupons IS 'Discount codes. EventSeva pays the discount; it lowers the advance paid online, never the vendor''s payout.';
COMMENT ON TABLE coupon_redemptions IS 'A coupon on a booking: applied (held until payment), used (paid) or released (given back).';
COMMENT ON TABLE featured_plans IS 'Paid featured-listing plans (days and price) that vendors can buy.';
COMMENT ON TABLE featured_purchases IS 'Each featured purchase or free grant, with its Razorpay payment and the period it covers.';

-- Messages and support
COMMENT ON TABLE conversations IS 'One chat thread per customer and vendor.';
COMMENT ON TABLE messages IS 'Chat messages. Phone numbers are masked in the API until a booking between the two is confirmed.';
COMMENT ON TABLE notifications IS 'In-app notifications in the user''s language. pushed_at is set when the push to the phone has gone out.';
COMMENT ON TABLE complaints IS 'Help & support requests from customers or vendors, optionally about a booking.';
COMMENT ON TABLE admin_audit_log IS 'Every admin action (approve, refund, block, export …) with who, when, and the before/after values.';

-- migrate:down
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations' LOOP
    EXECUTE format('COMMENT ON TABLE %I IS NULL', t);
  END LOOP;
END $$;
