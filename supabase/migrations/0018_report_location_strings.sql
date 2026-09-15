-- Strings for the location readout on the report screen (FR-7.3).
--
-- These exist because the failure they describe was silent. `submitHazard`
-- stamps the report with whatever `currentFix()` holds, and until now nothing
-- on the report screen started a position watch — so every hazard filed through
-- the app went in with lat/lng NULL, the hazard map filtered them all out, and
-- the sheet correctly reported an empty barangay. Nobody was told anything was
-- wrong, because from the reporter's side nothing looked wrong.
--
-- A line that says whether this report is going to carry a location is what
-- makes that visible the next time it breaks. It also tells a resident
-- something they are entitled to know before they tap: that the pin the
-- barangay will see is either their actual spot, or their Purok and no more.
--
-- `hazard.gps_wait` is not an error. A cold fix indoors takes time, and the
-- report is never held up waiting for one.

insert into public.translations (message_key, language, text) values
  ('hazard.gps_on', 'en', 'LOCATION ATTACHED — SHOWS ON THE HAZARD MAP'),
  ('hazard.gps_on', 'tl', 'MAY LOKASYON — MAKIKITA SA MAPA NG PANGANIB'),
  ('hazard.gps_on', 'ceb', 'NAAY LOKASYON — MAKITA SA MAPA SA PELIGRO'),

  ('hazard.gps_wait', 'en', 'FINDING YOUR LOCATION — YOU CAN STILL SEND NOW'),
  ('hazard.gps_wait', 'tl', 'HINAHANAP ANG LOKASYON — PWEDE NANG IPADALA'),
  ('hazard.gps_wait', 'ceb', 'GIPANGITA ANG LOKASYON — PWEDE NA IPADALA'),

  ('hazard.gps_off', 'en', 'NO GPS — THE REPORT WILL SHOW YOUR PUROK ONLY'),
  ('hazard.gps_off', 'tl', 'WALANG GPS — PUROK LANG ANG MAKIKITA SA ULAT'),
  ('hazard.gps_off', 'ceb', 'WALAY GPS — PUROK RA ANG MAKITA SA REPORT')
on conflict (message_key, language) do update set text = excluded.text;
