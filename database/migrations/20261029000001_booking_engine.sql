-- migrate:up
-- Service booking rules engine (docs/BOOKING_ENGINE.md). Everything here is additive:
-- - existing categories, services and bookings keep booking type 'slot' and behave exactly as before;
-- - bookings get real timestamps back-filled from their day and slot.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- templates: what a category books like, and what a service sells ----------

ALTER TABLE categories
  ADD COLUMN booking_type text NOT NULL DEFAULT 'slot'
    CHECK (booking_type IN ('slot', 'time_window', 'rental', 'per_person', 'staffing', 'appointment', 'transport', 'quote')),
  ADD COLUMN group_key text NOT NULL DEFAULT 'other'
    CHECK (group_key IN ('wedding', 'entertainment', 'catering', 'transport', 'wedding_services', 'other')),
  ADD COLUMN template jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN categories.booking_type IS 'How bookings in this category work (see the booking type registry in apps/backend/src/engine)';
COMMENT ON COLUMN categories.template IS 'Admin template: attributes, customer questions, rule defaults and allowed pricing models (validated in code)';

ALTER TABLE services
  ADD COLUMN booking_type text NOT NULL DEFAULT 'slot',
  ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN rules jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN resource_id uuid;
COMMENT ON COLUMN services.booking_type IS 'Copied from the category when the service is created; old services stay slot';
COMMENT ON COLUMN services.pricing IS 'Pricing model and rates for the engine (fixed, hourly, daily, per_unit, per_person, per_trip, quote)';
COMMENT ON COLUMN services.rules IS 'Vendor overrides of the category rule defaults (durations, buffers, quantities, advance, deposit, approval)';
COMMENT ON COLUMN services.resource_id IS 'For a service that is one specific resource (a car, a hall): that resource';

-- ---------- resources: things that can only be in one place at a time ----------

CREATE TABLE resources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     uuid NOT NULL REFERENCES vendors(id),
  kind          text NOT NULL CHECK (kind IN ('vehicle', 'driver', 'staff', 'artist', 'venue', 'equipment', 'crew')),
  name          text NOT NULL,
  attributes    jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'inactive')),
  verification  text NOT NULL DEFAULT 'not_required' CHECK (verification IN ('not_required', 'pending', 'approved', 'rejected', 'suspended')),
  reject_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resources_vendor_kind_idx ON resources (vendor_id, kind);
-- A registration number belongs to one vehicle.
CREATE UNIQUE INDEX resources_vehicle_registration_key ON resources ((upper(attributes->>'registration'))) WHERE kind = 'vehicle';
COMMENT ON TABLE resources IS 'Vehicles, drivers, staff, artists, halls and equipment sets that one booking at a time can use; attributes validated per kind in code';

ALTER TABLE services ADD CONSTRAINT services_resource_fkey FOREIGN KEY (resource_id) REFERENCES resources(id);

-- ---------- bookings: real times, the agreed snapshot, money split ----------

ALTER TABLE bookings
  ADD COLUMN booking_type text NOT NULL DEFAULT 'slot',
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz,
  ADD COLUMN occupy_from timestamptz,
  ADD COLUMN occupy_until timestamptz,
  ADD COLUMN return_due_at timestamptz,
  ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN cancellation_policy jsonb,
  ADD COLUMN tax_paise integer NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  ADD COLUMN deposit_paise integer NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  ADD COLUMN charges_paise integer NOT NULL DEFAULT 0,
  ADD COLUMN fulfilment text NOT NULL DEFAULT 'scheduled'
    CHECK (fulfilment IN ('scheduled', 'assigned', 'ready', 'in_progress', 'return_pending', 'closed')),
  ADD COLUMN actual_start_at timestamptz,
  ADD COLUMN actual_end_at timestamptz,
  ADD COLUMN idempotency_key text;
