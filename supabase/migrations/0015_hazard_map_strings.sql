-- Hazard map and report status strings (FR-3.1, FR-7.2, FR-7.3).
--
-- The first statement here is a bug fix, not a new feature.
--
-- `hazard.resolve` read "Resolved" / "Ayos na" and was the label on the BUTTON
-- under every report in the feed. So a resident filed a report, watched it
-- appear, and saw a green tick reading RESOLVED directly beneath it — and
-- reasonably concluded the app was closing reports the moment they were filed.
-- Nothing in the data ever said that: the row is written `status = 'open'`, the
-- column defaults to 'open', and the feed only ever queried open rows. The
-- screen was naming a state where it should have been naming an action.
--
-- The rest are for the hazard map that now hangs off the tab bar on every
-- screen, and for saying "unresolved" out loud rather than leaving it implied.

insert into public.translations (message_key, language, text) values
  -- The fix: a control is named for what it does.
  ('hazard.resolve', 'en', 'Mark as fixed'),
  ('hazard.resolve', 'tl', 'Markahang ayos na'),
  ('hazard.resolve', 'ceb', 'Markahi nga ayos na'),

  ('hazard.unresolved', 'en', 'UNRESOLVED'),
  ('hazard.unresolved', 'tl', 'HINDI PA AYOS'),
  ('hazard.unresolved', 'ceb', 'WALA PA MAAYO'),

  ('hz.title', 'en', 'HAZARD MAP'),
  ('hz.title', 'tl', 'MAPA NG PANGANIB'),
  ('hz.title', 'ceb', 'MAPA SA PELIGRO'),

  ('hz.count', 'en', '{n} UNRESOLVED'),
  ('hz.count', 'tl', '{n} HINDI PA AYOS'),
  ('hz.count', 'ceb', '{n} WALA PA MAAYO'),

  -- "None reported" and not "all clear". The barangay having filed nothing is
  -- not the same as the barangay being safe, and this sits on every screen.
  ('hz.clear', 'en', 'NONE REPORTED'),
  ('hz.clear', 'tl', 'WALANG INIULAT'),
  ('hz.clear', 'ceb', 'WALAY GITAHO'),

  ('hz.none', 'en', 'No hazards reported right now.'),
  ('hz.none', 'tl', 'Walang iniulat na panganib ngayon.'),
  ('hz.none', 'ceb', 'Walay gitaho nga peligro karon.'),

  ('hz.tap', 'en', 'TAP A PIN FOR DETAILS'),
  ('hz.tap', 'tl', 'PINDUTIN ANG PIN PARA SA DETALYE'),
  ('hz.tap', 'ceb', 'PINDUTA ANG PIN PARA SA DETALYE'),

  ('hz.close', 'en', 'Close'),
  ('hz.close', 'tl', 'Isara'),
  ('hz.close', 'ceb', 'Sirad-i'),

  ('hz.where', 'en', 'EXACT LOCATION'),
  ('hz.where', 'tl', 'TIYAK NA LOKASYON'),
  ('hz.where', 'ceb', 'TUKMA NGA LOKASYON'),

  -- A report with no GPS fix is counted, never dropped: the same rule the
  -- rescue queue follows. It cannot be pinned, but it still happened.
  ('hz.no_fix', 'en', '{n} report(s) with no GPS fix'),
  ('hz.no_fix', 'tl', '{n} ulat na walang GPS'),
  ('hz.no_fix', 'ceb', '{n} taho nga walay GPS'),

  -- Said, not hidden. A resident who cannot resolve a report needs to know the
  -- rule, or a missing button reads as the app being broken.
  ('hz.only_volunteer', 'en', 'Only a volunteer can mark this one fixed.'),
  ('hz.only_volunteer', 'tl', 'Boluntaryo lang ang puwedeng magmarka nito na ayos na.'),
  ('hz.only_volunteer', 'ceb', 'Boluntaryo ra ang makamarka niini nga ayos na.')
on conflict (message_key, language) do update set text = excluded.text;
