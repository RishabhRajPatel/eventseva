-- GENERATED FILE: do not edit. Run `pnpm --filter @eventseva/backend db:docs` after adding a migration.
-- The whole EventSeva schema after every migration in database/migrations.

--
-- PostgreSQL database dump
--

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

--
-- Name: admin_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_role AS ENUM (
    'super',
    'support',
    'verifier',
    'finance'
);

--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.booking_status AS ENUM (
    'requested',
    'accepted',
    'rejected',
    'expired',
    'confirmed',
    'completed',
    'cancelled_by_customer',
    'cancelled_by_vendor'
);

--
-- Name: media_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_type AS ENUM (
    'photo',
    'video'
);

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'created',
    'paid',
    'failed',
    'refunded'
);

--
-- Name: payment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_type AS ENUM (
    'advance',
    'final',
    'refund'
);

--
-- Name: payout_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payout_status AS ENUM (
    'scheduled',
    'processing',
    'paid',
    'failed',
    'held'
);

--
-- Name: pricing_unit; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pricing_unit AS ENUM (
    'per_event',
    'per_day',
    'per_shift',
    'per_plate',
    'per_hour',
    'per_km',
    'per_room_night',
    'per_person',
    'package'
);

--
-- Name: review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.review_status AS ENUM (
    'uploading',
    'pending',
    'approved',
    'rejected'
);

--
-- Name: slot_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.slot_status AS ENUM (
    'free',
    'booked',
    'blocked'
);

--
-- Name: vendor_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vendor_status AS ENUM (
    'draft',
    'pending',
    'approved',
    'rejected',
    'on_hold'
);

--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id bigint NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE admin_audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.admin_audit_log IS 'Every admin action (approve, refund, block, export …) with who, when, and the before/after values.';

--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_audit_log_id_seq OWNED BY public.admin_audit_log.id;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    totp_secret text NOT NULL,
    role public.admin_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    failed_logins integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    tokens_valid_after timestamp with time zone
);

--
-- Name: TABLE admin_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.admin_users IS 'EventSeva team logins for the admin panel: email, scrypt password hash, 2FA secret, role, and lockout state.';

--
-- Name: availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability (
    vendor_id uuid NOT NULL,
    day date NOT NULL,
    slot text DEFAULT 'full'::text NOT NULL,
    status public.slot_status DEFAULT 'free'::public.slot_status NOT NULL,
    booking_id uuid,
    CONSTRAINT availability_slot_check CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text])))
);

--
-- Name: TABLE availability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.availability IS 'Busy slots on a vendor''s calendar: booked (held by an accepted booking) or blocked by the vendor. Free days have no row.';

--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    service_id uuid,
    package_id uuid,
    day date NOT NULL,
    slot text DEFAULT 'full'::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    amount_paise integer NOT NULL,
    advance_paise integer NOT NULL,
    commission_paise integer NOT NULL,
    status public.booking_status DEFAULT 'requested'::public.booking_status NOT NULL,
    respond_by timestamp with time zone NOT NULL,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    pay_by timestamp with time zone,
    refund_paise integer DEFAULT 0 NOT NULL,
    discount_paise integer DEFAULT 0 NOT NULL,
    payout_deduction_paise integer DEFAULT 0 NOT NULL,
    CONSTRAINT bookings_check CHECK (((service_id IS NOT NULL) OR (package_id IS NOT NULL))),
    CONSTRAINT bookings_discount_paise_check CHECK ((discount_paise >= 0)),
    CONSTRAINT bookings_payout_deduction_paise_check CHECK ((payout_deduction_paise >= 0)),
    CONSTRAINT bookings_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT bookings_slot_check CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text])))
);

--
-- Name: TABLE bookings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bookings IS 'One vendor booked for one event and slot. requested → accepted → confirmed (advance paid) → completed; money in paise, priced by the server.';

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id integer NOT NULL,
    slug text NOT NULL,
    name_en text NOT NULL,
    name_hi text NOT NULL,
    icon text NOT NULL,
    default_unit public.pricing_unit NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

--
-- Name: TABLE categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.categories IS 'Service types (DJ & Sound, Cook & Catering …), managed by super admins. Hidden instead of deleted.';

--
-- Name: categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categories_id_seq OWNED BY public.categories.id;

--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id integer NOT NULL,
    name text NOT NULL,
    state text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    name_hi text NOT NULL
);

