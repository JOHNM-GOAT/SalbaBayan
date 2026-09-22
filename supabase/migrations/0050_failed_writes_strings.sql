-- The FAILED TO SEND list (SyncStrip / FailedWrites): what did not send, and
-- TRY AGAIN or DISCARD. sync.* falls back to Tagalog in the other
-- machine-translated languages.

insert into public.translations (message_key, language, text) values
  ('sync.failed_title', 'en', 'NOT SENT'),
  ('sync.failed_title', 'tl', 'HINDI NAIPADALA'),
  ('sync.failed_title', 'ceb', 'WALA MAPADALA'),
  ('sync.failed_title', 'fil', 'HINDI NAIPADALA'),
  ('sync.failed_title', 'ilo', 'SAAN A NAIPATULOD'),

  ('sync.failed_hint', 'en', 'These were refused and will not be sent on their own. Try again, or discard any you no longer need.'),
  ('sync.failed_hint', 'tl', 'Tinanggihan ang mga ito at hindi kusang maipapadala. Subukang muli, o itapon ang hindi na kailangan.'),
  ('sync.failed_hint', 'ceb', 'Gisalikway kini ug dili kusang mapadala. Sulayi pag-usab, o ilabay ang dili na kinahanglan.'),
  ('sync.failed_hint', 'fil', 'Tinanggihan ang mga ito at hindi kusang maipapadala. Subukang muli, o itapon ang hindi na kailangan.'),
  ('sync.failed_hint', 'ilo', 'Naliklikan dagitoy ket saanda a kusa a maipatulod. Padasen manen, wenno ibelleng ti saan a kasapulan.'),

  ('sync.retry', 'en', 'TRY AGAIN'),
  ('sync.retry', 'tl', 'SUBUKANG MULI'),
  ('sync.retry', 'ceb', 'SULAYI PAG-USAB'),
  ('sync.retry', 'fil', 'SUBUKANG MULI'),
  ('sync.retry', 'ilo', 'PADASEN MANEN'),

  ('sync.hold_discard', 'en', 'Press and hold to discard'),
  ('sync.hold_discard', 'tl', 'Pindutin nang matagal para itapon'),
  ('sync.hold_discard', 'ceb', 'Pindota ug dugay aron ilabay'),
  ('sync.hold_discard', 'fil', 'Pindutin nang matagal para itapon'),
  ('sync.hold_discard', 'ilo', 'Ipindot a nabayag tapno maibelleng'),

  ('sync.other', 'en', 'Other change'),
  ('sync.other', 'tl', 'Ibang pagbabago'),
  ('sync.other', 'ceb', 'Laing kausaban'),
  ('sync.other', 'fil', 'Ibang pagbabago'),
  ('sync.other', 'ilo', 'Sabali a panagbaliw')
on conflict (message_key, language) do update set text = excluded.text;
