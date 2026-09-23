-- The light / dark switch in the header, beside the language switch.

insert into public.translations (message_key, language, text) values
  ('ui.theme_dark', 'en', 'Dark mode'),
  ('ui.theme_dark', 'tl', 'Madilim na mode'),
  ('ui.theme_dark', 'ceb', 'Ngitngit nga mode'),
  ('ui.theme_dark', 'fil', 'Madilim na mode'),
  ('ui.theme_dark', 'ilo', 'Nasipnget a mode'),

  ('ui.theme_light', 'en', 'Light mode'),
  ('ui.theme_light', 'tl', 'Maliwanag na mode'),
  ('ui.theme_light', 'ceb', 'Hayag nga mode'),
  ('ui.theme_light', 'fil', 'Maliwanag na mode'),
  ('ui.theme_light', 'ilo', 'Nalawag a mode')
on conflict (message_key, language) do update set text = excluded.text;