--
-- Name: TABLE cities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cities IS 'Cities EventSeva works in (English and Hindi names). New cities start hidden.';

--
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cities_id_seq OWNED BY public.cities.id;

--
-- Name: complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    raised_by uuid NOT NULL,
    subject text NOT NULL,
    details text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT complaints_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text])))
);

--
-- Name: TABLE complaints; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.complaints IS 'Help & support requests from customers or vendors, optionally about a booking.';

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    last_message_at timestamp with time zone
);

--
-- Name: TABLE conversations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.conversations IS 'One chat thread per customer and vendor.';

--
-- Name: coupon_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_redemptions (
    id bigint NOT NULL,
    coupon_id integer NOT NULL,
    booking_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    discount_paise integer NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT coupon_redemptions_discount_paise_check CHECK ((discount_paise > 0)),
    CONSTRAINT coupon_redemptions_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'used'::text, 'released'::text])))
);

--
-- Name: TABLE coupon_redemptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.coupon_redemptions IS 'A coupon on a booking: applied (held until payment), used (paid) or released (given back).';

--
-- Name: coupon_redemptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupon_redemptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: coupon_redemptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupon_redemptions_id_seq OWNED BY public.coupon_redemptions.id;

--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id integer NOT NULL,
    code text NOT NULL,
    title_en text NOT NULL,
    title_hi text NOT NULL,
    discount_type text NOT NULL,
    discount_value integer NOT NULL,
    max_discount_paise integer,
    min_amount_paise integer DEFAULT 0 NOT NULL,
    category_id integer,
    first_booking_only boolean DEFAULT false NOT NULL,
    is_public boolean DEFAULT true NOT NULL,
    max_uses integer,
    per_customer_limit integer DEFAULT 1 NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupons_check CHECK (((discount_type <> 'percent'::text) OR (discount_value <= 100))),
    CONSTRAINT coupons_check1 CHECK (((valid_until IS NULL) OR (valid_until > valid_from))),
    CONSTRAINT coupons_code_check CHECK ((code ~ '^[A-Z0-9]{3,20}$'::text)),
    CONSTRAINT coupons_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'flat'::text]))),
    CONSTRAINT coupons_discount_value_check CHECK ((discount_value > 0)),
    CONSTRAINT coupons_max_discount_paise_check CHECK ((max_discount_paise > 0)),
    CONSTRAINT coupons_max_uses_check CHECK ((max_uses > 0)),
    CONSTRAINT coupons_min_amount_paise_check CHECK ((min_amount_paise >= 0)),
    CONSTRAINT coupons_per_customer_limit_check CHECK ((per_customer_limit > 0))
);

--
-- Name: TABLE coupons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.coupons IS 'Discount codes. EventSeva pays the discount; it lowers the advance paid online, never the vendor''s payout.';

--
-- Name: coupons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coupons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: coupons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coupons_id_seq OWNED BY public.coupons.id;

--
-- Name: device_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    fcm_token text NOT NULL,
    platform text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    app text DEFAULT 'customer'::text NOT NULL,
    CONSTRAINT device_tokens_app_check CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))
);

--
-- Name: TABLE device_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.device_tokens IS 'Firebase push tokens, per phone and app (customer or partner).';

--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    title text NOT NULL,
    event_type text NOT NULL,
    event_date date NOT NULL,
    city_id integer NOT NULL,
    venue_address text,
    guest_count integer,
    budget_paise integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.events IS 'A customer''s occasion (wedding, birthday …) that bookings belong to.';

--
-- Name: featured_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.featured_plans (
    id integer NOT NULL,
    name_en text NOT NULL,
    name_hi text NOT NULL,
    days integer NOT NULL,
    price_paise integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT featured_plans_days_check CHECK (((days >= 1) AND (days <= 365))),
    CONSTRAINT featured_plans_price_paise_check CHECK ((price_paise >= 100))
);

--
-- Name: TABLE featured_plans; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.featured_plans IS 'Paid featured-listing plans (days and price) that vendors can buy.';

--
-- Name: featured_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.featured_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: featured_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.featured_plans_id_seq OWNED BY public.featured_plans.id;

