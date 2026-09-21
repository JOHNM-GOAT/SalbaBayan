-- ---------------------------------------------------------------------------
-- Officials give and take away roles from the app
-- ---------------------------------------------------------------------------
-- A device only knows its short code (the first 8 characters of its id, shown
-- on the ME tab), and nobody can read auth.users from the client, so granting
-- needs a function that turns the code into the device.
--
-- Refuses, in this order:
--   42501  the caller is not an official
--   22023  the code is not 8 hex characters
--   P0002  no device has that code
--   P0003  more than one device has it (read it out again, in full)
--   SB001  the caller is changing their own role — this is also what stops the
--          last official from removing themselves and locking the barangay out
--
-- granted_by is the official, so the readiness check counts the volunteer as
-- assigned (src/lib/readiness.ts).

create or replace function public.set_device_role(device_code text, new_role public.user_role)
returns public.user_role
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  if not private.is_official() then
    raise exception 'only officials can change roles' using errcode = '42501';
  end if;
  if device_code is null or device_code !~ '^[0-9a-fA-F]{8}$' then
    raise exception 'a device code is 8 hex characters' using errcode = '22023';
  end if;

  select array_agg(id) into ids
    from auth.users
   where left(id::text, 8) = lower(device_code);

  if ids is null then
    raise exception 'no device has that code' using errcode = 'P0002';
  end if;
  if cardinality(ids) > 1 then
    raise exception 'more than one device has that code' using errcode = 'P0003';
  end if;
  if ids[1] = auth.uid() then
    raise exception 'officials cannot change their own role' using errcode = 'SB001';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at)
  values (ids[1], new_role, auth.uid(), now())
  on conflict (user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at;

  return new_role;
end;
$$;

revoke execute on function public.set_device_role(text, public.user_role) from public, anon;
grant execute on function public.set_device_role(text, public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Strings (ME tab, officials only)
-- ---------------------------------------------------------------------------
-- Reviewed languages, Filipino (= Tagalog), and Ilocano, the language of Batac.
-- Other machine-translated languages fall back to Tagalog for this screen
-- (scripts/generate-translations.mjs treats roles.* as optional).

insert into public.translations (message_key, language, text) values
  ('roles.title', 'en', 'MANAGE ROLES'),
  ('roles.title', 'tl', 'PAMAHALAAN ANG MGA TUNGKULIN'),
  ('roles.title', 'ceb', 'DUMALA SA MGA TAHAS'),
  ('roles.title', 'fil', 'PAMAHALAAN ANG MGA TUNGKULIN'),
  ('roles.title', 'ilo', 'IMANEHAR DAGITI AKEM'),

  ('roles.intro', 'en', 'Ask them to open the ME tab and read you their device code.'),
  ('roles.intro', 'tl', 'Ipabukas sa kanila ang ME tab at ipabasa ang kanilang device code.'),
  ('roles.intro', 'ceb', 'Paablihi sila sa ME tab ug ipabasa ang ilang device code.'),
  ('roles.intro', 'fil', 'Ipabukas sa kanila ang ME tab at ipabasa ang kanilang device code.'),
  ('roles.intro', 'ilo', 'Ibagayo a lukatanda ti ME tab ket basaenda kadakayo ti device code-da.'),

  ('roles.code', 'en', 'DEVICE CODE'),
  ('roles.code', 'tl', 'DEVICE CODE'),
  ('roles.code', 'ceb', 'DEVICE CODE'),
  ('roles.code', 'fil', 'DEVICE CODE'),
  ('roles.code', 'ilo', 'DEVICE CODE'),

  ('roles.code_invalid', 'en', 'A device code is 8 letters and numbers, like 05BA59BA.'),
  ('roles.code_invalid', 'tl', 'Ang device code ay 8 titik at numero, gaya ng 05BA59BA.'),
  ('roles.code_invalid', 'ceb', 'Ang device code kay 8 ka letra ug numero, sama sa 05BA59BA.'),
  ('roles.code_invalid', 'fil', 'Ang device code ay 8 titik at numero, gaya ng 05BA59BA.'),
  ('roles.code_invalid', 'ilo', 'Ti device code ket 8 a letra ken numero, kas iti 05BA59BA.'),

  ('roles.role', 'en', 'ROLE'),
  ('roles.role', 'tl', 'TUNGKULIN'),
  ('roles.role', 'ceb', 'TAHAS'),
  ('roles.role', 'fil', 'TUNGKULIN'),
  ('roles.role', 'ilo', 'AKEM'),

  ('roles.hold_grant', 'en', 'Press and hold to give this role'),
  ('roles.hold_grant', 'tl', 'Pindutin nang matagal para ibigay ang tungkulin'),
  ('roles.hold_grant', 'ceb', 'Pindota ug dugay aron ihatag ang tahas'),
  ('roles.hold_grant', 'fil', 'Pindutin nang matagal para ibigay ang tungkulin'),
  ('roles.hold_grant', 'ilo', 'Ipindot a nabayag tapno ited ti akem'),

  ('roles.granted', 'en', 'Done. They get it the next time they open the app.'),
  ('roles.granted', 'tl', 'Tapos na. Makukuha nila ito sa susunod na pagbukas ng app.'),
  ('roles.granted', 'ceb', 'Nahuman na. Makuha nila kini sa sunod nga pag-abli sa app.'),
  ('roles.granted', 'fil', 'Tapos na. Makukuha nila ito sa susunod na pagbukas ng app.'),
  ('roles.granted', 'ilo', 'Nalpas. Maalada daytoy no sumaruno a lukatanda ti app.'),

  ('roles.not_found', 'en', 'No device has that code. Check it with them again.'),
  ('roles.not_found', 'tl', 'Walang device na may ganitong code. Suriin itong muli sa kanila.'),
  ('roles.not_found', 'ceb', 'Walay device nga adunay ingon ani nga code. Susiha kini pag-usab uban kanila.'),
  ('roles.not_found', 'fil', 'Walang device na may ganitong code. Suriin itong muli sa kanila.'),
  ('roles.not_found', 'ilo', 'Awan ti device nga addaan iti kasta a code. Kitaenyo manen kadakuada.'),

  ('roles.self', 'en', 'You cannot change your own role. Ask another official.'),
  ('roles.self', 'tl', 'Hindi mo mababago ang sarili mong tungkulin. Humingi sa ibang opisyal.'),
  ('roles.self', 'ceb', 'Dili nimo mausab ang imong kaugalingong tahas. Pangayo sa laing opisyal.'),
  ('roles.self', 'fil', 'Hindi mo mababago ang sarili mong tungkulin. Humingi sa ibang opisyal.'),
  ('roles.self', 'ilo', 'Saanmo a mabaliwan ti bukodmo nga akem. Dumawatka iti sabali nga opisyal.'),

  ('roles.offline', 'en', 'Needs a connection. Try again when you are online.'),
  ('roles.offline', 'tl', 'Kailangan ng koneksyon. Subukang muli kapag online ka na.'),
  ('roles.offline', 'ceb', 'Kinahanglan og koneksyon. Sulayi pag-usab kon online na ka.'),
  ('roles.offline', 'fil', 'Kailangan ng koneksyon. Subukang muli kapag online ka na.'),
  ('roles.offline', 'ilo', 'Masapul ti koneksion. Padasenyo manen no online kayon.'),

  ('roles.failed', 'en', 'Could not save. Try again.'),
  ('roles.failed', 'tl', 'Hindi na-save. Subukang muli.'),
  ('roles.failed', 'ceb', 'Wala ma-save. Sulayi pag-usab.'),
  ('roles.failed', 'fil', 'Hindi na-save. Subukang muli.'),
  ('roles.failed', 'ilo', 'Saan a na-save. Padasenyo manen.'),

  ('roles.staff', 'en', 'VOLUNTEERS AND OFFICIALS'),
  ('roles.staff', 'tl', 'MGA BOLUNTARYO AT OPISYAL'),
  ('roles.staff', 'ceb', 'MGA BOLUNTARYO UG OPISYAL'),
  ('roles.staff', 'fil', 'MGA BOLUNTARYO AT OPISYAL'),
  ('roles.staff', 'ilo', 'DAGITI BOLUNTARIO KEN OPISYAL'),

  ('roles.none', 'en', 'None yet.'),
  ('roles.none', 'tl', 'Wala pa.'),
  ('roles.none', 'ceb', 'Wala pa.'),
  ('roles.none', 'fil', 'Wala pa.'),
  ('roles.none', 'ilo', 'Awan pay.'),

  ('roles.you', 'en', 'YOU'),
  ('roles.you', 'tl', 'IKAW'),
  ('roles.you', 'ceb', 'IKAW'),
  ('roles.you', 'fil', 'IKAW'),
  ('roles.you', 'ilo', 'SIKA'),

  ('roles.remove', 'en', 'REMOVE'),
  ('roles.remove', 'tl', 'ALISIN'),
  ('roles.remove', 'ceb', 'TANGTANGA'),
  ('roles.remove', 'fil', 'ALISIN'),
  ('roles.remove', 'ilo', 'IKKATEN'),

  ('roles.hold_remove', 'en', 'Press and hold to make them a resident again'),
  ('roles.hold_remove', 'tl', 'Pindutin nang matagal para gawin silang residente muli'),
  ('roles.hold_remove', 'ceb', 'Pindota ug dugay aron himoon silang residente pag-usab'),
  ('roles.hold_remove', 'fil', 'Pindutin nang matagal para gawin silang residente muli'),
  ('roles.hold_remove', 'ilo', 'Ipindot a nabayag tapno agbalinda manen nga agnanaed')
on conflict (message_key, language) do update set text = excluded.text;
