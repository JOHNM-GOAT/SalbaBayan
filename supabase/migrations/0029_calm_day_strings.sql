-- The home card when no signal is up.
--
-- Signal 0 has no protocol, and never had one; the card used to treat that as a
-- coverage gap and told every resident, on an ordinary day, that guidance was
-- missing. It now shows the way to the evacuation centre instead, while there
-- is time to learn it (src/components/ActionCard.tsx).
--
-- Additive only. Native-speaker review of the Tagalog and Cebuano is still
-- pending, like the rest (docs/HANDOFF-callaguip.md).

insert into public.translations (message_key, language, text) values
  ('ui.calm_title', 'en', 'KNOW YOUR WAY TO SAFETY'),
  ('ui.calm_title', 'tl', 'ALAMIN ANG DAAN PATUNGONG LIGTAS'),
  ('ui.calm_title', 'ceb', 'SAYRA ANG DALAN PADULONG LUWAS'),

  ('ui.calm_body', 'en', 'No signal is up. Walk this route once now, so you know it if you ever need to evacuate.'),
  ('ui.calm_body', 'tl', 'Walang signal ngayon. Lakarin minsan ang rutang ito ngayon, para kabisado mo kung kailangan mong lumikas.'),
  ('ui.calm_body', 'ceb', 'Walay signal karon. Lakawa kausa kining rutaha karon, aron kabalo ka kung kinahanglan kang mobakwit.')
on conflict (message_key, language) do update set text = excluded.text;