--
-- Name: featured_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.featured_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    plan_id integer,
    days integer NOT NULL,
    amount_paise integer DEFAULT 0 NOT NULL,
    razorpay_order_id text,
    razorpay_payment_id text,
    status text DEFAULT 'created'::text NOT NULL,
    granted_by uuid,
    reason text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    CONSTRAINT featured_purchases_amount_paise_check CHECK ((amount_paise >= 0)),
    CONSTRAINT featured_purchases_days_check CHECK ((days > 0)),
    CONSTRAINT featured_purchases_status_check CHECK ((status = ANY (ARRAY['created'::text, 'paid'::text, 'granted'::text])))
);

--
-- Name: TABLE featured_purchases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.featured_purchases IS 'Each featured purchase or free grant, with its Razorpay payment and the period it covers.';

--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    type public.media_type NOT NULL,
    public_id text NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    bytes integer NOT NULL,
    duration_sec integer,
    blurhash text,
    file_hash text NOT NULL,
    is_cover boolean DEFAULT false NOT NULL,
    cover_crop jsonb,
    sort_order integer DEFAULT 0 NOT NULL,
    status public.review_status DEFAULT 'uploading'::public.review_status NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media IS 'Vendor photos and videos on Cloudinary. Customers see them only after admin approval.';

--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_body_check CHECK (((length(body) >= 1) AND (length(body) <= 2000)))
);

--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.messages IS 'Chat messages. Phone numbers are masked in the API until a booking between the two is confirmed.';

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    app text,
    pushed_at timestamp with time zone,
    CONSTRAINT notifications_app_check CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))
);

--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS 'In-app notifications in the user''s language. pushed_at is set when the push to the phone has gone out.';

--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;

--
-- Name: otp_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    ip inet,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sms_sent boolean DEFAULT true NOT NULL
);

--
-- Name: TABLE otp_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.otp_requests IS 'One row per OTP sent. Only an HMAC of the code is stored; attempts and created_at drive the 5-wrong-tries lock and the resend limits.';

--
-- Name: COLUMN otp_requests.sms_sent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.otp_requests.sms_sent IS 'false when no SMS went out (Play Store reviewer number)';

--
-- Name: packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    title text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    price_paise integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT packages_price_paise_check CHECK ((price_paise > 0))
);

--
-- Name: TABLE packages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.packages IS 'Fixed-price bundles a vendor offers ("Gold: DJ + lights + 5 hours").';

--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    type public.payment_type NOT NULL,
    amount_paise integer NOT NULL,
    razorpay_order_id text,
    razorpay_payment_id text,
    status public.payment_status DEFAULT 'created'::public.payment_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    razorpay_refund_id text,
    CONSTRAINT payments_check CHECK (((type = 'refund'::public.payment_type) = (razorpay_refund_id IS NOT NULL))),
    CONSTRAINT payments_check1 CHECK (((type = 'refund'::public.payment_type) OR (razorpay_order_id IS NOT NULL)))
);

--
-- Name: TABLE payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payments IS 'Razorpay orders and payments for booking advances, and refunds (type = refund).';

--
-- Name: payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    amount_paise integer NOT NULL,
    release_after timestamp with time zone NOT NULL,
    razorpay_transfer_id text,
    status public.payout_status DEFAULT 'scheduled'::public.payout_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE payouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payouts IS 'What EventSeva owes a vendor for a completed booking (advance − commission − deductions), and when it was paid.';

--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    rating smallint NOT NULL,
    comment text,
    vendor_reply text,
    is_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

--
-- Name: TABLE reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reviews IS 'One rating and comment per completed booking, with an optional vendor reply. Hidden reviews do not count in the rating.';

--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    price_paise integer NOT NULL,
    unit public.pricing_unit NOT NULL,
    min_guests integer,
    max_guests integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT services_price_paise_check CHECK ((price_paise > 0))
);

--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'What a vendor sells, priced per unit (per event, per plate, per day …). Soft-deleted with is_active.';

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    refresh_token_hash text NOT NULL,
    app text NOT NULL,
    device_name text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sessions_app_check CHECK ((app = ANY (ARRAY['customer'::text, 'partner'::text])))
);

--
-- Name: TABLE sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sessions IS 'One row per logged-in device. Holds only a hash of the refresh token; revoked_at ends the session at once (logout, block, token reuse).';