ALTER TABLE bookings ADD CONSTRAINT bookings_time_order CHECK (ends_at IS NULL OR ends_at > starts_at);
CREATE UNIQUE INDEX bookings_idempotency_key ON bookings (customer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
COMMENT ON COLUMN bookings.starts_at IS 'When the service starts (pickup, dispatch, appointment); ends_at when it ends or is due back';
COMMENT ON COLUMN bookings.occupy_from IS 'Resources are held from occupy_from to occupy_until: the service time plus setup, dismantling, cleaning and turnaround buffers';
COMMENT ON COLUMN bookings.snapshot IS 'Immutable copy of what was agreed: rules, pricing, the itemised quote, answers, add-ons and attributes';
COMMENT ON COLUMN bookings.cancellation_policy IS 'Refund tiers agreed at booking time; later policy changes never apply to this booking';
COMMENT ON COLUMN bookings.deposit_paise IS 'Refundable security deposit; kept apart from booking revenue';
COMMENT ON COLUMN bookings.charges_paise IS 'Accepted extra charges (overtime, extra km, damage …) on top of amount_paise';
COMMENT ON COLUMN bookings.fulfilment IS 'Service progress after confirmation: scheduled → assigned → ready → in_progress → return_pending → closed';

-- Old bookings: times from day + slot (India time), the same refund tiers they were made under.
UPDATE bookings SET
  starts_at = (day + CASE slot WHEN 'day' THEN time '10:00' WHEN 'night' THEN time '18:00' ELSE time '06:00' END) AT TIME ZONE 'Asia/Kolkata',
  ends_at   = (day + CASE slot WHEN 'day' THEN time '16:00' WHEN 'night' THEN time '23:00' ELSE time '23:59' END) AT TIME ZONE 'Asia/Kolkata',
  cancellation_policy = '{"customer":[{"minDays":15,"percent":90},{"minDays":7,"percent":50},{"minDays":0,"percent":0}],"vendorPercent":100}';
UPDATE bookings SET occupy_from = starts_at, occupy_until = ends_at;

-- The "one open booking per event and vendor" rule stops duplicate slot requests; engine bookings use
-- idempotency keys instead (two cars from one vendor for one wedding is normal).
DROP INDEX bookings_one_open_per_event_vendor;
CREATE UNIQUE INDEX bookings_one_open_per_event_vendor ON bookings (event_id, vendor_id)
  WHERE status IN ('requested', 'accepted', 'confirmed') AND booking_type = 'slot';
CREATE INDEX bookings_occupy_idx ON bookings (vendor_id, occupy_from, occupy_until) WHERE status IN ('requested', 'accepted', 'confirmed');

-- ---------- reservations: exclusive resources, never double-booked ----------

CREATE TABLE reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  uuid NOT NULL REFERENCES resources(id),
  booking_id   uuid REFERENCES bookings(id),
  period       tstzrange NOT NULL,
  status       text NOT NULL CHECK (status IN ('hold', 'active', 'released', 'expired')),
  reason       text,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'hold' OR expires_at IS NOT NULL),
  CHECK (NOT isempty(period)),
  -- The database itself refuses two live reservations of one resource that overlap in time.
  EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE (status IN ('hold', 'active'))
);
CREATE INDEX reservations_booking_idx ON reservations (booking_id);
CREATE INDEX reservations_expiry_idx ON reservations (expires_at) WHERE status = 'hold';
COMMENT ON TABLE reservations IS 'Time a resource is taken: a hold (expires), active (booked or blocked by the vendor), then released';

-- ---------- quantity pools: rental stock, staff counts, daily guest capacity ----------

CREATE TABLE inventory_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         uuid NOT NULL REFERENCES vendors(id),
  name              text NOT NULL,
  unit              text NOT NULL DEFAULT 'piece',
  total_qty         integer NOT NULL CHECK (total_qty >= 0),
  -- Out of use until repaired or cleaned (not available to book).
  repair_qty        integer NOT NULL DEFAULT 0 CHECK (repair_qty >= 0),
  rent_paise        integer NOT NULL DEFAULT 0 CHECK (rent_paise >= 0),
  rent_per          text NOT NULL DEFAULT 'booking' CHECK (rent_per IN ('booking', 'day')),
  deposit_paise     integer NOT NULL DEFAULT 0 CHECK (deposit_paise >= 0),
  damage_paise      integer NOT NULL DEFAULT 0 CHECK (damage_paise >= 0),
  min_qty           integer NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  attributes        jsonb NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (repair_qty <= total_qty)
);
CREATE INDEX inventory_items_vendor_idx ON inventory_items (vendor_id);
COMMENT ON TABLE inventory_items IS 'Rental stock (plates, chairs, speakers, coolers …): how many exist, how many are in repair, price, deposit and damage charge per unit';

CREATE TABLE capacity_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_key    text NOT NULL,
  vendor_id   uuid NOT NULL REFERENCES vendors(id),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  qty         integer NOT NULL CHECK (qty > 0),
  period      tstzrange NOT NULL,
  status      text NOT NULL CHECK (status IN ('hold', 'active', 'released', 'expired')),
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_holds_pool_idx ON capacity_holds USING gist (pool_key, period) WHERE status IN ('hold', 'active');
CREATE INDEX capacity_holds_booking_idx ON capacity_holds (booking_id);
COMMENT ON TABLE capacity_holds IS 'Quantities taken from a pool for a time (item:<id> stock, staff:<kind> head-count, guests:<service> per day); checked under an advisory lock';

