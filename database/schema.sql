-- GENERATED FILE: do not edit. Run `pnpm --filter @eventseva/backend db:docs` after adding a migration.
-- The whole EventSeva schema after every migration in database/migrations.

--
-- PostgreSQL database dump
--

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';

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
    'refund',
    'deposit'
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
-- Name: refund_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.refund_status AS ENUM (
    'pending',
    'sending',
    'sent',
    'failed'
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
    tokens_valid_after timestamp with time zone,
    totp_last_step bigint,
    recovery_codes text[] DEFAULT '{}'::text[] NOT NULL,
    step_up_until timestamp with time zone,
    step_up_session bigint
);

--
-- Name: TABLE admin_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.admin_users IS 'EventSeva team logins for the admin panel: email, scrypt password hash, 2FA secret, role, and lockout state.';

--
-- Name: COLUMN admin_users.totp_secret; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.totp_secret IS '2FA secret, encrypted with BANK_DETAILS_KEY (v1:…); old plain rows are encrypted at the next login';

--
-- Name: COLUMN admin_users.totp_last_step; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.totp_last_step IS 'Time step of the last 2FA code accepted; older or equal steps are refused';

--
-- Name: COLUMN admin_users.recovery_codes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.recovery_codes IS 'HMAC hashes of unused one-time recovery codes; a used code is removed';

--
-- Name: COLUMN admin_users.step_up_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.step_up_until IS 'Money and personal-data actions need no new 2FA code until this time (5 minutes after one)';

--
-- Name: COLUMN admin_users.step_up_session; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.admin_users.step_up_session IS 'The login (token issue time, ms) the window belongs to: another login never inherits it';

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
-- Name: booking_addons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_addons (
    booking_id uuid NOT NULL,
    addon_id uuid NOT NULL,
    price_paise integer NOT NULL,
    request_note text,
    status text NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT booking_addons_status_check CHECK ((status = ANY (ARRAY['included'::text, 'pending_approval'::text, 'approved'::text, 'declined'::text])))
);

--
-- Name: TABLE booking_addons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_addons IS 'Extras chosen with a booking, at the price agreed; ones needing approval are approved or declined when the vendor accepts';

--
-- Name: booking_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    kind text NOT NULL,
    requested_by uuid NOT NULL,
    new_starts_at timestamp with time zone,
    new_ends_at timestamp with time zone,
    new_qty integer,
    price_diff_paise integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT booking_changes_kind_check CHECK ((kind = ANY (ARRAY['extension'::text, 'reschedule'::text, 'quantity'::text]))),
    CONSTRAINT booking_changes_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])))
);

--
-- Name: TABLE booking_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_changes IS 'Requests to extend, reschedule or change the quantity of a booking; one open at a time';

--
-- Name: booking_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    qty numeric DEFAULT 1 NOT NULL,
    amount_paise integer NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    from_deposit boolean DEFAULT false NOT NULL,
    evidence_ids text[] DEFAULT '{}'::text[] NOT NULL,
    created_by uuid NOT NULL,
    decided_by uuid,
    decision_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT booking_charges_amount_paise_check CHECK ((amount_paise > 0)),
    CONSTRAINT booking_charges_kind_check CHECK ((kind = ANY (ARRAY['extra_km'::text, 'extra_hours'::text, 'late_return'::text, 'waiting'::text, 'toll'::text, 'parking'::text, 'fuel'::text, 'damage'::text, 'missing'::text, 'cleaning'::text, 'extension'::text, 'guest_change'::text, 'other'::text]))),
    CONSTRAINT booking_charges_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'disputed'::text, 'waived'::text, 'resolved'::text])))
);

--
-- Name: TABLE booking_charges; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_charges IS 'Extra charges after the service (km, hours, late return, damage …): proposed by the vendor, accepted or disputed by the customer, decided by an admin in a dispute';

--
-- Name: booking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_events (
    id bigint NOT NULL,
    booking_id uuid NOT NULL,
    event text NOT NULL,
    actor_id uuid,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE booking_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_events IS 'Audit trail of every state change on a booking (who, when, what)';

--
-- Name: booking_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: booking_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.booking_events_id_seq OWNED BY public.booking_events.id;

--
-- Name: booking_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    phase text NOT NULL,
    readings jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    photo_ids text[] DEFAULT '{}'::text[] NOT NULL,
    recorded_by uuid NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_ack text,
    customer_note text,
    acked_at timestamp with time zone,
    CONSTRAINT booking_inspections_customer_ack_check CHECK ((customer_ack = ANY (ARRAY['agreed'::text, 'disputed'::text]))),
    CONSTRAINT booking_inspections_phase_check CHECK ((phase = ANY (ARRAY['handover'::text, 'return'::text, 'dispatch'::text, 'delivery'::text])))
);

--
-- Name: TABLE booking_inspections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_inspections IS 'Condition at handover and return (odometer, fuel, damage, counts, photos) and the customer''s agreement or dispute';

