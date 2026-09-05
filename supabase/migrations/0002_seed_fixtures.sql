-- Seed fixtures. Fictional pilot (decision Q4): Barangay San Isidro, Signal 3.
-- "An empty barangay demos terribly and debugs worse" — PRD §15.

insert into public.barangays (name, municipality, province, current_signal_level, signal_set_at)
values ('San Isidro', 'Sta. Cruz', 'Laguna', 3, now());

insert into public.puroks (barangay_id, name)
select b.id, p.name
from public.barangays b,
     (values ('Purok 1'),('Purok 2'),('Purok 3'),('Purok 4'),
             ('Purok 5'),('Purok 6'),('Purok 7'),('Purok 8')) as p(name)
where b.name = 'San Isidro';

insert into public.evac_centers (purok_id, name, capacity)
select pk.id, c.name, c.cap
from public.puroks pk
join (values ('Purok 3','Barangay Gym',150),
             ('Purok 5','San Roque Chapel',80),
             ('Purok 7','San Isidro Elementary School',220)) as c(purok, name, cap)
  on c.purok = pk.name;

insert into public.translations (message_key, language, text) values
  ('action.stay_alert','tl','Ihanda ang go-bag. Bantayan ang bagong bulletin.'),
  ('action.stay_alert','ceb','Andama ang go-bag. Paminawa ang bag-ong bulletin.'),
  ('action.stay_alert','en','Prepare your go-bag. Watch for the next bulletin.'),
  ('action.prepare','tl','I-secure ang bahay. Ihanda ang pamilya para lumikas.'),
  ('action.prepare','ceb','I-secure ang balay. Andama ang pamilya sa pagbakwit.'),
  ('action.prepare','en','Secure your home. Prepare your family to evacuate.'),
  ('action.evacuate_now','tl','Pumunta na sa evacuation center. Huwag hintayin ang dilim.'),
  ('action.evacuate_now','ceb','Adto na sa evacuation center. Ayaw hulata ang kangitngit.'),
  ('action.evacuate_now','en','Go to your evacuation center now. Do not wait for dark.'),
  ('action.evacuate_immediately','tl','Delikado na sa labas. Umalis ngayon din.'),
  ('action.evacuate_immediately','ceb','Delikado na sa gawas. Biya karon dayon.'),
  ('action.evacuate_immediately','en','Conditions outside are dangerous. Leave now.'),
  ('action.stay_inside','tl','Huwag lumabas. Dapat nasa evacuation center ka na.'),
  ('action.stay_inside','ceb','Ayaw paggawas. Naa na dapat ka sa evacuation center.'),
  ('action.stay_inside','en','Do not go outside. You should already be at the centre.'),
  ('headline.stay_alert','tl','MANATILING ALERTO'),
  ('headline.stay_alert','ceb','PAGBANTAY'),
  ('headline.stay_alert','en','STAY ALERT'),
  ('headline.prepare','tl','MAGHANDA NA'),
  ('headline.prepare','ceb','PANGANDAM NA'),
  ('headline.prepare','en','GET READY'),
  ('headline.evacuate_now','tl','LUMIKAS NA'),
  ('headline.evacuate_now','ceb','BAKWIT NA'),
  ('headline.evacuate_now','en','EVACUATE NOW'),
  ('headline.evacuate_immediately','tl','LUMIKAS AGAD'),
  ('headline.evacuate_immediately','ceb','BAKWIT DAYON'),
  ('headline.evacuate_immediately','en','EVACUATE IMMEDIATELY'),
  ('headline.stay_inside','tl','MANATILI SA LOOB'),
  ('headline.stay_inside','ceb','PABILIN SA SULOD'),
  ('headline.stay_inside','en','STAY INSIDE');

-- Protocol grid with 7 deliberate gaps (33 of 40 cells), so the coverage
-- matrix and readiness checklist have something real to flag.
insert into public.protocols (purok_id, signal_level, route, evac_center_id, action_key)
select pk.id,
       lvl.n,
       pk.name || ' -> ' || ec.name,
       ec.id,
       case lvl.n
         when 1 then 'action.stay_alert'
         when 2 then 'action.prepare'
         when 3 then 'action.evacuate_now'
         when 4 then 'action.evacuate_immediately'
         else 'action.stay_inside'
       end
from public.puroks pk
cross join (values (1),(2),(3),(4),(5)) as lvl(n)
join public.evac_centers ec
  on ec.name = case
       when pk.name in ('Purok 1','Purok 2','Purok 3','Purok 4') then 'Barangay Gym'
       when pk.name in ('Purok 5','Purok 6') then 'San Roque Chapel'
       else 'San Isidro Elementary School'
     end
where not (
     (pk.name = 'Purok 1' and lvl.n = 5)
  or (pk.name = 'Purok 3' and lvl.n = 5)
  or (pk.name = 'Purok 4' and lvl.n in (4,5))
  or (pk.name = 'Purok 5' and lvl.n = 5)
  or (pk.name = 'Purok 7' and lvl.n in (4,5))
);

insert into public.residents (purok_id, name, qr_token, vulnerability_tags)
select pk.id, r.name, r.token, r.tags
from public.puroks pk
join (values
    ('Purok 3','Maria Santos','SB-0142', array['elderly','medical']),
    ('Purok 3','Jose Reyes','SB-0143', array[]::text[]),
    ('Purok 3','Ana Dela Cruz','SB-0144', array['infant']),
    ('Purok 5','Elena Bautista','SB-0145', array['elderly']),
    ('Purok 7','Roberto Aquino','SB-0146', array['medical'])
  ) as r(purok, name, token, tags) on r.purok = pk.name;