-- What a booking takes from stock, and what happened to it.
CREATE TABLE booking_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  qty               integer NOT NULL CHECK (qty > 0),
  unit_paise        integer NOT NULL,
  deposit_paise     integer NOT NULL DEFAULT 0,
  dispatched_qty    integer NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
  returned_qty      integer NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  damaged_qty       integer NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty       integer NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  UNIQUE (booking_id, inventory_item_id),
  CHECK (returned_qty + damaged_qty + missing_qty <= dispatched_qty)
);

CREATE TABLE inventory_movements (
  id                bigserial PRIMARY KEY,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  booking_id        uuid REFERENCES bookings(id),
  kind              text NOT NULL CHECK (kind IN ('dispatch', 'return', 'damaged', 'missing', 'repaired', 'written_off', 'added', 'removed')),
  qty               integer NOT NULL CHECK (qty > 0),
  note              text,
  actor_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (inventory_item_id, created_at DESC);
COMMENT ON TABLE inventory_movements IS 'Every change to rental stock: dispatch, return, damage, missing, repair, write-off';

-- ---------- add-ons (decoration packages, album, drone, trial …) ----------

CREATE TABLE service_addons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id         uuid NOT NULL REFERENCES vendors(id),
  service_id        uuid REFERENCES services(id),
  name              text NOT NULL,
  kind              text NOT NULL DEFAULT 'extra',
  inclusions        text[] NOT NULL DEFAULT '{}',
  exclusions        text[] NOT NULL DEFAULT '{}',
  price_paise       integer NOT NULL CHECK (price_paise >= 0),
  setup_minutes     integer NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0),
  requires_approval boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_addons_vendor_idx ON service_addons (vendor_id);
COMMENT ON TABLE service_addons IS 'Optional extras a vendor offers (car decoration packages, drone, album, makeup trial); custom ones need vendor approval';

CREATE TABLE booking_addons (
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  addon_id     uuid NOT NULL REFERENCES service_addons(id),
  price_paise  integer NOT NULL,
  request_note text,
  status       text NOT NULL CHECK (status IN ('included', 'pending_approval', 'approved', 'declined')),
  decided_at   timestamptz,
  PRIMARY KEY (booking_id, addon_id)
);
COMMENT ON TABLE booking_addons IS 'Extras chosen with a booking, at the price agreed; ones needing approval are approved or declined when the vendor accepts';

-- ---------- fulfilment: inspections, extra charges, changes, timeline ----------

CREATE TABLE booking_inspections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  phase        text NOT NULL CHECK (phase IN ('handover', 'return')),
  readings     jsonb NOT NULL DEFAULT '{}',
  notes        text,
  photo_ids    text[] NOT NULL DEFAULT '{}',
  recorded_by  uuid NOT NULL REFERENCES users(id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  customer_ack text CHECK (customer_ack IN ('agreed', 'disputed')),
  customer_note text,
  acked_at     timestamptz,
  UNIQUE (booking_id, phase)
);
COMMENT ON TABLE booking_inspections IS 'Condition at handover and return (odometer, fuel, damage, counts, photos) and the customer''s agreement or dispute';

CREATE TABLE booking_charges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id),
  kind         text NOT NULL CHECK (kind IN ('extra_km', 'extra_hours', 'late_return', 'waiting', 'toll', 'parking', 'fuel', 'damage', 'missing', 'cleaning', 'extension', 'guest_change', 'other')),
  description  text NOT NULL,
  qty          numeric NOT NULL DEFAULT 1,
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  status       text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'disputed', 'waived', 'resolved')),
  from_deposit boolean NOT NULL DEFAULT false,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  created_by   uuid NOT NULL REFERENCES users(id),
  decided_by   uuid,
  decision_note text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz
);
CREATE INDEX booking_charges_booking_idx ON booking_charges (booking_id);
COMMENT ON TABLE booking_charges IS 'Extra charges after the service (km, hours, late return, damage …): proposed by the vendor, accepted or disputed by the customer, decided by an admin in a dispute';