--
-- Name: booking_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    qty integer NOT NULL,
    unit_paise integer NOT NULL,
    deposit_paise integer DEFAULT 0 NOT NULL,
    dispatched_qty integer DEFAULT 0 NOT NULL,
    returned_qty integer DEFAULT 0 NOT NULL,
    damaged_qty integer DEFAULT 0 NOT NULL,
    missing_qty integer DEFAULT 0 NOT NULL,
    item_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    damage_paise integer DEFAULT 0 NOT NULL,
    missing_paise integer DEFAULT 0 NOT NULL,
    loaded_qty integer DEFAULT 0 NOT NULL,
    delivered_qty integer DEFAULT 0 NOT NULL,
    note text,
    verified_at timestamp with time zone,
    CONSTRAINT booking_lines_check CHECK ((((returned_qty + damaged_qty) + missing_qty) <= dispatched_qty)),
    CONSTRAINT booking_lines_damage_paise_check CHECK ((damage_paise >= 0)),
    CONSTRAINT booking_lines_damaged_qty_check CHECK ((damaged_qty >= 0)),
    CONSTRAINT booking_lines_delivered_qty_check CHECK ((delivered_qty >= 0)),
    CONSTRAINT booking_lines_dispatched_qty_check CHECK ((dispatched_qty >= 0)),
    CONSTRAINT booking_lines_flow_check CHECK (((loaded_qty <= qty) AND (dispatched_qty <= loaded_qty) AND (delivered_qty <= dispatched_qty))),
    CONSTRAINT booking_lines_loaded_qty_check CHECK ((loaded_qty >= 0)),
    CONSTRAINT booking_lines_missing_paise_check CHECK ((missing_paise >= 0)),
    CONSTRAINT booking_lines_missing_qty_check CHECK ((missing_qty >= 0)),
    CONSTRAINT booking_lines_note_check CHECK ((length(note) <= 500)),
    CONSTRAINT booking_lines_qty_check CHECK ((qty > 0)),
    CONSTRAINT booking_lines_returned_qty_check CHECK ((returned_qty >= 0))
);

--
-- Name: TABLE booking_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.booking_lines IS 'Items a rental booking takes from stock and their trip: loaded → dispatched → delivered → returned / damaged / missing, then verified';

--
-- Name: COLUMN booking_lines.item_snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.booking_lines.item_snapshot IS 'Item name, unit, quality, condition and charges as booked; later listing edits never change it';

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
    progress text,
    progress_at timestamp with time zone,
    eta_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    booking_type text DEFAULT 'slot'::text NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    occupy_from timestamp with time zone,
    occupy_until timestamp with time zone,
    return_due_at timestamp with time zone,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    cancellation_policy jsonb,
    tax_paise integer DEFAULT 0 NOT NULL,
    deposit_paise integer DEFAULT 0 NOT NULL,
    charges_paise integer DEFAULT 0 NOT NULL,
    fulfilment text DEFAULT 'scheduled'::text NOT NULL,
    actual_start_at timestamp with time zone,
    actual_end_at timestamp with time zone,
    idempotency_key text,
    deposit_settled_at timestamp with time zone,
    group_id uuid,
    CONSTRAINT bookings_check CHECK (((service_id IS NOT NULL) OR (package_id IS NOT NULL))),
    CONSTRAINT bookings_deposit_paise_check CHECK ((deposit_paise >= 0)),
    CONSTRAINT bookings_discount_paise_check CHECK ((discount_paise >= 0)),
    CONSTRAINT bookings_fulfilment_check CHECK ((fulfilment = ANY (ARRAY['scheduled'::text, 'preparing'::text, 'assigned'::text, 'ready'::text, 'dispatched'::text, 'delivered'::text, 'in_progress'::text, 'return_pending'::text, 'closed'::text]))),
    CONSTRAINT bookings_payout_deduction_paise_check CHECK ((payout_deduction_paise >= 0)),
    CONSTRAINT bookings_progress_check CHECK ((progress = ANY (ARRAY['on_the_way'::text, 'reached'::text]))),
    CONSTRAINT bookings_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT bookings_slot_check CHECK ((slot = ANY (ARRAY['full'::text, 'day'::text, 'night'::text]))),
    CONSTRAINT bookings_tax_paise_check CHECK ((tax_paise >= 0)),
    CONSTRAINT bookings_time_order CHECK (((ends_at IS NULL) OR (ends_at > starts_at)))
);

--
-- Name: TABLE bookings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bookings IS 'One vendor booked for one event and slot. requested → accepted → confirmed (advance paid) → completed; money in paise, priced by the server.';

--
-- Name: COLUMN bookings.progress; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.progress IS 'Event day: on_the_way (with eta_at) or reached, set by the vendor';

--
-- Name: COLUMN bookings.reminder_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.reminder_sent_at IS 'When the day-before reminder went to both sides';

--
-- Name: COLUMN bookings.starts_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.starts_at IS 'When the service starts (pickup, dispatch, appointment); ends_at when it ends or is due back';

