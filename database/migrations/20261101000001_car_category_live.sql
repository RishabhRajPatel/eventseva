-- migrate:up
-- The owner turned on wedding cars (dulha-dulhan car, with driver or self-drive): the "car" category is
-- shown to customers after the seven launch categories. Vendors' cars and drivers still need EventSeva's
-- document check before they can be booked. An admin can hide it again from the Categories page.
UPDATE categories SET is_active = true, sort_order = (SELECT COALESCE(max(sort_order), 0) + 1 FROM categories WHERE is_active)
 WHERE slug = 'car' AND NOT is_active;
-- Same capitalisation as the other names in the list.
UPDATE categories SET name_en = 'Cars & Travel' WHERE slug = 'car' AND name_en = 'Car & travel';

-- migrate:down
UPDATE categories SET is_active = false, sort_order = 107, name_en = 'Car & travel' WHERE slug = 'car';
