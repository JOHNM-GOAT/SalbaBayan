-- Taking an SOS call: each responder draws their own route to it, on their own
-- phone. loc.* falls back to Tagalog in the other machine-translated languages.

insert into public.translations (message_key, language, text) values
  ('loc.take_call', 'en', 'TAKE THIS CALL'),
  ('loc.take_call', 'tl', 'KUNIN ANG TAWAG'),
  ('loc.take_call', 'ceb', 'KUHAA KINI NGA TAWAG'),
  ('loc.take_call', 'fil', 'KUNIN ANG TAWAG'),
  ('loc.take_call', 'ilo', 'ALAEN DAYTOY NGA AWAG'),

  ('loc.stop_route', 'en', 'STOP ROUTING'),
  ('loc.stop_route', 'tl', 'ITIGIL ANG RUTA'),
  ('loc.stop_route', 'ceb', 'HUNONGA ANG RUTA'),
  ('loc.stop_route', 'fil', 'ITIGIL ANG RUTA'),
  ('loc.stop_route', 'ilo', 'ISARDENG TI RUTA'),

  ('loc.route_to', 'en', 'YOUR ROUTE TO THIS CALL'),
  ('loc.route_to', 'tl', 'RUTA MO PAPUNTA SA TAWAG'),
  ('loc.route_to', 'ceb', 'IMONG RUTA PADULONG SA TAWAG'),
  ('loc.route_to', 'fil', 'RUTA MO PAPUNTA SA TAWAG'),
  ('loc.route_to', 'ilo', 'RUTAM NGA AGTURONG ITI AWAG'),

  ('loc.following', 'en', 'LOCKED'),
  ('loc.following', 'tl', 'NAKA-LOCK'),
  ('loc.following', 'ceb', 'NAKA-LOCK'),
  ('loc.following', 'fil', 'NAKA-LOCK'),
  ('loc.following', 'ilo', 'NAKA-LOCK'),

  ('loc.centre_call', 'en', 'Centre on the call'),
  ('loc.centre_call', 'tl', 'Itutok sa tawag'),
  ('loc.centre_call', 'ceb', 'Ipunting sa tawag'),
  ('loc.centre_call', 'fil', 'Itutok sa tawag'),
  ('loc.centre_call', 'ilo', 'Iturong iti awag')
on conflict (message_key, language) do update set text = excluded.text;