--
-- Name: shortlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shortlists (
    customer_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE shortlists; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shortlists IS 'Vendors a customer saved (the heart button).';

--
-- Name: system_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_alerts (
    id bigint NOT NULL,
    kind text NOT NULL,
    message text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid
);

--
-- Name: TABLE system_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_alerts IS 'Problems the system raises for the team (e.g. the daily SMS budget running out), shown on the admin dashboard until someone marks them resolved.';

--
-- Name: system_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: system_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_alerts_id_seq OWNED BY public.system_alerts.id;

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    name text,
    city_id integer,
    language text DEFAULT 'en'::text NOT NULL,
    is_blocked boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_language_check CHECK ((language = ANY (ARRAY['en'::text, 'hi'::text])))
);

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS 'Everyone who logs in with a phone number: customers and vendors (a vendor is a user with a row in vendors). Deleted accounts keep the row with the phone replaced, for old bookings.';

--
-- Name: vendor_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_bank_accounts (
    vendor_id uuid NOT NULL,
    holder_name text NOT NULL,
    account_enc text NOT NULL,
    account_last4 text NOT NULL,
    ifsc text NOT NULL,
    upi_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    verified_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendor_bank_accounts_account_last4_check CHECK ((account_last4 ~ '^\d{4}$'::text)),
    CONSTRAINT vendor_bank_accounts_ifsc_check CHECK ((ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'::text)),
    CONSTRAINT vendor_bank_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])))
);

--
-- Name: TABLE vendor_bank_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vendor_bank_accounts IS 'Where payouts go. The account number is AES-256-GCM encrypted (BANK_DETAILS_KEY); only the last 4 digits are readable.';

--
-- Name: vendor_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    doc_type text NOT NULL,
    storage_key text NOT NULL,
    last4 text,
    status public.review_status DEFAULT 'pending'::public.review_status NOT NULL,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    format text DEFAULT 'jpg'::text NOT NULL,
    reject_reason text,
    CONSTRAINT vendor_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['aadhaar'::text, 'pan'::text, 'gst'::text, 'shop_photo'::text]))),
    CONSTRAINT vendor_documents_last4_check CHECK (((last4 IS NULL) OR (last4 ~ '^\d{4}$'::text)))
);

--
-- Name: TABLE vendor_documents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vendor_documents IS 'Private ID documents (Aadhaar, PAN, GST, shop photo) for verification; only the last 4 Aadhaar digits are stored.';

--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    business_name text NOT NULL,
    category_id integer NOT NULL,
    city_id integer NOT NULL,
    area text,
    address text,
    lat numeric(9,6),
    lng numeric(9,6),
    about text,
    status public.vendor_status DEFAULT 'draft'::public.vendor_status NOT NULL,
    reject_reason text,
    razorpay_account_id text,
    rating_avg numeric(2,1) DEFAULT 0 NOT NULL,
    rating_count integer DEFAULT 0 NOT NULL,
    featured_until timestamp with time zone,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE vendors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vendors IS 'A business profile owned by one user. status: draft → pending → approved / rejected / on_hold. featured_until puts it first in search.';

--
-- Name: admin_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_log_id_seq'::regclass);

--
-- Name: categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories ALTER COLUMN id SET DEFAULT nextval('public.categories_id_seq'::regclass);

--
-- Name: cities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities ALTER COLUMN id SET DEFAULT nextval('public.cities_id_seq'::regclass);

--
-- Name: coupon_redemptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions ALTER COLUMN id SET DEFAULT nextval('public.coupon_redemptions_id_seq'::regclass);

--
-- Name: coupons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons ALTER COLUMN id SET DEFAULT nextval('public.coupons_id_seq'::regclass);

--
-- Name: featured_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_plans ALTER COLUMN id SET DEFAULT nextval('public.featured_plans_id_seq'::regclass);

--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);

--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);

--
-- Name: system_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_alerts ALTER COLUMN id SET DEFAULT nextval('public.system_alerts_id_seq'::regclass);

--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);

--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);

--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);

--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (vendor_id, day, slot);

--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);

--
-- Name: cities cities_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_name_key UNIQUE (name);

--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);

--
-- Name: complaints complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_pkey PRIMARY KEY (id);

--
-- Name: conversations conversations_customer_id_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_customer_id_vendor_id_key UNIQUE (customer_id, vendor_id);

--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);

--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);

--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);

--
-- Name: device_tokens device_tokens_fcm_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_fcm_token_key UNIQUE (fcm_token);

--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);

--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);

