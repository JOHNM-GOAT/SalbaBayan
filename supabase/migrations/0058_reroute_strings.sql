-- The map reroutes round hazards and deep water, and says which happened.
--
-- Two states, and they are never both true: either the walk shown keeps clear
-- of everything reported, or there is no way round and it does not. A resident
-- who is being sent the long way deserves to know that is what this is —
-- a detour nobody explains is a detour people cut back across.

insert into public.translations (message_key, language, text) values
  ('map.rerouted', 'en', 'This route goes round the hazards reported'),
  ('map.rerouted', 'tl', 'Umiiwas ang rutang ito sa mga naiulat na panganib'),
  ('map.rerouted', 'ceb', 'Kini nga ruta naglikay sa mga gitaho nga peligro'),
  ('map.rerouted', 'fil', 'Umiiwas ang rutang ito sa mga naiulat na panganib'),
  ('map.rerouted', 'ilo', 'Liklikan daytoy a ruta dagiti naipadamag a peggad'),

  ('map.no_way_round', 'en', 'NO WAY ROUND'),
  ('map.no_way_round', 'tl', 'WALANG IKUTAN'),
  ('map.no_way_round', 'ceb', 'WALAY LIKUAN'),
  ('map.no_way_round', 'fil', 'WALANG IKUTAN'),
  ('map.no_way_round', 'ilo', 'AWAN TI LIKLIKAN')
on conflict (message_key, language) do update set text = excluded.text;
