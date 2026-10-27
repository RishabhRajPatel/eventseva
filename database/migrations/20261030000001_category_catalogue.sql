-- migrate:up
-- Booking type, group and template (vendor attributes, customer questions, default rules) for every
-- category, so vendors can offer time, quantity, vehicle and staff based services
-- (docs/BOOKING_ENGINE.md). Which categories customers see does not change here: hidden ones stay
-- hidden until an admin turns them on. Old day + slot services keep working (services.booking_type).

UPDATE categories SET group_key = 'entertainment', booking_type = 'time_window', template = '{
  "resourceKind": "crew",
  "pricingModels": ["fixed", "hourly"],
  "rules": {"minDurationMin": 120, "maxDurationMin": 1440, "setupMin": 90, "dismantleMin": 60, "leadTimeHours": 12},
  "attributes": [
    {"key": "speakers_watt", "label": {"en": "Sound system (watts)", "hi": "साउंड सिस्टम (वॉट)"}, "type": "number", "min": 100, "max": 200000},
    {"key": "lights_included", "label": {"en": "Lights included", "hi": "लाइट शामिल"}, "type": "boolean"},
    {"key": "generator_included", "label": {"en": "Generator included", "hi": "जनरेटर शामिल"}, "type": "boolean"}
  ],
  "questions": [
    {"key": "occasion", "label": {"en": "Occasion", "hi": "मौका"}, "type": "select", "required": true, "options": [
      {"value": "sangeet", "label": {"en": "Sangeet", "hi": "संगीत"}}, {"value": "baraat", "label": {"en": "Baraat", "hi": "बारात"}},
      {"value": "reception", "label": {"en": "Reception", "hi": "रिसेप्शन"}}, {"value": "party", "label": {"en": "Party", "hi": "पार्टी"}}]},
    {"key": "power_at_venue", "label": {"en": "Power available at the venue", "hi": "वेन्यू पर बिजली है"}, "type": "boolean"}
  ]
}' WHERE slug = 'dj';

UPDATE categories SET group_key = 'wedding', booking_type = 'time_window', template = '{
  "resourceKind": "crew",
  "pricingModels": ["fixed", "quote"],
  "rules": {"minDurationMin": 120, "maxDurationMin": 4320, "setupMin": 240, "dismantleMin": 120, "leadTimeHours": 48},
  "questions": [
    {"key": "theme", "label": {"en": "Theme or colours", "hi": "थीम या रंग"}, "type": "text", "maxLength": 200},
    {"key": "area", "label": {"en": "Area to decorate", "hi": "सजाने की जगह"}, "type": "multiselect", "options": [
      {"value": "stage", "label": {"en": "Stage", "hi": "स्टेज"}}, {"value": "entrance", "label": {"en": "Entrance", "hi": "प्रवेश"}},
      {"value": "mandap", "label": {"en": "Mandap", "hi": "मंडप"}}, {"value": "lighting", "label": {"en": "Lighting", "hi": "लाइटिंग"}}]}
  ]
}' WHERE slug = 'decor';

UPDATE categories SET group_key = 'catering', booking_type = 'per_person', template = '{
  "pricingModels": ["per_person"],
  "rules": {"minQty": 25, "maxQty": 5000, "setupMin": 180, "dismantleMin": 60, "leadTimeHours": 48},
  "questions": [
    {"key": "menu", "label": {"en": "Menu", "hi": "मेन्यू"}, "type": "select", "required": true, "options": [
      {"value": "veg", "label": {"en": "Veg", "hi": "शाकाहारी"}}, {"value": "jain", "label": {"en": "Jain", "hi": "जैन"}},
      {"value": "non_veg", "label": {"en": "Non-veg", "hi": "मांसाहारी"}}]},
    {"key": "meal", "label": {"en": "Meal", "hi": "भोजन"}, "type": "select", "options": [
      {"value": "breakfast", "label": {"en": "Breakfast", "hi": "नाश्ता"}}, {"value": "lunch", "label": {"en": "Lunch", "hi": "दोपहर का खाना"}},
      {"value": "dinner", "label": {"en": "Dinner", "hi": "रात का खाना"}}]}
  ]
}' WHERE slug = 'catering';

