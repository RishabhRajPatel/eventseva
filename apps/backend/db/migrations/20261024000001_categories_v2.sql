-- migrate:up
-- The owner's service list. Categories no longer offered are hidden, not deleted: old vendors and
-- bookings keep pointing at them, and an admin can switch them back on from the panel.
UPDATE categories SET is_active = false, sort_order = 100 + sort_order
 WHERE slug IN ('hall', 'halwai', 'band', 'car', 'hotel', 'bartender', 'makeup', 'other');

UPDATE categories SET name_en = 'DJ & Sound', name_hi = 'डीजे और साउंड', sort_order = 1 WHERE slug = 'dj';
UPDATE categories SET name_en = 'Lighting & Decoration', name_hi = 'लाइटिंग और सजावट', sort_order = 2 WHERE slug = 'decor';
UPDATE categories SET name_en = 'Cook & Catering', name_hi = 'हलवाई और कैटरिंग', sort_order = 3 WHERE slug = 'catering';
UPDATE categories SET name_en = 'Photography & Entertainment', name_hi = 'फ़ोटोग्राफ़ी और मनोरंजन', sort_order = 7 WHERE slug = 'camera';

INSERT INTO categories (slug, name_en, name_hi, icon, default_unit, sort_order) VALUES
  ('bartan',  'Bartan & Kitchen Equipment', 'बर्तन और किचन का सामान', 'bartan',  'per_day',   4),
  ('tent',    'Tent & Furniture',           'टेंट और फ़र्नीचर',         'tent',    'per_day',   5),
  ('planner', 'Wedding & Event Planners',   'वेडिंग और इवेंट प्लानर',    'planner', 'package',   6);

-- Halwai vendors now belong under Cook & Catering.
UPDATE vendors SET category_id = (SELECT id FROM categories WHERE slug = 'catering')
 WHERE category_id = (SELECT id FROM categories WHERE slug = 'halwai');

-- migrate:down
DELETE FROM categories WHERE slug IN ('bartan', 'tent', 'planner') AND NOT EXISTS (
  SELECT 1 FROM vendors v WHERE v.category_id = categories.id);
UPDATE categories SET is_active = true WHERE slug IN ('hall', 'halwai', 'band', 'car', 'hotel', 'bartender', 'makeup', 'other');
UPDATE categories SET sort_order = sort_order - 100 WHERE sort_order > 100;
UPDATE categories SET name_en = 'DJ & sound', name_hi = 'डीजे और साउंड', sort_order = 2 WHERE slug = 'dj';
UPDATE categories SET name_en = 'Decoration & tent', name_hi = 'सजावट और टेंट', sort_order = 8 WHERE slug = 'decor';
UPDATE categories SET name_en = 'Catering', name_hi = 'कैटरिंग', sort_order = 5 WHERE slug = 'catering';
UPDATE categories SET name_en = 'Photo & video', name_hi = 'फ़ोटो और वीडियो', sort_order = 3 WHERE slug = 'camera';
