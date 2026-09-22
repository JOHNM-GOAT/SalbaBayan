-- The official's pin menu (0047): the hazard choices, and the press-and-hold
-- labels of the centre form. dash.* falls back to Tagalog in the other
-- machine-translated languages.

insert into public.translations (message_key, language, text) values
  ('dash.h_fallen_tree', 'en', 'FALLEN TREE'),
  ('dash.h_fallen_tree', 'tl', 'NATUMBANG PUNO'),
  ('dash.h_fallen_tree', 'ceb', 'NATUMBA NGA KAHOY'),
  ('dash.h_fallen_tree', 'fil', 'NATUMBANG PUNO'),
  ('dash.h_fallen_tree', 'ilo', 'NATUMBA A KAYO'),

  ('dash.h_blocked_road', 'en', 'ROAD BLOCKAGE'),
  ('dash.h_blocked_road', 'tl', 'SARADONG DAAN'),
  ('dash.h_blocked_road', 'ceb', 'NABABAG NGA DALAN'),
  ('dash.h_blocked_road', 'fil', 'SARADONG DAAN'),
  ('dash.h_blocked_road', 'ilo', 'NALAPDAN A KALSADA'),

  ('dash.h_downed_lines', 'en', 'POWER FAILURE'),
  ('dash.h_downed_lines', 'tl', 'WALANG KURYENTE'),
  ('dash.h_downed_lines', 'ceb', 'WALAY KURYENTE'),
  ('dash.h_downed_lines', 'fil', 'WALANG KURYENTE'),
  ('dash.h_downed_lines', 'ilo', 'AWAN TI KORYENTE'),

  ('dash.h_other', 'en', 'OTHER HAZARD'),
  ('dash.h_other', 'tl', 'IBANG PANGANIB'),
  ('dash.h_other', 'ceb', 'UBANG PELIGRO'),
  ('dash.h_other', 'fil', 'IBANG PANGANIB'),
  ('dash.h_other', 'ilo', 'SABALI A PELIGRO'),

  ('dash.hold_add', 'en', 'Press and hold to add this evacuation centre'),
  ('dash.hold_add', 'tl', 'Pindutin nang matagal para idagdag ang evacuation center'),
  ('dash.hold_add', 'ceb', 'Pindota ug dugay aron idugang ang evacuation center'),
  ('dash.hold_add', 'fil', 'Pindutin nang matagal para idagdag ang evacuation center'),
  ('dash.hold_add', 'ilo', 'Ipindot a nabayag tapno mainayon ti evacuation center'),

  ('dash.hold_save_centre', 'en', 'Press and hold to save'),
  ('dash.hold_save_centre', 'tl', 'Pindutin nang matagal para i-save'),
  ('dash.hold_save_centre', 'ceb', 'Pindota ug dugay aron i-save'),
  ('dash.hold_save_centre', 'fil', 'Pindutin nang matagal para i-save'),
  ('dash.hold_save_centre', 'ilo', 'Ipindot a nabayag tapno ma-save')
on conflict (message_key, language) do update set text = excluded.text;
