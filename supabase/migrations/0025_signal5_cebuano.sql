-- Cebuano for the Signal 5 instruction (FR-3.4, FR-3.5).
--
-- `headline.stay_inside` and `action.stay_inside` had English and Tagalog but
-- no Cebuano. They were left that way on purpose, early on, so the language
-- fallback and the readiness dashboard's "translations: partial" had something
-- real to show. That stopped being harmless when 0024 gave every Purok a
-- Signal 5 instruction: a Cebuano speaker opening the app at the most severe
-- signal would have been shown the Tagalog fallback, at exactly the moment the
-- instruction has to be understood first time.
--
-- Worded to match the existing Tagalog, and the app's other Cebuano strings
-- ("Pislita og dugay…", "evacuation center" kept as residents say it). A native
-- speaker should review it before a real barangay relies on it — the same
-- caveat as every Cebuano string added in this repository.

insert into public.translations (message_key, language, text) values
  ('headline.stay_inside', 'ceb', 'PABILIN SA SULOD'),
  ('action.stay_inside', 'ceb', 'Ayaw gawas. Kinahanglan naa na ka sa evacuation center.')
on conflict (message_key, language) do update set text = excluded.text;