--
-- Name: COLUMN bookings.occupy_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.occupy_from IS 'Resources are held from occupy_from to occupy_until: the service time plus setup, dismantling, cleaning and turnaround buffers';

--
-- Name: COLUMN bookings.snapshot; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.snapshot IS 'Immutable copy of what was agreed: rules, pricing, the itemised quote, answers, add-ons and attributes';

--
-- Name: COLUMN bookings.cancellation_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.cancellation_policy IS 'Refund tiers agreed at booking time; later policy changes never apply to this booking';

--
-- Name: COLUMN bookings.deposit_paise; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.deposit_paise IS 'Refundable security deposit; kept apart from booking revenue';

--
-- Name: COLUMN bookings.charges_paise; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.charges_paise IS 'Accepted extra charges (overtime, extra km, damage …) on top of amount_paise';

--
-- Name: COLUMN bookings.fulfilment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.fulfilment IS 'Progress after confirmation. Rentals: scheduled → preparing → dispatched → delivered → return_pending → closed (returned and verified). Others: scheduled → assigned → ready → in_progress → return_pending → closed';

--
-- Name: COLUMN bookings.deposit_settled_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.deposit_settled_at IS 'When agreed charges were taken from the security deposit and the rest refunded; rentals complete only after this';

--
-- Name: COLUMN bookings.group_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.group_id IS 'The checkout this booking was made in, with the others booked at the same time';

--
-- Name: capacity_holds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capacity_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_key text NOT NULL,
    vendor_id uuid NOT NULL,
    booking_id uuid,
    qty integer NOT NULL,
    period tstzrange NOT NULL,
    status text NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    until_returned boolean DEFAULT false NOT NULL,
    note text,
    CONSTRAINT capacity_holds_note_check CHECK ((length(note) <= 200)),
    CONSTRAINT capacity_holds_owner_check CHECK (((booking_id IS NOT NULL) OR (note IS NOT NULL))),
    CONSTRAINT capacity_holds_qty_check CHECK ((qty > 0)),
    CONSTRAINT capacity_holds_status_check CHECK ((status = ANY (ARRAY['hold'::text, 'active'::text, 'released'::text, 'expired'::text])))
);

--
-- Name: TABLE capacity_holds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.capacity_holds IS 'Quantities taken from a pool for a time (item:<id> stock, staff:<kind> head-count, guests:<service> per day); checked under an advisory lock';

--
-- Name: COLUMN capacity_holds.until_returned; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.capacity_holds.until_returned IS 'Stock dispatched and not yet checked back in: blocks the pool past the end of its period';

--
-- Name: COLUMN capacity_holds.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.capacity_holds.note IS 'A vendor''s own block (no booking): why the stock is unavailable';

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
    is_active boolean DEFAULT true NOT NULL,
    booking_type text DEFAULT 'slot'::text NOT NULL,
    group_key text DEFAULT 'other'::text NOT NULL,
    template jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT categories_booking_type_check CHECK ((booking_type = ANY (ARRAY['slot'::text, 'time_window'::text, 'rental'::text, 'per_person'::text, 'staffing'::text, 'appointment'::text, 'transport'::text, 'quote'::text]))),
    CONSTRAINT categories_group_key_check CHECK ((group_key = ANY (ARRAY['wedding'::text, 'entertainment'::text, 'catering'::text, 'transport'::text, 'wedding_services'::text, 'other'::text])))
);

--
-- Name: TABLE categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.categories IS 'Service types (DJ & Sound, Cook & Catering …), managed by super admins. Hidden instead of deleted.';

--
-- Name: COLUMN categories.booking_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.categories.booking_type IS 'How new services in this category are booked (slot, time_window, rental, per_person, staffing, appointment, transport, quote)';

--
-- Name: COLUMN categories.template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.categories.template IS 'Vendor attributes, customer questions and default rules for this kind of service; checked by checkTemplate()';

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
-- Name: checkouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    event_id uuid NOT NULL,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: TABLE checkouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.checkouts IS 'One customer action that booked several services (possibly several vendors) at once';

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
-- Name: customer_licences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_licences (
    user_id uuid NOT NULL,
    number_enc text NOT NULL,
    number_last4 text NOT NULL,
    date_of_birth date NOT NULL,
    expires_on date NOT NULL,
    storage_key text,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    verified_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_licences_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])))
);

--
-- Name: TABLE customer_licences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_licences IS 'Driving licence for self-drive cars: number encrypted (BANK_DETAILS_KEY), verified by an admin or by the vendor at handover';

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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    venue_lat numeric(9,6),
    venue_lng numeric(9,6),
    venue_landmark text,
    CONSTRAINT events_venue_pin CHECK (((venue_lat IS NULL) = (venue_lng IS NULL)))
);

--
-- Name: TABLE events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.events IS 'A customer''s occasion (wedding, birthday …) that bookings belong to.';

--
-- Name: COLUMN events.venue_lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.venue_lat IS 'Venue pin (with venue_lng); from the address or the phone''s location';

