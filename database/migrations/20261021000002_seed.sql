-- migrate:up
INSERT INTO cities (name, state) VALUES ('Prayagraj', 'Uttar Pradesh');

INSERT INTO categories (slug, name_en, name_hi, icon, default_unit, sort_order) VALUES
  ('hall',       'Marriage hall',      'मैरिज हॉल',        'hall',       'per_shift',      1),
  ('dj',         'DJ & sound',         'डीजे और साउंड',     'dj',         'per_event',      2),
  ('camera',     'Photo & video',      'फ़ोटो और वीडियो',    'camera',     'package',        3),
  ('halwai',     'Cook (halwai)',      'हलवाई',            'halwai',     'per_plate',      4),
  ('catering',   'Catering',           'कैटरिंग',           'catering',   'per_plate',      5),
  ('band',       'Band & dhol',        'बैंड और ढोल',       'band',       'per_event',      6),
  ('car',        'Car & travel',       'कार और ट्रैवल',      'car',        'per_day',        7),
  ('decor',      'Decoration & tent',  'सजावट और टेंट',     'decor',      'package',        8),
  ('hotel',      'Hotel rooms',        'होटल रूम',          'hotel',      'per_room_night', 9),
  ('bartender',  'Bartender & drinks', 'बारटेंडर और ड्रिंक्स', 'bartender',  'per_hour',       10),
  ('makeup',     'Makeup & mehendi',   'मेकअप और मेहंदी',    'makeup',     'per_person',     11),
  ('other',      'Pandit, anchor & more', 'पंडित, एंकर और अन्य', 'other',   'per_event',      12);

-- migrate:down
DELETE FROM categories;
DELETE FROM cities;
