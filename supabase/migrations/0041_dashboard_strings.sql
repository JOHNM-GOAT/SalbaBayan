-- The official's map dashboard (src/app/official). Officials-only screen:
-- reviewed languages, Filipino (= Tagalog) and Ilocano; the other
-- machine-translated languages fall back to Tagalog (dash.* is optional in
-- scripts/generate-translations.mjs).

insert into public.translations (message_key, language, text) values
  ('dash.show_all', 'en', 'SHOW ALL'),
  ('dash.show_all', 'tl', 'IPAKITA LAHAT'),
  ('dash.show_all', 'ceb', 'IPAKITA TANAN'),
  ('dash.show_all', 'fil', 'IPAKITA LAHAT'),
  ('dash.show_all', 'ilo', 'IPAKITA AMIN'),

  ('dash.tab_sos', 'en', 'SOS'),
  ('dash.tab_sos', 'tl', 'SOS'),
  ('dash.tab_sos', 'ceb', 'SOS'),
  ('dash.tab_sos', 'fil', 'SOS'),
  ('dash.tab_sos', 'ilo', 'SOS'),

  ('dash.tab_hazards', 'en', 'HAZARDS'),
  ('dash.tab_hazards', 'tl', 'PANGANIB'),
  ('dash.tab_hazards', 'ceb', 'PELIGRO'),
  ('dash.tab_hazards', 'fil', 'PANGANIB'),
  ('dash.tab_hazards', 'ilo', 'PELIGRO'),

  ('dash.tab_water', 'en', 'WATER'),
  ('dash.tab_water', 'tl', 'TUBIG'),
  ('dash.tab_water', 'ceb', 'TUBIG'),
  ('dash.tab_water', 'fil', 'TUBIG'),
  ('dash.tab_water', 'ilo', 'DANUM'),

  ('dash.tab_barangay', 'en', 'BARANGAY'),
  ('dash.tab_barangay', 'tl', 'BARANGAY'),
  ('dash.tab_barangay', 'ceb', 'BARANGAY'),
  ('dash.tab_barangay', 'fil', 'BARANGAY'),
  ('dash.tab_barangay', 'ilo', 'BARANGAY'),

  ('dash.open_sos', 'en', 'OPEN SOS'),
  ('dash.open_sos', 'tl', 'BUKAS NA SOS'),
  ('dash.open_sos', 'ceb', 'ABLI NGA SOS'),
  ('dash.open_sos', 'fil', 'BUKAS NA SOS'),
  ('dash.open_sos', 'ilo', 'NAKALUKAT A SOS'),

  ('dash.open_hazards', 'en', 'OPEN HAZARDS'),
  ('dash.open_hazards', 'tl', 'BUKAS NA PANGANIB'),
  ('dash.open_hazards', 'ceb', 'ABLI NGA PELIGRO'),
  ('dash.open_hazards', 'fil', 'BUKAS NA PANGANIB'),
  ('dash.open_hazards', 'ilo', 'NAKALUKAT A PELIGRO'),

  ('dash.water_reports', 'en', 'WATER REPORTS'),
  ('dash.water_reports', 'tl', 'ULAT SA TUBIG'),
  ('dash.water_reports', 'ceb', 'REPORT SA TUBIG'),
  ('dash.water_reports', 'fil', 'ULAT SA TUBIG'),
  ('dash.water_reports', 'ilo', 'REPORT ITI DANUM'),

  ('dash.none', 'en', 'Nothing here right now.'),
  ('dash.none', 'tl', 'Wala rito ngayon.'),
  ('dash.none', 'ceb', 'Wala dinhi karon.'),
  ('dash.none', 'fil', 'Wala rito ngayon.'),
  ('dash.none', 'ilo', 'Awan pay ditoy ita.'),

  ('dash.area_only', 'en', 'AREA ONLY — NO EXACT GPS'),
  ('dash.area_only', 'tl', 'LUGAR LANG — WALANG EKSAKTONG GPS'),
  ('dash.area_only', 'ceb', 'LUGAR LANG — WALAY EKSAKTONG GPS'),
  ('dash.area_only', 'fil', 'LUGAR LANG — WALANG EKSAKTONG GPS'),
  ('dash.area_only', 'ilo', 'LUGAR LAENG — AWAN TI EKSAKTO A GPS'),

  ('dash.who', 'en', 'WHO'),
  ('dash.who', 'tl', 'SINO'),
  ('dash.who', 'ceb', 'KINSA'),
  ('dash.who', 'fil', 'SINO'),
  ('dash.who', 'ilo', 'SINNO'),

  ('dash.reported', 'en', 'REPORTED'),
  ('dash.reported', 'tl', 'INIULAT'),
  ('dash.reported', 'ceb', 'GI-REPORT'),
  ('dash.reported', 'fil', 'INIULAT'),
  ('dash.reported', 'ilo', 'NAI-REPORT'),

  ('dash.notes', 'en', 'NOTE'),
  ('dash.notes', 'tl', 'TALA'),
  ('dash.notes', 'ceb', 'NOTA'),
  ('dash.notes', 'fil', 'TALA'),
  ('dash.notes', 'ilo', 'NOTA'),

  ('dash.location', 'en', 'LOCATION'),
  ('dash.location', 'tl', 'LOKASYON'),
  ('dash.location', 'ceb', 'LOKASYON'),
  ('dash.location', 'fil', 'LOKASYON'),
  ('dash.location', 'ilo', 'LUGAR'),

  ('dash.accuracy', 'en', 'GPS ACCURACY'),
  ('dash.accuracy', 'tl', 'KATUMPAKAN NG GPS'),
  ('dash.accuracy', 'ceb', 'KATUKMAAN SA GPS'),
  ('dash.accuracy', 'fil', 'KATUMPAKAN NG GPS'),
  ('dash.accuracy', 'ilo', 'KAUSTUAN TI GPS'),

  ('dash.raised', 'en', 'RAISED'),
  ('dash.raised', 'tl', 'IPINADALA'),
  ('dash.raised', 'ceb', 'GIPADALA'),
  ('dash.raised', 'fil', 'IPINADALA'),
  ('dash.raised', 'ilo', 'NAIPATULOD'),

  ('dash.directions', 'en', 'DIRECTIONS IN GOOGLE MAPS'),
  ('dash.directions', 'tl', 'DIREKSYON SA GOOGLE MAPS'),
  ('dash.directions', 'ceb', 'DIREKSYON SA GOOGLE MAPS'),
  ('dash.directions', 'fil', 'DIREKSYON SA GOOGLE MAPS'),
  ('dash.directions', 'ilo', 'DIREKSION ITI GOOGLE MAPS'),

  ('dash.directions_note', 'en', 'Google Maps receives the location only — never the person''s name.'),
  ('dash.directions_note', 'tl', 'Lokasyon lang ang natatanggap ng Google Maps — hindi kailanman ang pangalan.'),
  ('dash.directions_note', 'ceb', 'Lokasyon lang ang madawat sa Google Maps — dili gayud ang ngalan.'),
  ('dash.directions_note', 'fil', 'Lokasyon lang ang natatanggap ng Google Maps — hindi kailanman ang pangalan.'),
  ('dash.directions_note', 'ilo', 'Lugar laeng ti maawat ti Google Maps — saan a pulos ti nagan.')
on conflict (message_key, language) do update set text = excluded.text;
