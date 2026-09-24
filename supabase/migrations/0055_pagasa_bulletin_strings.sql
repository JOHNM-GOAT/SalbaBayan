-- The PAGASA tropical cyclone bulletin, read on the official dashboard.
--
-- Officials only, so these sit under dash.*. Nothing here reaches a resident's
-- screen: the bulletin fills in the advisory form, and what residents read is
-- still whatever an official confirmed.

insert into public.translations (message_key, language, text) values
  ('dash.bulletin', 'en', 'PAGASA BULLETIN'),
  ('dash.bulletin', 'tl', 'BULETIN NG PAGASA'),
  ('dash.bulletin', 'ceb', 'BULETIN SA PAGASA'),
  ('dash.bulletin', 'fil', 'BULETIN NG PAGASA'),
  ('dash.bulletin', 'ilo', 'BULETIN TI PAGASA'),

  ('dash.bulletin_none', 'en', 'No tropical cyclone inside the Philippine area of responsibility.'),
  ('dash.bulletin_none', 'tl', 'Walang bagyo sa loob ng Philippine area of responsibility.'),
  ('dash.bulletin_none', 'ceb', 'Walay bagyo sulod sa Philippine area of responsibility.'),
  ('dash.bulletin_none', 'fil', 'Walang bagyo sa loob ng Philippine area of responsibility.'),
  ('dash.bulletin_none', 'ilo', 'Awan ti bagyo iti uneg ti Philippine area of responsibility.'),

  ('dash.bulletin_unread', 'en', 'The bulletin could not be read. Open it at PAGASA.'),
  ('dash.bulletin_unread', 'tl', 'Hindi mabasa ang buletin. Buksan ito sa PAGASA.'),
  ('dash.bulletin_unread', 'ceb', 'Dili mabasa ang buletin. Ablihi kini sa PAGASA.'),
  ('dash.bulletin_unread', 'fil', 'Hindi mabasa ang buletin. Buksan ito sa PAGASA.'),
  ('dash.bulletin_unread', 'ilo', 'Saan a mabasa ti buletin. Luktan iti PAGASA.'),

  ('dash.bulletin_offline', 'en', 'PAGASA could not be reached.'),
  ('dash.bulletin_offline', 'tl', 'Hindi maabot ang PAGASA.'),
  ('dash.bulletin_offline', 'ceb', 'Dili maabot ang PAGASA.'),
  ('dash.bulletin_offline', 'fil', 'Hindi maabot ang PAGASA.'),
  ('dash.bulletin_offline', 'ilo', 'Saan a madanon ti PAGASA.'),

  ('dash.bulletin_open', 'en', 'OPEN AT PAGASA'),
  ('dash.bulletin_open', 'tl', 'BUKSAN SA PAGASA'),
  ('dash.bulletin_open', 'ceb', 'ABLIHI SA PAGASA'),
  ('dash.bulletin_open', 'fil', 'BUKSAN SA PAGASA'),
  ('dash.bulletin_open', 'ilo', 'LUKTAN ITI PAGASA'),

  ('dash.bulletin_use', 'en', 'USE THIS BULLETIN'),
  ('dash.bulletin_use', 'tl', 'GAMITIN ANG BULETIN'),
  ('dash.bulletin_use', 'ceb', 'GAMITA KINI NGA BULETIN'),
  ('dash.bulletin_use', 'fil', 'GAMITIN ANG BULETIN'),
  ('dash.bulletin_use', 'ilo', 'USAREN DAYTOY A BULETIN'),

  ('dash.bulletin_applied', 'en', 'ALREADY IN YOUR ADVISORY'),
  ('dash.bulletin_applied', 'tl', 'NASA ADVISORY NA'),
  ('dash.bulletin_applied', 'ceb', 'NAA NA SA ADVISORY'),
  ('dash.bulletin_applied', 'fil', 'NASA ADVISORY NA'),
  ('dash.bulletin_applied', 'ilo', 'ADDAN ITI ADVISORY'),

  ('dash.bulletin_here', 'en', 'WIND SIGNAL HERE'),
  ('dash.bulletin_here', 'tl', 'SIGNAL DITO'),
  ('dash.bulletin_here', 'ceb', 'SIGNAL DINHI'),
  ('dash.bulletin_here', 'fil', 'SIGNAL DITO'),
  ('dash.bulletin_here', 'ilo', 'SIGNAL DITOY'),

  ('dash.bulletin_partial', 'en', 'Only a part of the province is listed. Read the bulletin before you change the signal.'),
  ('dash.bulletin_partial', 'tl', 'Bahagi lang ng probinsya ang nakalista. Basahin ang buletin bago baguhin ang signal.'),
  ('dash.bulletin_partial', 'ceb', 'Bahin lang sa probinsya ang nalista. Basaha ang buletin sa dili pa usbon ang signal.'),
  ('dash.bulletin_partial', 'fil', 'Bahagi lang ng probinsya ang nakalista. Basahin ang buletin bago baguhin ang signal.'),
  ('dash.bulletin_partial', 'ilo', 'Paset laeng ti probinsia ti nakalista. Basaen ti buletin sakbay a sukatan ti signal.'),

  ('dash.bulletin_nohere', 'en', 'This barangay is under no wind signal in this bulletin.'),
  ('dash.bulletin_nohere', 'tl', 'Walang signal ang barangay na ito sa buletin.'),
  ('dash.bulletin_nohere', 'ceb', 'Walay signal kini nga barangay sa buletin.'),
  ('dash.bulletin_nohere', 'fil', 'Walang signal ang barangay na ito sa buletin.'),
  ('dash.bulletin_nohere', 'ilo', 'Awan ti signal daytoy a barangay iti buletin.'),

  ('dash.bulletin_read', 'en', 'READ'),
  ('dash.bulletin_read', 'tl', 'NABASA'),
  ('dash.bulletin_read', 'ceb', 'NABASA'),
  ('dash.bulletin_read', 'fil', 'NABASA'),
  ('dash.bulletin_read', 'ilo', 'NABASA'),

  ('dash.bulletin_refresh', 'en', 'Read again'),
  ('dash.bulletin_refresh', 'tl', 'Basahin muli'),
  ('dash.bulletin_refresh', 'ceb', 'Basaha pag-usab'),
  ('dash.bulletin_refresh', 'fil', 'Basahin muli'),
  ('dash.bulletin_refresh', 'ilo', 'Basaen manen'),

  ('dash.bulletin_issued', 'en', 'ISSUED'),
  ('dash.bulletin_issued', 'tl', 'INILABAS'),
  ('dash.bulletin_issued', 'ceb', 'GIPAGAWAS'),
  ('dash.bulletin_issued', 'fil', 'INILABAS'),
  ('dash.bulletin_issued', 'ilo', 'NAIRUAR'),

  ('dash.bulletin_gusts', 'en', 'GUSTS'),
  ('dash.bulletin_gusts', 'tl', 'PAGBUGSO'),
  ('dash.bulletin_gusts', 'ceb', 'HUYOP'),
  ('dash.bulletin_gusts', 'fil', 'PAGBUGSO'),
  ('dash.bulletin_gusts', 'ilo', 'PUYUPOY'),

  ('dash.bulletin_areas', 'en', 'AREAS LISTED'),
  ('dash.bulletin_areas', 'tl', 'MGA LUGAR NA NAKALISTA'),
  ('dash.bulletin_areas', 'ceb', 'MGA DAPIT NGA NALISTA'),
  ('dash.bulletin_areas', 'fil', 'MGA LUGAR NA NAKALISTA'),
  ('dash.bulletin_areas', 'ilo', 'DAGITI LUGAR A NAKALISTA'),

  ('dash.from_bulletin', 'en', 'Filled in from PAGASA bulletin no. {n}. Check every field before you confirm.'),
  ('dash.from_bulletin', 'tl', 'Mula sa buletin blg. {n} ng PAGASA. Suriin ang bawat patlang bago kumpirmahin.'),
  ('dash.from_bulletin', 'ceb', 'Gikan sa buletin nr. {n} sa PAGASA. Susiha ang matag natad sa dili pa mokumpirma.'),
  ('dash.from_bulletin', 'fil', 'Mula sa buletin blg. {n} ng PAGASA. Suriin ang bawat patlang bago kumpirmahin.'),
  ('dash.from_bulletin', 'ilo', 'Naggapu iti buletin nu. {n} ti PAGASA. Kitaen ti tunggal patlang sakbay a mangpasingked.')
on conflict (message_key, language) do update set text = excluded.text;