UPDATE categories SET group_key = 'wedding_services', booking_type = 'rental', template = '{"pricingModels": ["per_unit"], "rules": {"bufferAfterMin": 240, "leadTimeHours": 12}}'
 WHERE slug IN ('bartan', 'tent');

UPDATE categories SET group_key = 'wedding', booking_type = 'quote', template = '{
  "pricingModels": ["quote"],
  "rules": {"leadTimeHours": 72},
  "questions": [
    {"key": "budget", "label": {"en": "Budget (₹)", "hi": "बजट (₹)"}, "type": "number", "min": 0, "max": 100000000},
    {"key": "needs", "label": {"en": "What you need", "hi": "आपको क्या चाहिए"}, "type": "text", "required": true, "maxLength": 1000}
  ]
}' WHERE slug = 'planner';

UPDATE categories SET group_key = 'entertainment', booking_type = 'time_window', template = '{
  "resourceKind": "crew",
  "pricingModels": ["fixed", "hourly", "daily"],
  "rules": {"minDurationMin": 120, "maxDurationMin": 4320, "setupMin": 30, "leadTimeHours": 24},
  "attributes": [
    {"key": "album_included", "label": {"en": "Album included", "hi": "एल्बम शामिल"}, "type": "boolean"},
    {"key": "drone", "label": {"en": "Drone shoot", "hi": "ड्रोन शूट"}, "type": "boolean"},
    {"key": "delivery_days", "label": {"en": "Photos delivered in (days)", "hi": "फ़ोटो कितने दिन में"}, "type": "number", "min": 1, "max": 180}
  ]
}' WHERE slug = 'camera';

-- Hidden categories get their booking type too, ready for when an admin turns them on.
UPDATE categories SET group_key = 'wedding', booking_type = 'time_window', template = '{
  "resourceKind": "venue",
  "pricingModels": ["fixed", "hourly", "daily"],
  "rules": {"minDurationMin": 180, "maxDurationMin": 4320, "setupMin": 120, "dismantleMin": 60, "bufferAfterMin": 120, "leadTimeHours": 48},
  "attributes": [
    {"key": "capacity", "label": {"en": "Guests (seating)", "hi": "मेहमान (बैठने की जगह)"}, "type": "number", "min": 10, "max": 20000},
    {"key": "ac", "label": {"en": "Air-conditioned", "hi": "एसी"}, "type": "boolean"},
    {"key": "parking", "label": {"en": "Parking", "hi": "पार्किंग"}, "type": "boolean"}
  ]
}' WHERE slug = 'hall';

UPDATE categories SET group_key = 'catering', booking_type = 'staffing', template = '{
  "staffKind": "cook",
  "pricingModels": ["fixed", "hourly"],
  "rules": {"minQty": 1, "maxQty": 50, "minDurationMin": 240, "maxDurationMin": 1440, "leadTimeHours": 24}
}' WHERE slug = 'halwai';

UPDATE categories SET group_key = 'entertainment', booking_type = 'time_window', template = '{
  "resourceKind": "crew",
  "pricingModels": ["fixed", "hourly"],
  "rules": {"minDurationMin": 60, "maxDurationMin": 720, "leadTimeHours": 24},
  "attributes": [{"key": "members", "label": {"en": "Band members", "hi": "बैंड के सदस्य"}, "type": "number", "min": 1, "max": 200}]
}' WHERE slug = 'band';

UPDATE categories SET group_key = 'transport', booking_type = 'transport', template = '{
  "resourceKind": "vehicle",
  "pricingModels": ["fixed", "hourly", "daily", "per_trip"],
  "rules": {"minDurationMin": 120, "maxDurationMin": 10080, "setupMin": 60, "bufferAfterMin": 120, "leadTimeHours": 12, "minAge": 21,
            "requiredDocuments": [], "deposit": {"fixedPaise": 500000}},
  "questions": [
    {"key": "decoration_note", "label": {"en": "Decoration wishes", "hi": "सजावट की पसंद"}, "type": "text", "maxLength": 300}
  ]
}' WHERE slug = 'car';