--
-- Name: COLUMN events.venue_landmark; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.events.venue_landmark IS 'Nearby landmark to help the vendor find the venue';

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
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    name text NOT NULL,
    unit text DEFAULT 'piece'::text NOT NULL,
    total_qty integer NOT NULL,
    repair_qty integer DEFAULT 0 NOT NULL,
    rent_paise integer DEFAULT 0 NOT NULL,
    rent_per text DEFAULT 'booking'::text NOT NULL,
    deposit_paise integer DEFAULT 0 NOT NULL,
    damage_paise integer DEFAULT 0 NOT NULL,
    min_qty integer DEFAULT 1 NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category_id uuid,
    description text,
    quality text DEFAULT 'standard'::text NOT NULL,
    quality_label text,
    condition text DEFAULT 'good'::text NOT NULL,
    missing_paise integer DEFAULT 0 NOT NULL,
    max_qty integer,
    min_days integer DEFAULT 1 NOT NULL,
    max_days integer,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_items_check CHECK ((repair_qty <= total_qty)),
    CONSTRAINT inventory_items_condition_check CHECK ((condition = ANY (ARRAY['new'::text, 'good'::text, 'used'::text, 'needs_repair'::text]))),
    CONSTRAINT inventory_items_damage_paise_check CHECK ((damage_paise >= 0)),
    CONSTRAINT inventory_items_days_check CHECK (((max_days IS NULL) OR (max_days >= min_days))),
    CONSTRAINT inventory_items_deleted_inactive CHECK (((deleted_at IS NULL) OR (NOT is_active))),
    CONSTRAINT inventory_items_deposit_paise_check CHECK ((deposit_paise >= 0)),
    CONSTRAINT inventory_items_description_check CHECK ((length(description) <= 1000)),
    CONSTRAINT inventory_items_max_days_check CHECK (((max_days IS NULL) OR ((max_days >= 1) AND (max_days <= 60)))),
    CONSTRAINT inventory_items_max_qty_check CHECK (((max_qty IS NULL) OR (max_qty >= 1))),
    CONSTRAINT inventory_items_min_days_check CHECK (((min_days >= 1) AND (min_days <= 60))),
    CONSTRAINT inventory_items_min_qty_check CHECK ((min_qty >= 1)),
    CONSTRAINT inventory_items_missing_paise_check CHECK ((missing_paise >= 0)),
    CONSTRAINT inventory_items_quality_check CHECK ((quality = ANY (ARRAY['basic'::text, 'standard'::text, 'premium'::text, 'custom'::text]))),
    CONSTRAINT inventory_items_quality_label_check CHECK ((length(quality_label) <= 30)),
    CONSTRAINT inventory_items_rent_paise_check CHECK ((rent_paise >= 0)),
    CONSTRAINT inventory_items_rent_per_check CHECK ((rent_per = ANY (ARRAY['booking'::text, 'day'::text]))),
    CONSTRAINT inventory_items_repair_qty_check CHECK ((repair_qty >= 0)),
    CONSTRAINT inventory_items_total_qty_check CHECK ((total_qty >= 0)),
    CONSTRAINT inventory_items_unit_check CHECK (((length(unit) >= 1) AND (length(unit) <= 20)))
);

--
-- Name: TABLE inventory_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_items IS 'Rental stock (plates, chairs, speakers, coolers …): how many exist, how many are in repair, price, deposit and damage charge per unit';

--
-- Name: COLUMN inventory_items.repair_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_items.repair_qty IS 'Units out of use (damaged, being repaired or cleaned); not bookable';

--
-- Name: COLUMN inventory_items.quality; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_items.quality IS 'basic / standard / premium, or custom with quality_label';

--
-- Name: COLUMN inventory_items.condition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_items.condition IS 'Listing condition; needs_repair stops new bookings';

--
-- Name: COLUMN inventory_items.missing_paise; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_items.missing_paise IS 'Charge per unit not returned (0: use damage_paise)';

--
-- Name: COLUMN inventory_items.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inventory_items.deleted_at IS 'Removed by the vendor but kept because bookings or stock records point to it';

--
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id bigint NOT NULL,
    inventory_item_id uuid NOT NULL,
    booking_id uuid,
    kind text NOT NULL,
    qty integer NOT NULL,
    note text,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_movements_kind_check CHECK ((kind = ANY (ARRAY['dispatch'::text, 'return'::text, 'damaged'::text, 'missing'::text, 'repaired'::text, 'written_off'::text, 'added'::text, 'removed'::text]))),
    CONSTRAINT inventory_movements_qty_check CHECK ((qty > 0))
);

--
-- Name: TABLE inventory_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inventory_movements IS 'Every change to rental stock: dispatch, return, damage, missing, repair, write-off';

--
-- Name: inventory_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_movements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: inventory_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_movements_id_seq OWNED BY public.inventory_movements.id;

