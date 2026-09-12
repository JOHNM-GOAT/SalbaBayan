-- Strings for the resolved/unresolved filter on the report feed (FR-7.2).
--
-- `hazard.pending` is the one worth explaining. A report can read as fixed
-- because of a write still sitting in this device's queue, which is not the
-- same as the barangay having been told — and on the screen where a volunteer
-- marks roads clear, that difference is the whole point. It follows the same
-- rule as the sync strip: a local intention must never be allowed to look like
-- a fact other people can see.

insert into public.translations (message_key, language, text) values
  ('hazard.resolved', 'en', 'FIXED'),
  ('hazard.resolved', 'tl', 'AYOS NA'),
  ('hazard.resolved', 'ceb', 'AYOS NA'),

  ('hazard.none_resolved', 'en', 'Nothing has been marked fixed yet.'),
  ('hazard.none_resolved', 'tl', 'Wala pang namarkahang ayos na.'),
  ('hazard.none_resolved', 'ceb', 'Wala pay namarkahan nga ayos na.'),

  ('hazard.pending', 'en', 'NOT SENT YET'),
  ('hazard.pending', 'tl', 'HINDI PA NAIPAPADALA'),
  ('hazard.pending', 'ceb', 'WALA PA MAIPADALA')
on conflict (message_key, language) do update set text = excluded.text;
