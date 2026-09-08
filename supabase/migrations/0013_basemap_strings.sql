-- Names for the two base maps the evacuation view can draw on (FR-3.1).
--
-- `/map` builds on a schematic drawn from the synthetic street grid, and
-- upgrades to the real OpenStreetMap basemap when there is a signal. The two
-- look similar enough at a glance to be mistaken for one another, and a
-- resident deciding which corner to turn at should not have to guess which one
-- is under the route. So the map says which it is, in the resident's language.
--
-- "Krokis" for the sketch: the everyday Filipino word for a hand-drawn location
-- map, borrowed from Spanish `croquis` and understood in both Tagalog and
-- Cebuano. It carries the right implication — approximate, drawn to explain a
-- route, not surveyed.

insert into public.translations (message_key, language, text) values
  ('map.base_streets', 'en', 'STREET MAP'),
  ('map.base_streets', 'tl', 'MAPA NG KALSADA'),
  ('map.base_streets', 'ceb', 'MAPA SA DALAN'),
  ('map.base_sketch', 'en', 'SKETCH MAP'),
  ('map.base_sketch', 'tl', 'KROKIS'),
  ('map.base_sketch', 'ceb', 'KROKIS')
on conflict (message_key, language) do update set text = excluded.text;