--
-- Name: featured_plans featured_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_plans
    ADD CONSTRAINT featured_plans_pkey PRIMARY KEY (id);

--
-- Name: featured_purchases featured_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_pkey PRIMARY KEY (id);

--
-- Name: featured_purchases featured_purchases_razorpay_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_razorpay_order_id_key UNIQUE (razorpay_order_id);

--
-- Name: featured_purchases featured_purchases_razorpay_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_razorpay_payment_id_key UNIQUE (razorpay_payment_id);

--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);

--
-- Name: media media_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_public_id_key UNIQUE (public_id);

--
-- Name: media media_vendor_id_file_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_vendor_id_file_hash_key UNIQUE (vendor_id, file_hash);

--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: otp_requests otp_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_requests
    ADD CONSTRAINT otp_requests_pkey PRIMARY KEY (id);

--
-- Name: packages packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);

--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);

--
-- Name: payments payments_razorpay_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_razorpay_order_id_key UNIQUE (razorpay_order_id);

--
-- Name: payments payments_razorpay_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_razorpay_payment_id_key UNIQUE (razorpay_payment_id);

--
-- Name: payments payments_razorpay_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_razorpay_refund_id_key UNIQUE (razorpay_refund_id);

--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);

--
-- Name: payouts payouts_razorpay_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_razorpay_transfer_id_key UNIQUE (razorpay_transfer_id);

--
-- Name: reviews reviews_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_key UNIQUE (booking_id);

--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);

--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_refresh_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash);

--
-- Name: shortlists shortlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlists
    ADD CONSTRAINT shortlists_pkey PRIMARY KEY (customer_id, vendor_id);

--
-- Name: system_alerts system_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_alerts
    ADD CONSTRAINT system_alerts_pkey PRIMARY KEY (id);

--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: vendor_bank_accounts vendor_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_bank_accounts
    ADD CONSTRAINT vendor_bank_accounts_pkey PRIMARY KEY (vendor_id);

--
-- Name: vendor_documents vendor_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_documents
    ADD CONSTRAINT vendor_documents_pkey PRIMARY KEY (id);

--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);

--
-- Name: vendors vendors_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_user_id_key UNIQUE (user_id);

--
-- Name: admin_audit_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_created_at_idx ON public.admin_audit_log USING btree (created_at DESC);

--
-- Name: admin_audit_log_target_type_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_audit_log_target_type_target_id_idx ON public.admin_audit_log USING btree (target_type, target_id);

--
-- Name: bookings_customer_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_customer_id_created_at_idx ON public.bookings USING btree (customer_id, created_at DESC);

--
-- Name: bookings_one_open_per_event_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bookings_one_open_per_event_vendor ON public.bookings USING btree (event_id, vendor_id) WHERE (status = ANY (ARRAY['requested'::public.booking_status, 'accepted'::public.booking_status, 'confirmed'::public.booking_status]));

--
-- Name: bookings_status_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_status_day_idx ON public.bookings USING btree (status, day) WHERE (status = 'confirmed'::public.booking_status);

--
-- Name: bookings_status_pay_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_status_pay_by_idx ON public.bookings USING btree (status, pay_by) WHERE (status = 'accepted'::public.booking_status);

--
-- Name: bookings_status_respond_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_status_respond_by_idx ON public.bookings USING btree (status, respond_by) WHERE (status = 'requested'::public.booking_status);

--
-- Name: bookings_vendor_id_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_vendor_id_day_idx ON public.bookings USING btree (vendor_id, day);

--
-- Name: complaints_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_status_created_at_idx ON public.complaints USING btree (status, created_at);

--
-- Name: conversations_customer_id_last_message_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_customer_id_last_message_at_idx ON public.conversations USING btree (customer_id, last_message_at DESC);

--
-- Name: conversations_vendor_id_last_message_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_vendor_id_last_message_at_idx ON public.conversations USING btree (vendor_id, last_message_at DESC);

--
-- Name: coupon_redemptions_coupon_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupon_redemptions_coupon_id_status_idx ON public.coupon_redemptions USING btree (coupon_id, status);

--
-- Name: coupon_redemptions_customer_id_coupon_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX coupon_redemptions_customer_id_coupon_id_idx ON public.coupon_redemptions USING btree (customer_id, coupon_id);

--
-- Name: coupon_redemptions_one_live_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX coupon_redemptions_one_live_per_booking ON public.coupon_redemptions USING btree (booking_id) WHERE (status <> 'released'::text);