--
-- Name: item_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid,
    key text,
    name_en text NOT NULL,
    name_hi text NOT NULL,
    examples_en text,
    examples_hi text,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_categories_check CHECK (((vendor_id IS NULL) = (key IS NOT NULL))),
    CONSTRAINT item_categories_name_en_check CHECK (((length(name_en) >= 2) AND (length(name_en) <= 40))),
    CONSTRAINT item_categories_name_hi_check CHECK (((length(name_hi) >= 1) AND (length(name_hi) <= 40)))
);

--
-- Name: TABLE item_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.item_categories IS 'Groups for rental items: the defaults (tent, furniture, cooking, dining, serving, equipment) and categories vendors add themselves';

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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resource_id uuid,
    addon_id uuid,
    inventory_item_id uuid
);

--
-- Name: TABLE media; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media IS 'Vendor photos and videos on Cloudinary. Customers see them only after admin approval.';

--
-- Name: COLUMN media.inventory_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media.inventory_item_id IS 'Photo of a rental item (not shown in the vendor gallery)';

--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid,
    body text NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'text'::text NOT NULL,
    data jsonb,
    CONSTRAINT messages_body_check CHECK (((length(body) >= 1) AND (length(body) <= 2000))),
    CONSTRAINT messages_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'booking'::text]))),
    CONSTRAINT messages_sender_for_text CHECK (((kind = 'booking'::text) OR (sender_id IS NOT NULL)))
);

--
-- Name: TABLE messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.messages IS 'Chat messages. Phone numbers are masked in the API until a booking between the two is confirmed.';

--
-- Name: COLUMN messages.kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.kind IS 'text = typed by a person; booking = an automatic booking update (data has the details)';

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
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid NOT NULL,
    razorpay_payment_id text NOT NULL,
    amount_paise integer NOT NULL,
    reason text NOT NULL,
    status public.refund_status DEFAULT 'pending'::public.refund_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    razorpay_refund_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT refunds_amount_paise_check CHECK ((amount_paise > 0))
);

--
-- Name: TABLE refunds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.refunds IS 'Refund queue: every refund is recorded here first and sent to Razorpay after the booking change commits, with safe retries.';

--
-- Name: COLUMN refunds.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refunds.reason IS 'cancellation, late_payment, replaced_order or admin';

--
-- Name: COLUMN refunds.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.refunds.status IS 'pending → sending → sent; failed after too many attempts (raises a system alert)';

--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id uuid NOT NULL,
    booking_id uuid,
    period tstzrange NOT NULL,
    status text NOT NULL,
    reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reservations_check CHECK (((status <> 'hold'::text) OR (expires_at IS NOT NULL))),
    CONSTRAINT reservations_period_check CHECK ((NOT isempty(period))),
    CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['hold'::text, 'active'::text, 'released'::text, 'expired'::text])))
);

--
-- Name: TABLE reservations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reservations IS 'Time a resource is taken: a hold (expires), active (booked or blocked by the vendor), then released';

--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    verification text DEFAULT 'not_required'::text NOT NULL,
    reject_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resources_kind_check CHECK ((kind = ANY (ARRAY['vehicle'::text, 'driver'::text, 'staff'::text, 'artist'::text, 'venue'::text, 'equipment'::text, 'crew'::text]))),
    CONSTRAINT resources_status_check CHECK ((status = ANY (ARRAY['active'::text, 'maintenance'::text, 'inactive'::text]))),
    CONSTRAINT resources_verification_check CHECK ((verification = ANY (ARRAY['not_required'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])))
);

--
-- Name: TABLE resources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.resources IS 'Vehicles, drivers, staff, artists, halls and equipment sets that one booking at a time can use; attributes validated per kind in code';

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
-- Name: service_addons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_addons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    service_id uuid,
    name text NOT NULL,
    kind text DEFAULT 'extra'::text NOT NULL,
    inclusions text[] DEFAULT '{}'::text[] NOT NULL,
    exclusions text[] DEFAULT '{}'::text[] NOT NULL,
    price_paise integer NOT NULL,
    setup_minutes integer DEFAULT 0 NOT NULL,
    requires_approval boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_addons_price_paise_check CHECK ((price_paise >= 0)),
    CONSTRAINT service_addons_setup_minutes_check CHECK ((setup_minutes >= 0))
);

--
-- Name: TABLE service_addons; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_addons IS 'Optional extras a vendor offers (car decoration packages, drone, album, makeup trial); custom ones need vendor approval';

--
-- Name: service_bundles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_bundles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    discount_percent integer DEFAULT 0 NOT NULL,
    items jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_bundles_description_check CHECK ((length(description) <= 500)),
    CONSTRAINT service_bundles_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 50))),
    CONSTRAINT service_bundles_name_check CHECK (((length(name) >= 2) AND (length(name) <= 80)))
);

--
-- Name: TABLE service_bundles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.service_bundles IS 'A vendor''s package of several services (e.g. car + decoration): mandatory items, optional discount';

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
    booking_type text DEFAULT 'slot'::text NOT NULL,
    pricing jsonb DEFAULT '{}'::jsonb NOT NULL,
    rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    resource_id uuid,
    CONSTRAINT services_price_paise_check CHECK ((price_paise > 0))
);

