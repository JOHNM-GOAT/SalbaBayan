-- Water readings are no longer hidden once they age; they are drawn faded and
-- say how old they are. This is the line under the age on the card.

insert into public.translations (message_key, language, text) values
  ('loc.water_old', 'en', 'Older reading — the water may have changed since.'),
  ('loc.water_old', 'tl', 'Lumang ulat — maaaring nagbago na ang tubig.'),
  ('loc.water_old', 'ceb', 'Daan nga report — mahimong nausab na ang tubig.'),
  ('loc.water_old', 'fil', 'Lumang ulat — maaaring nagbago na ang tubig.'),
  ('loc.water_old', 'ilo', 'Daan a report — mabalin a nagbaliw metten ti danum.')
on conflict (message_key, language) do update set text = excluded.text;
