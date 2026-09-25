-- The control that puts the whole barangay back on the screen, on every map.

insert into public.translations (message_key, language, text) values
  ('map.show_barangay', 'en', 'Show the barangay'),
  ('map.show_barangay', 'tl', 'Ipakita ang barangay'),
  ('map.show_barangay', 'ceb', 'Ipakita ang barangay'),
  ('map.show_barangay', 'fil', 'Ipakita ang barangay'),
  ('map.show_barangay', 'ilo', 'Ipakita ti barangay')
on conflict (message_key, language) do update set text = excluded.text;