--
-- Name: TABLE services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.services IS 'What a vendor sells, priced per unit (per event, per plate, per day …). Soft-deleted with is_active.';

--
-- Name: COLUMN services.booking_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.booking_type IS 'Copied from the category when the service is created; old services stay slot';

--
-- Name: COLUMN services.pricing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.pricing IS 'Pricing model and rates for the engine (fixed, hourly, daily, per_unit, per_person, per_trip, quote)';

--
-- Name: COLUMN services.rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.rules IS 'Vendor overrides of the category rule defaults (durations, buffers, quantities, advance, deposit, approval)';

--
-- Name: COLUMN services.resource_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.services.resource_id IS 'For a service that is one specific resource (a car, a hall): that resource';

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
    resource_id uuid,
    CONSTRAINT vendor_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['aadhaar'::text, 'pan'::text, 'gst'::text, 'shop_photo'::text, 'vehicle_rc'::text, 'vehicle_insurance'::text, 'vehicle_permit'::text, 'vehicle_puc'::text, 'driver_licence'::text, 'police_verification'::text]))),
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    service_radius_km integer,
    CONSTRAINT vendors_service_radius_km_check CHECK (((service_radius_km >= 1) AND (service_radius_km <= 500)))
);

--
-- Name: TABLE vendors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vendors IS 'A business profile owned by one user. status: draft → pending → approved / rejected / on_hold. featured_until puts it first in search.';

--
-- Name: COLUMN vendors.service_radius_km; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendors.service_radius_km IS 'Usual travel range from the vendor''s location; null = not set';

--
-- Name: admin_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_log_id_seq'::regclass);

--
-- Name: booking_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events ALTER COLUMN id SET DEFAULT nextval('public.booking_events_id_seq'::regclass);

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
-- Name: inventory_movements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements ALTER COLUMN id SET DEFAULT nextval('public.inventory_movements_id_seq'::regclass);

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
-- Name: booking_addons booking_addons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_addons
    ADD CONSTRAINT booking_addons_pkey PRIMARY KEY (booking_id, addon_id);

--
-- Name: booking_changes booking_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_changes
    ADD CONSTRAINT booking_changes_pkey PRIMARY KEY (id);

--
-- Name: booking_charges booking_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_pkey PRIMARY KEY (id);

--
-- Name: booking_events booking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events
    ADD CONSTRAINT booking_events_pkey PRIMARY KEY (id);

--
-- Name: booking_inspections booking_inspections_booking_id_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_inspections
    ADD CONSTRAINT booking_inspections_booking_id_phase_key UNIQUE (booking_id, phase);

--
-- Name: booking_inspections booking_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_inspections
    ADD CONSTRAINT booking_inspections_pkey PRIMARY KEY (id);

--
-- Name: booking_lines booking_lines_booking_id_inventory_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_lines
    ADD CONSTRAINT booking_lines_booking_id_inventory_item_id_key UNIQUE (booking_id, inventory_item_id);

--
-- Name: booking_lines booking_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_lines
    ADD CONSTRAINT booking_lines_pkey PRIMARY KEY (id);

--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

--
-- Name: capacity_holds capacity_holds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_holds
    ADD CONSTRAINT capacity_holds_pkey PRIMARY KEY (id);

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
-- Name: checkouts checkouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_pkey PRIMARY KEY (id);

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
-- Name: customer_licences customer_licences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_licences
    ADD CONSTRAINT customer_licences_pkey PRIMARY KEY (user_id);

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
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);

--
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);

--
-- Name: item_categories item_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_pkey PRIMARY KEY (id);

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
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);

--
-- Name: refunds refunds_razorpay_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_razorpay_refund_id_key UNIQUE (razorpay_refund_id);

--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);

--
-- Name: reservations reservations_resource_id_period_excl; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_resource_id_period_excl EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE ((status = ANY (ARRAY['hold'::text, 'active'::text])));

--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);

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
-- Name: service_addons service_addons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_addons
    ADD CONSTRAINT service_addons_pkey PRIMARY KEY (id);

--
-- Name: service_bundles service_bundles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_bundles
    ADD CONSTRAINT service_bundles_pkey PRIMARY KEY (id);

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
-- Name: booking_changes_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_changes_booking_idx ON public.booking_changes USING btree (booking_id);

--
-- Name: booking_changes_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX booking_changes_one_open ON public.booking_changes USING btree (booking_id) WHERE (status = 'requested'::text);

--
-- Name: booking_charges_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_charges_booking_idx ON public.booking_charges USING btree (booking_id);

--
-- Name: booking_events_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_events_booking_idx ON public.booking_events USING btree (booking_id, id);

--
-- Name: bookings_customer_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_customer_id_created_at_idx ON public.bookings USING btree (customer_id, created_at DESC);

