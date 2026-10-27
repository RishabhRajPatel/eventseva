-- migrate:up
-- Tent house / bartan rentals and vendor-managed stock (docs/BOOKING_ENGINE.md, "Rentals").

-- ---------- item categories: six defaults for everyone, plus each vendor's own ----------

CREATE TABLE item_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL: a default category every vendor sees.
  vendor_id   uuid REFERENCES vendors(id),
  key         text,
  name_en     text NOT NULL CHECK (length(name_en) BETWEEN 2 AND 40),
  name_hi     text NOT NULL CHECK (length(name_hi) BETWEEN 1 AND 40),
  examples_en text,
  examples_hi text,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((vendor_id IS NULL) = (key IS NOT NULL))
);
CREATE UNIQUE INDEX item_categories_default_key ON item_categories (key) WHERE vendor_id IS NULL;
CREATE UNIQUE INDEX item_categories_vendor_name ON item_categories (vendor_id, lower(name_en)) WHERE vendor_id IS NOT NULL AND is_active;
COMMENT ON TABLE item_categories IS 'Groups for rental items: the defaults (tent, furniture, cooking, dining, serving, equipment) and categories vendors add themselves';

INSERT INTO item_categories (key, name_en, name_hi, examples_en, examples_hi, sort_order) VALUES
  ('tent_decor', 'Tent & decoration', 'टेंट और सजावट', 'Tent, shamiana, canopy, poles, curtains, stage, sofa, carpet, lighting', 'टेंट, शामियाना, कैनोपी, बल्ली, पर्दे, स्टेज, सोफ़ा, कालीन, लाइट', 10),
  ('furniture', 'Furniture & bedding', 'फ़र्नीचर और बिस्तर', 'Chairs, tables, charpai/khat, beds, mattresses, pillows, blankets', 'कुर्सी, मेज़, चारपाई/खाट, पलंग, गद्दे, तकिये, कंबल', 20),
  ('cooking', 'Cooking utensils', 'खाना बनाने के बर्तन', 'Deg, patila, bhagona, handi, kadhai, tawa, large pots', 'देग, पतीला, भगोना, हांडी, कढ़ाई, तवा, बड़े बर्तन', 30),
  ('dining', 'Dining utensils', 'खाने-पीने के बर्तन', 'Plates, thalis, bowls, katoris, glasses, cups, spoons', 'प्लेट, थाली, कटोरी, गिलास, कप, चम्मच', 40),
  ('serving', 'Serving equipment', 'परोसने का सामान', 'Serving trays, ladles, jhara, buckets, buffet containers, food warmers', 'ट्रे, करछी, झारा, बाल्टी, बुफ़े बर्तन, फ़ूड वॉर्मर', 50),
  ('equipment', 'Other event equipment', 'अन्य सामान', 'Generator, fans, coolers and more', 'जनरेटर, पंखे, कूलर और भी', 60);

-- ---------- rental items: what vendors list ----------

ALTER TABLE inventory_items
  ADD COLUMN category_id   uuid REFERENCES item_categories(id),
  ADD COLUMN description   text CHECK (length(description) <= 1000),
  ADD COLUMN quality       text NOT NULL DEFAULT 'standard' CHECK (quality IN ('basic', 'standard', 'premium', 'custom')),
  ADD COLUMN quality_label text CHECK (length(quality_label) <= 30),
  ADD COLUMN condition     text NOT NULL DEFAULT 'good' CHECK (condition IN ('new', 'good', 'used', 'needs_repair')),
  ADD COLUMN missing_paise integer NOT NULL DEFAULT 0 CHECK (missing_paise >= 0),
  ADD COLUMN max_qty       integer CHECK (max_qty IS NULL OR max_qty >= 1),
  ADD COLUMN min_days      integer NOT NULL DEFAULT 1 CHECK (min_days BETWEEN 1 AND 60),
  ADD COLUMN max_days      integer CHECK (max_days IS NULL OR max_days BETWEEN 1 AND 60),
  ADD COLUMN deleted_at    timestamptz,
  ADD COLUMN updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT inventory_items_unit_check CHECK (length(unit) BETWEEN 1 AND 20),
  ADD CONSTRAINT inventory_items_days_check CHECK (max_days IS NULL OR max_days >= min_days),
  ADD CONSTRAINT inventory_items_deleted_inactive CHECK (deleted_at IS NULL OR NOT is_active);