--
-- Name: device_tokens_user_id_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_tokens_user_id_app_idx ON public.device_tokens USING btree (user_id, app);

--
-- Name: featured_purchases_status_paid_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX featured_purchases_status_paid_at_idx ON public.featured_purchases USING btree (status, paid_at);

--
-- Name: featured_purchases_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX featured_purchases_vendor_id_created_at_idx ON public.featured_purchases USING btree (vendor_id, created_at DESC);

--
-- Name: media_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_status_created_at_idx ON public.media USING btree (status, created_at) WHERE (status = 'pending'::public.review_status);

--
-- Name: media_vendor_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_vendor_id_sort_order_idx ON public.media USING btree (vendor_id, sort_order) WHERE (status = 'approved'::public.review_status);

--
-- Name: messages_conversation_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_id_id_idx ON public.messages USING btree (conversation_id, id DESC);

--
-- Name: notifications_unpushed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unpushed_idx ON public.notifications USING btree (id) WHERE (pushed_at IS NULL);

--
-- Name: notifications_user_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_id_idx ON public.notifications USING btree (user_id, id DESC);

--
-- Name: otp_requests_phone_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_requests_phone_created_at_idx ON public.otp_requests USING btree (phone, created_at DESC);

--
-- Name: otp_requests_sms_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_requests_sms_sent_idx ON public.otp_requests USING btree (created_at) WHERE sms_sent;

--
-- Name: payments_booking_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_booking_id_idx ON public.payments USING btree (booking_id);

--
-- Name: payouts_one_per_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payouts_one_per_booking ON public.payouts USING btree (booking_id);

--
-- Name: payouts_status_release_after_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_status_release_after_idx ON public.payouts USING btree (status, release_after);

--
-- Name: reviews_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_vendor_id_created_at_idx ON public.reviews USING btree (vendor_id, created_at DESC) WHERE (NOT is_hidden);

--
-- Name: system_alerts_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_alerts_open_idx ON public.system_alerts USING btree (created_at DESC) WHERE (resolved_at IS NULL);

--
-- Name: vendor_documents_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_documents_vendor_id_created_at_idx ON public.vendor_documents USING btree (vendor_id, created_at DESC);

--
-- Name: vendors_city_id_category_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_city_id_category_id_status_idx ON public.vendors USING btree (city_id, category_id, status);

--
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admin_users(id);

--
-- Name: availability availability_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: bookings bookings_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

--
-- Name: bookings bookings_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.packages(id);

--
-- Name: bookings bookings_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);

--
-- Name: bookings bookings_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: complaints complaints_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: complaints complaints_raised_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.complaints
    ADD CONSTRAINT complaints_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id);

--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: conversations conversations_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: coupon_redemptions coupon_redemptions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: coupon_redemptions coupon_redemptions_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id);

--
-- Name: coupon_redemptions coupon_redemptions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: coupons coupons_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: events events_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id);

--
-- Name: events events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: featured_purchases featured_purchases_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.admin_users(id);

--
-- Name: featured_purchases featured_purchases_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.featured_plans(id);

--
-- Name: featured_purchases featured_purchases_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.featured_purchases
    ADD CONSTRAINT featured_purchases_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: media media_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: packages packages_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.packages
    ADD CONSTRAINT packages_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: payouts payouts_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: payouts payouts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payouts
    ADD CONSTRAINT payouts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: reviews reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: reviews reviews_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: reviews reviews_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: services services_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- Name: shortlists shortlists_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlists
    ADD CONSTRAINT shortlists_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: shortlists shortlists_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shortlists
    ADD CONSTRAINT shortlists_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: system_alerts system_alerts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_alerts
    ADD CONSTRAINT system_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.admin_users(id);

--
-- Name: users users_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id);

--
-- Name: vendor_bank_accounts vendor_bank_accounts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_bank_accounts
    ADD CONSTRAINT vendor_bank_accounts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: vendor_bank_accounts vendor_bank_accounts_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_bank_accounts
    ADD CONSTRAINT vendor_bank_accounts_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.admin_users(id);

--
-- Name: vendor_documents vendor_documents_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_documents
    ADD CONSTRAINT vendor_documents_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: vendors vendors_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);

--
-- Name: vendors vendors_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id);

--
-- Name: vendors vendors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

--
-- PostgreSQL database dump complete
--