--
-- Name: bookings_customer_requested_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_customer_requested_idx ON public.bookings USING btree (customer_id) WHERE (status = 'requested'::public.booking_status);

--
-- Name: bookings_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_group_idx ON public.bookings USING btree (group_id) WHERE (group_id IS NOT NULL);

--
-- Name: bookings_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bookings_idempotency_key ON public.bookings USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

--
-- Name: bookings_occupy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_occupy_idx ON public.bookings USING btree (vendor_id, occupy_from, occupy_until) WHERE (status = ANY (ARRAY['requested'::public.booking_status, 'accepted'::public.booking_status, 'confirmed'::public.booking_status]));

--
-- Name: bookings_one_open_per_event_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bookings_one_open_per_event_vendor ON public.bookings USING btree (event_id, vendor_id) WHERE ((status = ANY (ARRAY['requested'::public.booking_status, 'accepted'::public.booking_status, 'confirmed'::public.booking_status])) AND (booking_type = 'slot'::text));

--
-- Name: bookings_package_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_package_id_idx ON public.bookings USING btree (package_id) WHERE (package_id IS NOT NULL);

--
-- Name: bookings_reminder_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_reminder_due_idx ON public.bookings USING btree (day) WHERE ((status = 'confirmed'::public.booking_status) AND (reminder_sent_at IS NULL));

--
-- Name: bookings_service_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_service_id_idx ON public.bookings USING btree (service_id) WHERE (service_id IS NOT NULL);

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
-- Name: capacity_holds_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capacity_holds_booking_idx ON public.capacity_holds USING btree (booking_id);

--
-- Name: capacity_holds_pool_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX capacity_holds_pool_idx ON public.capacity_holds USING gist (pool_key, period) WHERE (status = ANY (ARRAY['hold'::text, 'active'::text]));

--
-- Name: checkouts_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX checkouts_idempotency_key ON public.checkouts USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

--
-- Name: complaints_raised_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX complaints_raised_by_idx ON public.complaints USING btree (raised_by, created_at DESC);

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
-- Name: events_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_customer_id_idx ON public.events USING btree (customer_id, event_date);

--
-- Name: featured_purchases_status_paid_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX featured_purchases_status_paid_at_idx ON public.featured_purchases USING btree (status, paid_at);

--
-- Name: featured_purchases_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX featured_purchases_vendor_id_created_at_idx ON public.featured_purchases USING btree (vendor_id, created_at DESC);

--
-- Name: inventory_items_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_items_category_idx ON public.inventory_items USING btree (vendor_id, category_id) WHERE is_active;

--
-- Name: inventory_items_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_items_vendor_idx ON public.inventory_items USING btree (vendor_id);

--
-- Name: inventory_items_vendor_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inventory_items_vendor_name ON public.inventory_items USING btree (vendor_id, lower(name)) WHERE (deleted_at IS NULL);

--
-- Name: inventory_movements_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inventory_movements_item_idx ON public.inventory_movements USING btree (inventory_item_id, created_at DESC);

--
-- Name: item_categories_default_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX item_categories_default_key ON public.item_categories USING btree (key) WHERE (vendor_id IS NULL);

--
-- Name: item_categories_vendor_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX item_categories_vendor_name ON public.item_categories USING btree (vendor_id, lower(name_en)) WHERE ((vendor_id IS NOT NULL) AND is_active);

--
-- Name: media_inventory_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_inventory_item_idx ON public.media USING btree (inventory_item_id) WHERE (inventory_item_id IS NOT NULL);

--
-- Name: media_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_resource_idx ON public.media USING btree (resource_id) WHERE (resource_id IS NOT NULL);

--
-- Name: media_status_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_status_created_at_idx ON public.media USING btree (status, created_at) WHERE (status = 'pending'::public.review_status);

--
-- Name: media_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_vendor_id_idx ON public.media USING btree (vendor_id);

--
-- Name: media_vendor_id_sort_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_vendor_id_sort_order_idx ON public.media USING btree (vendor_id, sort_order) WHERE (status = 'approved'::public.review_status);

--
-- Name: messages_conversation_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_id_id_idx ON public.messages USING btree (conversation_id, id DESC);

--
-- Name: messages_sender_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_sender_recent_idx ON public.messages USING btree (sender_id, created_at DESC);

--
-- Name: notifications_unpushed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unpushed_idx ON public.notifications USING btree (id) WHERE (pushed_at IS NULL);

--
-- Name: notifications_user_id_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_id_id_idx ON public.notifications USING btree (user_id, id DESC);

--
-- Name: otp_requests_ip_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_requests_ip_created_at_idx ON public.otp_requests USING btree (ip, created_at DESC) WHERE (ip IS NOT NULL);

--
-- Name: otp_requests_phone_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_requests_phone_created_at_idx ON public.otp_requests USING btree (phone, created_at DESC);

--
-- Name: otp_requests_sms_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX otp_requests_sms_sent_idx ON public.otp_requests USING btree (created_at) WHERE sms_sent;

