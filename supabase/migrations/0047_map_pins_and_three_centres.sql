-- ---------------------------------------------------------------------------
-- Pinning from the official's map, and up to three evacuation centres
-- ---------------------------------------------------------------------------
-- 1. A water reading pinned on the map keeps its point. Residents still report
--    by area (no GPS), so both columns stay optional.
-- 2. A barangay may have up to 3 evacuation centres, and always keeps at least
--    one. A removed centre is archived, not deleted: deleting it would cascade
--    to its headcount ledger and check-ins, which are the record of past storms.
--    The app reads only centres that are not archived.

alter table public.water_reports
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);

alter table public.evac_centers
  add column archived_at timestamptz;

alter table public.evac_centers
  add constraint evac_centers_name_check check (length(trim(name)) between 1 and 80);

create or replace function private.limit_evac_centers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  place uuid := (select p.barangay_id from public.puroks p where p.id = new.purok_id);
  others int := (select count(*)
                   from public.evac_centers c
                   join public.puroks p on p.id = c.purok_id
                  where p.barangay_id = place
                    and c.archived_at is null
                    and c.id <> new.id);
begin
  if new.archived_at is null and others >= 3 then
    raise exception 'a barangay can have at most 3 evacuation centres'
      using errcode = '23514';
  end if;
  if new.archived_at is not null
     and (tg_op = 'INSERT' or old.archived_at is null)
     and others = 0 then
    raise exception 'a barangay must keep at least one evacuation centre'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger evac_centers_limit
  before insert or update on public.evac_centers
  for each row
  execute function private.limit_evac_centers();

-- ---------------------------------------------------------------------------
-- Strings. dash.* is official-only and evac.* is optional: the other
-- machine-translated languages fall back to Tagalog.
-- ---------------------------------------------------------------------------

