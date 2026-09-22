-- "Use my current location" on the report screen: optional, off by default,
-- because a report is often filed from somewhere other than the place it is
-- about. loc.* falls back to Tagalog in the other machine-translated languages.

insert into public.translations (message_key, language, text) values
  ('loc.use_mine', 'en', 'Use my current location'),
  ('loc.use_mine', 'tl', 'Gamitin ang kinaroroonan ko ngayon'),
  ('loc.use_mine', 'ceb', 'Gamita ang akong nahimutangan karon'),
  ('loc.use_mine', 'fil', 'Gamitin ang kinaroroonan ko ngayon'),
  ('loc.use_mine', 'ilo', 'Usaren ti ayanko ita'),

  ('loc.use_hint', 'en', 'Tick only if you are at the place you are reporting. Otherwise the report is placed on the street.'),
  ('loc.use_hint', 'tl', 'Lagyan lang ng tsek kung nasa lugar ka mismo ng inuulat mo. Kung hindi, ilalagay ang ulat sa kalye.'),
  ('loc.use_hint', 'ceb', 'I-tsek lang kon anaa ka mismo sa dapit nga imong gi-report. Kon dili, ibutang ang report sa dalan.'),
  ('loc.use_hint', 'fil', 'Lagyan lang ng tsek kung nasa lugar ka mismo ng inuulat mo. Kung hindi, ilalagay ang ulat sa kalye.'),
  ('loc.use_hint', 'ilo', 'I-tsek laeng no adda ka mismo iti lugar nga ireport-mo. No saan, maikabil ti report iti kalsada.')
on conflict (message_key, language) do update set text = excluded.text;