--
-- Name: packages_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX packages_vendor_id_idx ON public.packages USING btree (vendor_id);

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
-- Name: payouts_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payouts_vendor_id_idx ON public.payouts USING btree (vendor_id, release_after DESC);

--
-- Name: refunds_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refunds_booking_idx ON public.refunds USING btree (booking_id);

--
-- Name: refunds_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refunds_due_idx ON public.refunds USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::public.refund_status, 'sending'::public.refund_status]));

--
-- Name: reservations_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservations_booking_idx ON public.reservations USING btree (booking_id);

--
-- Name: reservations_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reservations_expiry_idx ON public.reservations USING btree (expires_at) WHERE (status = 'hold'::text);

--
-- Name: resources_vehicle_registration_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX resources_vehicle_registration_key ON public.resources USING btree (upper((attributes ->> 'registration'::text))) WHERE (kind = 'vehicle'::text);

--
-- Name: resources_vendor_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resources_vendor_kind_idx ON public.resources USING btree (vendor_id, kind);

--
-- Name: reviews_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_customer_id_idx ON public.reviews USING btree (customer_id);

--
-- Name: reviews_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reviews_vendor_id_created_at_idx ON public.reviews USING btree (vendor_id, created_at DESC) WHERE (NOT is_hidden);

--
-- Name: service_addons_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_addons_vendor_idx ON public.service_addons USING btree (vendor_id);

--
-- Name: service_bundles_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_bundles_vendor_idx ON public.service_bundles USING btree (vendor_id) WHERE is_active;

--
-- Name: services_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX services_vendor_id_idx ON public.services USING btree (vendor_id);

--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_idx ON public.sessions USING btree (user_id);

--
-- Name: shortlists_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shortlists_vendor_id_idx ON public.shortlists USING btree (vendor_id);

--
-- Name: system_alerts_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_alerts_open_idx ON public.system_alerts USING btree (created_at DESC) WHERE (resolved_at IS NULL);

--
-- Name: vendor_documents_vendor_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_documents_vendor_id_created_at_idx ON public.vendor_documents USING btree (vendor_id, created_at DESC);

--
-- Name: vendors_area_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_area_trgm_idx ON public.vendors USING gin (area public.gin_trgm_ops);

--
-- Name: vendors_business_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_business_name_trgm_idx ON public.vendors USING gin (business_name public.gin_trgm_ops);

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
-- Name: booking_addons booking_addons_addon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_addons
    ADD CONSTRAINT booking_addons_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES public.service_addons(id);

--
-- Name: booking_addons booking_addons_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_addons
    ADD CONSTRAINT booking_addons_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_changes booking_changes_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_changes
    ADD CONSTRAINT booking_changes_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_changes booking_changes_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_changes
    ADD CONSTRAINT booking_changes_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);

--
-- Name: booking_charges booking_charges_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_charges booking_charges_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);

--
-- Name: booking_events booking_events_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_events
    ADD CONSTRAINT booking_events_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_inspections booking_inspections_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_inspections
    ADD CONSTRAINT booking_inspections_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_inspections booking_inspections_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_inspections
    ADD CONSTRAINT booking_inspections_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id);

--
-- Name: booking_lines booking_lines_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_lines
    ADD CONSTRAINT booking_lines_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: booking_lines booking_lines_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_lines
    ADD CONSTRAINT booking_lines_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id);

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
-- Name: bookings bookings_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.checkouts(id);

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
-- Name: capacity_holds capacity_holds_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_holds
    ADD CONSTRAINT capacity_holds_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: capacity_holds capacity_holds_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_holds
    ADD CONSTRAINT capacity_holds_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: checkouts checkouts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);

--
-- Name: checkouts checkouts_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkouts
    ADD CONSTRAINT checkouts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);

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
-- Name: customer_licences customer_licences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_licences
    ADD CONSTRAINT customer_licences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

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
-- Name: inventory_items inventory_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.item_categories(id);

--
-- Name: inventory_items inventory_items_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: inventory_movements inventory_movements_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: inventory_movements inventory_movements_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id);

--
-- Name: item_categories item_categories_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_categories
    ADD CONSTRAINT item_categories_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: media media_addon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_addon_id_fkey FOREIGN KEY (addon_id) REFERENCES public.service_addons(id);

--
-- Name: media media_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id);

--
-- Name: media media_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id);

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
-- Name: refunds refunds_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: reservations reservations_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);

--
-- Name: reservations reservations_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id);

--
-- Name: resources resources_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

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
-- Name: service_addons service_addons_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_addons
    ADD CONSTRAINT service_addons_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);

--
-- Name: service_addons service_addons_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_addons
    ADD CONSTRAINT service_addons_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: service_bundles service_bundles_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_bundles
    ADD CONSTRAINT service_bundles_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);

--
-- Name: services services_resource_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_resource_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id);

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
-- Name: vendor_documents vendor_documents_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_documents
    ADD CONSTRAINT vendor_documents_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id);

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
