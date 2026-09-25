-- The FIXED tab on the official dashboard: hazards marked fixed, and flood
-- readings an official has cleared.
--
-- Two words rather than one, because they are two different claims. A hazard
-- was FIXED by somebody — a tree cut up, a road opened. Water was CLEARED from
-- the map because it went down, which nobody did.

insert into public.translations (message_key, language, text) values
  ('dash.tab_fixed', 'en', 'FIXED'),
  ('dash.tab_fixed', 'tl', 'AYOS NA'),
  ('dash.tab_fixed', 'ceb', 'AYO NA'),
  ('dash.tab_fixed', 'fil', 'AYOS NA'),
  ('dash.tab_fixed', 'ilo', 'NALPASEN'),

  ('dash.cleared', 'en', 'CLEARED'),
  ('dash.cleared', 'tl', 'HUMUPA NA'),
  ('dash.cleared', 'ceb', 'NIHUBAS NA'),
  ('dash.cleared', 'fil', 'HUMUPA NA'),
  ('dash.cleared', 'ilo', 'NAIBBATEN')
on conflict (message_key, language) do update set text = excluded.text;