CREATE UNIQUE INDEX inventory_items_vendor_name ON inventory_items (vendor_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX inventory_items_category_idx ON inventory_items (vendor_id, category_id) WHERE is_active;
COMMENT ON COLUMN inventory_items.repair_qty IS 'Units out of use (damaged, being repaired or cleaned); not bookable';
COMMENT ON COLUMN inventory_items.quality IS 'basic / standard / premium, or custom with quality_label';
COMMENT ON COLUMN inventory_items.condition IS 'Listing condition; needs_repair stops new bookings';
COMMENT ON COLUMN inventory_items.missing_paise IS 'Charge per unit not returned (0: use damage_paise)';
COMMENT ON COLUMN inventory_items.deleted_at IS 'Removed by the vendor but kept because bookings or stock records point to it';

-- ---------- what a booking took, as agreed, and what happened to it ----------

ALTER TABLE booking_lines
  ADD COLUMN item_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN damage_paise  integer NOT NULL DEFAULT 0 CHECK (damage_paise >= 0),
  ADD COLUMN missing_paise integer NOT NULL DEFAULT 0 CHECK (missing_paise >= 0),
  ADD COLUMN loaded_qty    integer NOT NULL DEFAULT 0 CHECK (loaded_qty >= 0),
  ADD COLUMN delivered_qty integer NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
  ADD COLUMN note          text CHECK (length(note) <= 500),
  ADD COLUMN verified_at   timestamptz,
  ADD CONSTRAINT booking_lines_flow_check CHECK (loaded_qty <= qty AND dispatched_qty <= loaded_qty AND delivered_qty <= dispatched_qty);
COMMENT ON COLUMN booking_lines.item_snapshot IS 'Item name, unit, quality, condition and charges as booked; later listing edits never change it';
COMMENT ON TABLE booking_lines IS 'Items a rental booking takes from stock and their trip: loaded → dispatched → delivered → returned / damaged / missing, then verified';

-- ---------- stock holds: vendor blocks, and stock still out after the booking ended ----------

ALTER TABLE capacity_holds
  ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN until_returned boolean NOT NULL DEFAULT false,
  ADD COLUMN note text CHECK (length(note) <= 200),
  ADD CONSTRAINT capacity_holds_owner_check CHECK (booking_id IS NOT NULL OR note IS NOT NULL);
COMMENT ON COLUMN capacity_holds.until_returned IS 'Stock dispatched and not yet checked back in: blocks the pool past the end of its period';
COMMENT ON COLUMN capacity_holds.note IS 'A vendor''s own block (no booking): why the stock is unavailable';

-- ---------- rental steps ----------

ALTER TABLE bookings DROP CONSTRAINT bookings_fulfilment_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_fulfilment_check
  CHECK (fulfilment IN ('scheduled', 'preparing', 'assigned', 'ready', 'dispatched', 'delivered', 'in_progress', 'return_pending', 'closed'));
COMMENT ON COLUMN bookings.fulfilment IS 'Progress after confirmation. Rentals: scheduled → preparing → dispatched → delivered → return_pending → closed (returned and verified). Others: scheduled → assigned → ready → in_progress → return_pending → closed';

ALTER TABLE booking_inspections DROP CONSTRAINT booking_inspections_phase_check;
ALTER TABLE booking_inspections ADD CONSTRAINT booking_inspections_phase_check CHECK (phase IN ('handover', 'return', 'dispatch', 'delivery'));

ALTER TABLE bookings ADD COLUMN deposit_settled_at timestamptz;
COMMENT ON COLUMN bookings.deposit_settled_at IS 'When agreed charges were taken from the security deposit and the rest refunded; rentals complete only after this';

ALTER TABLE media ADD COLUMN inventory_item_id uuid REFERENCES inventory_items(id);
CREATE INDEX media_inventory_item_idx ON media (inventory_item_id) WHERE inventory_item_id IS NOT NULL;
COMMENT ON COLUMN media.inventory_item_id IS 'Photo of a rental item (not shown in the vendor gallery)';

-- migrate:down
ALTER TABLE bookings DROP COLUMN IF EXISTS deposit_settled_at;
DROP INDEX IF EXISTS media_inventory_item_idx;
ALTER TABLE media DROP COLUMN IF EXISTS inventory_item_id;
ALTER TABLE booking_inspections DROP CONSTRAINT booking_inspections_phase_check;
ALTER TABLE booking_inspections ADD CONSTRAINT booking_inspections_phase_check CHECK (phase IN ('handover', 'return'));
ALTER TABLE bookings DROP CONSTRAINT bookings_fulfilment_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_fulfilment_check
  CHECK (fulfilment IN ('scheduled', 'assigned', 'ready', 'in_progress', 'return_pending', 'closed'));
DELETE FROM capacity_holds WHERE booking_id IS NULL;
ALTER TABLE capacity_holds DROP CONSTRAINT capacity_holds_owner_check, DROP COLUMN note, DROP COLUMN until_returned,
  ALTER COLUMN booking_id SET NOT NULL;
ALTER TABLE booking_lines DROP CONSTRAINT booking_lines_flow_check, DROP COLUMN verified_at, DROP COLUMN note, DROP COLUMN delivered_qty,
  DROP COLUMN loaded_qty, DROP COLUMN missing_paise, DROP COLUMN damage_paise, DROP COLUMN item_snapshot;
DROP INDEX IF EXISTS inventory_items_category_idx;
DROP INDEX IF EXISTS inventory_items_vendor_name;
ALTER TABLE inventory_items DROP CONSTRAINT inventory_items_deleted_inactive, DROP CONSTRAINT inventory_items_days_check,
  DROP CONSTRAINT inventory_items_unit_check, DROP COLUMN updated_at, DROP COLUMN deleted_at, DROP COLUMN max_days, DROP COLUMN min_days,
  DROP COLUMN max_qty, DROP COLUMN missing_paise, DROP COLUMN condition, DROP COLUMN quality_label, DROP COLUMN quality,
  DROP COLUMN description, DROP COLUMN category_id;
DROP TABLE IF EXISTS item_categories;