CREATE TABLE booking_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id),
  kind          text NOT NULL CHECK (kind IN ('extension', 'reschedule', 'quantity')),
  requested_by  uuid NOT NULL REFERENCES users(id),
  new_starts_at timestamptz,
  new_ends_at   timestamptz,
  new_qty       integer,
  price_diff_paise integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX booking_changes_booking_idx ON booking_changes (booking_id);
CREATE UNIQUE INDEX booking_changes_one_open ON booking_changes (booking_id) WHERE status = 'requested';
COMMENT ON TABLE booking_changes IS 'Requests to extend, reschedule or change the quantity of a booking; one open at a time';

CREATE TABLE booking_events (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  event       text NOT NULL,
  actor_id    uuid,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, id);
COMMENT ON TABLE booking_events IS 'Audit trail of every state change on a booking (who, when, what)';

-- ---------- self-drive: the customer's driving licence ----------

CREATE TABLE customer_licences (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  number_enc     text NOT NULL,
  number_last4   text NOT NULL,
  date_of_birth  date NOT NULL,
  expires_on     date NOT NULL,
  storage_key    text,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reject_reason  text,
  verified_by    uuid,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE customer_licences IS 'Driving licence for self-drive cars: number encrypted (BANK_DETAILS_KEY), verified by an admin or by the vendor at handover';

-- ---------- money: deposits are their own payments ----------

ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'deposit';

-- ---------- documents and photos for resources ----------

ALTER TABLE vendor_documents ADD COLUMN resource_id uuid REFERENCES resources(id);
ALTER TABLE vendor_documents DROP CONSTRAINT vendor_documents_doc_type_check;
ALTER TABLE vendor_documents ADD CONSTRAINT vendor_documents_doc_type_check CHECK (doc_type IN (
  'aadhaar', 'pan', 'gst', 'shop_photo',
  'vehicle_rc', 'vehicle_insurance', 'vehicle_permit', 'vehicle_puc', 'driver_licence', 'police_verification'));
ALTER TABLE media ADD COLUMN resource_id uuid REFERENCES resources(id), ADD COLUMN addon_id uuid REFERENCES service_addons(id);
CREATE INDEX media_resource_idx ON media (resource_id) WHERE resource_id IS NOT NULL;

-- migrate:down
ALTER TABLE media DROP COLUMN IF EXISTS addon_id, DROP COLUMN IF EXISTS resource_id;
ALTER TABLE vendor_documents DROP CONSTRAINT IF EXISTS vendor_documents_doc_type_check;
ALTER TABLE vendor_documents ADD CONSTRAINT vendor_documents_doc_type_check CHECK (doc_type IN ('aadhaar', 'pan', 'gst', 'shop_photo'));
ALTER TABLE vendor_documents DROP COLUMN IF EXISTS resource_id;
DROP TABLE IF EXISTS customer_licences, booking_events, booking_changes, booking_charges, booking_inspections, booking_addons,
  service_addons, inventory_movements, booking_lines, capacity_holds, inventory_items, reservations;
DROP INDEX IF EXISTS bookings_occupy_idx;
DROP INDEX IF EXISTS bookings_one_open_per_event_vendor;
CREATE UNIQUE INDEX bookings_one_open_per_event_vendor ON bookings (event_id, vendor_id) WHERE status IN ('requested', 'accepted', 'confirmed');
DROP INDEX IF EXISTS bookings_idempotency_key;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_time_order;
ALTER TABLE bookings DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS actual_end_at, DROP COLUMN IF EXISTS actual_start_at,
  DROP COLUMN IF EXISTS fulfilment, DROP COLUMN IF EXISTS charges_paise, DROP COLUMN IF EXISTS deposit_paise, DROP COLUMN IF EXISTS tax_paise,
  DROP COLUMN IF EXISTS cancellation_policy, DROP COLUMN IF EXISTS snapshot, DROP COLUMN IF EXISTS return_due_at,
  DROP COLUMN IF EXISTS occupy_until, DROP COLUMN IF EXISTS occupy_from, DROP COLUMN IF EXISTS ends_at, DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS booking_type;
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_resource_fkey;
DROP TABLE IF EXISTS resources;
ALTER TABLE services DROP COLUMN IF EXISTS resource_id, DROP COLUMN IF EXISTS attributes, DROP COLUMN IF EXISTS rules,
  DROP COLUMN IF EXISTS pricing, DROP COLUMN IF EXISTS booking_type;
ALTER TABLE categories DROP COLUMN IF EXISTS template, DROP COLUMN IF EXISTS group_key, DROP COLUMN IF EXISTS booking_type;
-- (payment_type 'deposit' cannot be removed from the enum; it is harmless when unused.)