UPDATE categories SET group_key = 'other', booking_type = 'time_window', template = '{
  "resourceKind": "venue",
  "pricingModels": ["fixed", "daily"],
  "rules": {"minDurationMin": 720, "maxDurationMin": 10080, "leadTimeHours": 24}
}' WHERE slug = 'hotel';

UPDATE categories SET group_key = 'catering', booking_type = 'staffing', template = '{
  "staffKind": "staff",
  "pricingModels": ["fixed", "hourly"],
  "rules": {"minQty": 1, "maxQty": 200, "minDurationMin": 240, "maxDurationMin": 1440, "leadTimeHours": 24},
  "questions": [{"key": "uniform", "label": {"en": "Uniform needed", "hi": "यूनिफ़ॉर्म चाहिए"}, "type": "boolean"}]
}' WHERE slug = 'bartender';

UPDATE categories SET group_key = 'wedding_services', booking_type = 'appointment', template = '{
  "resourceKind": "artist",
  "pricingModels": ["per_person", "fixed"],
  "rules": {"perPersonMin": 60, "minQty": 1, "maxQty": 20, "bufferAfterMin": 30, "leadTimeHours": 24},
  "questions": [
    {"key": "service", "label": {"en": "For", "hi": "किसके लिए"}, "type": "select", "required": true, "options": [
      {"value": "bridal", "label": {"en": "Bridal makeup", "hi": "दुल्हन मेकअप"}}, {"value": "party", "label": {"en": "Party makeup", "hi": "पार्टी मेकअप"}},
      {"value": "mehendi", "label": {"en": "Mehendi", "hi": "मेहंदी"}}]},
    {"key": "trial", "label": {"en": "Trial before the day", "hi": "पहले ट्रायल"}, "type": "boolean"}
  ]
}' WHERE slug = 'makeup';

UPDATE categories SET group_key = 'other', booking_type = 'time_window', template = '{
  "resourceKind": "artist",
  "pricingModels": ["fixed", "hourly"],
  "rules": {"minDurationMin": 60, "maxDurationMin": 720, "leadTimeHours": 24},
  "questions": [{"key": "language", "label": {"en": "Language", "hi": "भाषा"}, "type": "select", "options": [
    {"value": "hindi", "label": {"en": "Hindi", "hi": "हिंदी"}}, {"value": "sanskrit", "label": {"en": "Sanskrit", "hi": "संस्कृत"}},
    {"value": "english", "label": {"en": "English", "hi": "अंग्रेज़ी"}}]}]
}' WHERE slug = 'other';

-- Two new kinds of service, hidden until an admin turns them on.
INSERT INTO categories (slug, name_en, name_hi, icon, default_unit, sort_order, is_active, booking_type, group_key, template) VALUES
  ('generator', 'Generator & AC', 'जनरेटर और एसी', 'other', 'per_day', 113, false, 'rental', 'wedding_services',
   '{"pricingModels": ["per_unit"], "rules": {"bufferAfterMin": 120, "leadTimeHours": 12}}'),
  ('guest-transport', 'Guest bus & transport', 'मेहमानों के लिए बस', 'car', 'per_day', 114, false, 'transport', 'transport',
   '{"resourceKind": "vehicle", "pricingModels": ["fixed", "daily", "per_trip"], "rules": {"minDurationMin": 120, "maxDurationMin": 10080, "bufferAfterMin": 60, "leadTimeHours": 24}}')
ON CONFLICT (slug) DO NOTHING;

COMMENT ON COLUMN categories.booking_type IS 'How new services in this category are booked (slot, time_window, rental, per_person, staffing, appointment, transport, quote)';
COMMENT ON COLUMN categories.template IS 'Vendor attributes, customer questions and default rules for this kind of service; checked by checkTemplate()';

-- migrate:down
DELETE FROM categories WHERE slug IN ('generator', 'guest-transport') AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.category_id = categories.id);
UPDATE categories SET booking_type = 'slot', group_key = 'other', template = '{}';
