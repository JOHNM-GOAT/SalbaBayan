-- The one string the loading placeholders need.
--
-- Placeholder blocks are `aria-hidden`, so without this a screen reader reaches
-- a region marked `aria-busy` and finds nothing at all inside it to announce —
-- which is indistinguishable from an empty screen, and empty is the one thing
-- these placeholders exist to stop the app from claiming prematurely.
--
-- Worded as a statement about the device rather than as a bare "Loading...",
-- because on this product the distinction carries weight: the app is reading
-- what it already has before it is reading anything from the network, and after
-- three seconds it stops saying this and says what it actually knows instead.

insert into public.translations (message_key, language, text) values
  ('ui.loading', 'en', 'Checking for updates'),
  ('ui.loading', 'tl', 'Tinitingnan ang mga bago'),
  ('ui.loading', 'ceb', 'Gisusi ang mga bag-o')
on conflict (message_key, language) do update set text = excluded.text;
