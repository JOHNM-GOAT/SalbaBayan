-- /lgu now has a single box: 4 digits are the official PIN, anything else is
-- tried as the access code (which is always 8+ characters, 0042).

insert into public.translations (message_key, language, text) values
  ('acc.pin_or_code', 'en', 'PIN OR ACCESS CODE'),
  ('acc.pin_or_code', 'tl', 'PIN O ACCESS CODE'),
  ('acc.pin_or_code', 'ceb', 'PIN O ACCESS CODE'),
  ('acc.pin_or_code', 'fil', 'PIN O ACCESS CODE'),
  ('acc.pin_or_code', 'ilo', 'PIN WENNO ACCESS CODE')
on conflict (message_key, language) do update set text = excluded.text;