insert into public.translations (message_key, language, text) values
  ('dash.home', 'en', 'DASHBOARD'),
  ('dash.home', 'tl', 'DASHBOARD'),
  ('dash.home', 'ceb', 'DASHBOARD'),
  ('dash.home', 'fil', 'DASHBOARD'),
  ('dash.home', 'ilo', 'DASHBOARD'),

  ('dash.tab_centres', 'en', 'CENTRES'),
  ('dash.tab_centres', 'tl', 'EVAC CENTER'),
  ('dash.tab_centres', 'ceb', 'EVAC CENTER'),
  ('dash.tab_centres', 'fil', 'EVAC CENTER'),
  ('dash.tab_centres', 'ilo', 'EVAC CENTER'),

  ('dash.tap_hint', 'en', 'Tap a street on the map to pin a hazard, a water level or an evacuation centre.'),
  ('dash.tap_hint', 'tl', 'Pindutin ang isang kalye sa mapa para mag-pin ng panganib, taas ng tubig o evacuation center.'),
  ('dash.tap_hint', 'ceb', 'Pindota ang usa ka dalan sa mapa aron mag-pin og peligro, gilawmon sa tubig o evacuation center.'),
  ('dash.tap_hint', 'fil', 'Pindutin ang isang kalye sa mapa para mag-pin ng panganib, taas ng tubig o evacuation center.'),
  ('dash.tap_hint', 'ilo', 'Ipindot ti maysa a kalsada iti mapa tapno mangi-pin iti peligro, kaadalem ti danum wenno evacuation center.'),

  ('dash.pin_hazard', 'en', 'HAZARD'),
  ('dash.pin_hazard', 'tl', 'PANGANIB'),
  ('dash.pin_hazard', 'ceb', 'PELIGRO'),
  ('dash.pin_hazard', 'fil', 'PANGANIB'),
  ('dash.pin_hazard', 'ilo', 'PELIGRO'),

  ('dash.pin_water', 'en', 'WATER / FLOOD'),
  ('dash.pin_water', 'tl', 'TUBIG / BAHA'),
  ('dash.pin_water', 'ceb', 'TUBIG / BAHA'),
  ('dash.pin_water', 'fil', 'TUBIG / BAHA'),
  ('dash.pin_water', 'ilo', 'DANUM / LAYUS'),

  ('dash.pin_evacuate', 'en', 'EVACUATE'),
  ('dash.pin_evacuate', 'tl', 'LIKASAN'),
  ('dash.pin_evacuate', 'ceb', 'BAKWITANAN'),
  ('dash.pin_evacuate', 'fil', 'LIKASAN'),
  ('dash.pin_evacuate', 'ilo', 'PAGBAKWITAN'),

  ('dash.which_hazard', 'en', 'What is the hazard?'),
  ('dash.which_hazard', 'tl', 'Ano ang panganib?'),
  ('dash.which_hazard', 'ceb', 'Unsa ang peligro?'),
  ('dash.which_hazard', 'fil', 'Ano ang panganib?'),
  ('dash.which_hazard', 'ilo', 'Ania ti peligro?'),

  ('dash.which_depth', 'en', 'How deep is the water?'),
  ('dash.which_depth', 'tl', 'Gaano kalalim ang tubig?'),
  ('dash.which_depth', 'ceb', 'Unsa ka lawom ang tubig?'),
  ('dash.which_depth', 'fil', 'Gaano kalalim ang tubig?'),
  ('dash.which_depth', 'ilo', 'Kasano kaadalem ti danum?'),

  ('dash.no_street', 'en', 'NO NAMED STREET HERE'),
  ('dash.no_street', 'tl', 'WALANG PANGALANG KALYE DITO'),
  ('dash.no_street', 'ceb', 'WALAY NGALAN NGA DALAN DINHI'),
  ('dash.no_street', 'fil', 'WALANG PANGALANG KALYE DITO'),
  ('dash.no_street', 'ilo', 'AWAN TI NAGAN TI KALSADA DITOY'),

  ('dash.outside', 'en', 'That spot is outside the barangay. Tap inside the dashed line.'),
  ('dash.outside', 'tl', 'Nasa labas ng barangay ang lugar na iyan. Pindutin sa loob ng putol-putol na linya.'),
  ('dash.outside', 'ceb', 'Gawas sa barangay kana nga dapit. Pindota sulod sa putol-putol nga linya.'),
  ('dash.outside', 'fil', 'Nasa labas ng barangay ang lugar na iyan. Pindutin sa loob ng putol-putol na linya.'),
  ('dash.outside', 'ilo', 'Ruar ti barangay dayta a lugar. Ipindot iti uneg ti putput a linya.'),

  ('dash.pinned', 'en', 'Pinned. Everyone''s map shows it now.'),
  ('dash.pinned', 'tl', 'Naka-pin na. Makikita na ito sa mapa ng lahat.'),
  ('dash.pinned', 'ceb', 'Na-pin na. Makita na kini sa mapa sa tanan.'),
  ('dash.pinned', 'fil', 'Naka-pin na. Makikita na ito sa mapa ng lahat.'),
  ('dash.pinned', 'ilo', 'Na-pin en. Makitan daytoy iti mapa ti amin.'),

  ('dash.new_centre', 'en', 'NEW EVACUATION CENTRE'),
  ('dash.new_centre', 'tl', 'BAGONG EVACUATION CENTER'),
  ('dash.new_centre', 'ceb', 'BAG-ONG EVACUATION CENTER'),
  ('dash.new_centre', 'fil', 'BAGONG EVACUATION CENTER'),
  ('dash.new_centre', 'ilo', 'BARO NGA EVACUATION CENTER'),

  ('dash.edit_centre', 'en', 'EDIT CENTRE'),
  ('dash.edit_centre', 'tl', 'I-EDIT ANG CENTER'),
  ('dash.edit_centre', 'ceb', 'I-EDIT ANG CENTER'),
  ('dash.edit_centre', 'fil', 'I-EDIT ANG CENTER'),
  ('dash.edit_centre', 'ilo', 'I-EDIT TI CENTER'),

  ('dash.centres_full', 'en', 'There are already 3 evacuation centres. Remove one first.'),
  ('dash.centres_full', 'tl', 'May 3 evacuation center na. Mag-alis muna ng isa.'),
  ('dash.centres_full', 'ceb', 'Adunay 3 na ka evacuation center. Tangtanga una ang usa.'),
  ('dash.centres_full', 'fil', 'May 3 evacuation center na. Mag-alis muna ng isa.'),
  ('dash.centres_full', 'ilo', 'Adda payen 3 nga evacuation center. Ikkaten pay ti maysa.'),

  ('dash.centres_of', 'en', '{n} OF 3 CENTRES'),
  ('dash.centres_of', 'tl', '{n} SA 3 CENTER'),
  ('dash.centres_of', 'ceb', '{n} SA 3 KA CENTER'),
  ('dash.centres_of', 'fil', '{n} SA 3 CENTER'),
  ('dash.centres_of', 'ilo', '{n} ITI 3 A CENTER'),

  ('dash.centre_saved', 'en', 'Saved. Routes now lead each street to its nearest centre.'),
  ('dash.centre_saved', 'tl', 'Na-save. Ang ruta ng bawat kalye ay papunta na sa pinakamalapit na center.'),
  ('dash.centre_saved', 'ceb', 'Na-save. Ang ruta sa matag dalan padulong na sa labing duol nga center.'),
  ('dash.centre_saved', 'fil', 'Na-save. Ang ruta ng bawat kalye ay papunta na sa pinakamalapit na center.'),
  ('dash.centre_saved', 'ilo', 'Na-save. Ti ruta ti tunggal kalsada ket mapan iti kaasitgan a center.'),

  ('dash.remove_centre', 'en', 'REMOVE CENTRE'),
  ('dash.remove_centre', 'tl', 'ALISIN ANG CENTER'),
  ('dash.remove_centre', 'ceb', 'TANGTANGA ANG CENTER'),
  ('dash.remove_centre', 'fil', 'ALISIN ANG CENTER'),
  ('dash.remove_centre', 'ilo', 'IKKATEN TI CENTER'),

  ('dash.hold_remove', 'en', 'Press and hold to remove this centre'),
  ('dash.hold_remove', 'tl', 'Pindutin nang matagal para alisin ang center'),
  ('dash.hold_remove', 'ceb', 'Pindota ug dugay aron tangtangon ang center'),
  ('dash.hold_remove', 'fil', 'Pindutin nang matagal para alisin ang center'),
  ('dash.hold_remove', 'ilo', 'Ipindot a nabayag tapno maikkat ti center'),

  ('dash.last_centre', 'en', 'The barangay must keep at least one evacuation centre.'),
  ('dash.last_centre', 'tl', 'Kailangang may kahit isang evacuation center ang barangay.'),
  ('dash.last_centre', 'ceb', 'Kinahanglan adunay bisan usa ka evacuation center ang barangay.'),
  ('dash.last_centre', 'fil', 'Kailangang may kahit isang evacuation center ang barangay.'),
  ('dash.last_centre', 'ilo', 'Masapul nga adda uray maysa nga evacuation center ti barangay.'),

  ('dash.inside', 'en', 'INSIDE'),
  ('dash.inside', 'tl', 'NASA LOOB'),
  ('dash.inside', 'ceb', 'SULOD'),
  ('dash.inside', 'fil', 'NASA LOOB'),
  ('dash.inside', 'ilo', 'ADDA ITI UNEG'),

  ('dash.back', 'en', 'BACK'),
  ('dash.back', 'tl', 'BUMALIK'),
  ('dash.back', 'ceb', 'BALIK'),
  ('dash.back', 'fil', 'BUMALIK'),
  ('dash.back', 'ilo', 'AGSUBLI'),

  ('evac.nearest', 'en', 'NEAREST EVACUATION CENTRE'),
  ('evac.nearest', 'tl', 'PINAKAMALAPIT NA EVACUATION CENTER'),
  ('evac.nearest', 'ceb', 'LABING DUOL NGA EVACUATION CENTER'),
  ('evac.nearest', 'fil', 'PINAKAMALAPIT NA EVACUATION CENTER'),
  ('evac.nearest', 'ilo', 'KAASITGAN NGA EVACUATION CENTER'),

  ('evac.other_centres', 'en', 'OTHER CENTRES'),
  ('evac.other_centres', 'tl', 'IBANG CENTER'),
  ('evac.other_centres', 'ceb', 'UBANG CENTER'),
  ('evac.other_centres', 'fil', 'IBANG CENTER'),
  ('evac.other_centres', 'ilo', 'DADDUMA A CENTER'),

  ('evac.from_you', 'en', 'FROM WHERE YOU ARE'),
  ('evac.from_you', 'tl', 'MULA SA KINAROROONAN MO'),
  ('evac.from_you', 'ceb', 'GIKAN SA IMONG NAHIMUTANGAN'),
  ('evac.from_you', 'fil', 'MULA SA KINAROROONAN MO'),
  ('evac.from_you', 'ilo', 'MANIPUD ITI AYANMO'),

  ('evac.from_street', 'en', 'FROM YOUR STREET'),
  ('evac.from_street', 'tl', 'MULA SA IYONG KALYE'),
  ('evac.from_street', 'ceb', 'GIKAN SA IMONG DALAN'),
  ('evac.from_street', 'fil', 'MULA SA IYONG KALYE'),
  ('evac.from_street', 'ilo', 'MANIPUD ITI KALSADAM'),

  ('evac.at_centre', 'en', 'CENTRE YOU ARE AT'),
  ('evac.at_centre', 'tl', 'CENTER NA KINAROROONAN MO'),
  ('evac.at_centre', 'ceb', 'CENTER NGA IMONG GINAHIMUTANGAN'),
  ('evac.at_centre', 'fil', 'CENTER NA KINAROROONAN MO'),
  ('evac.at_centre', 'ilo', 'CENTER A AYANMO')
on conflict (message_key, language) do update set text = excluded.text;
