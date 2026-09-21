-- ---------------------------------------------------------------------------
-- Official login by personal code (/lgu)
-- ---------------------------------------------------------------------------
-- An official opens /lgu, types their own official code, and that phone
-- becomes an official's. There is no email or password, and nothing touches
-- the Auth tables: the code simply grants the official role to the phone's own
-- (anonymous) account, the same row an official grants by device code.
--
--   * Each official has their own code, made by another official and shown
--     once. Only a bcrypt hash is stored.
--   * ~10 characters from a 31-symbol alphabet (no 0/O, 1/I/L): about 49 bits,
--     far beyond guessing. Wrong tries are also limited — 5 per device and 30
--     across the barangay per 10 minutes — because a new anonymous device costs
--     nothing to make.
--   * One phone at a time. Logging in on a new phone makes the previous phone
--     a resident again, so a lost phone loses access as soon as its official
--     logs in elsewhere.
--   * Deleting a code makes the phone using it a resident again.
--
-- The /lgu address hides nothing; the code is the only protection.

create table public.official_codes (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (length(trim(label)) between 1 and 60),
  code_hash    text not null,
  hint         text not null,
  holder       uuid references auth.users (id) on delete set null,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- No policies: the table is reached only through the functions below, so the
-- hashes are never readable from the app.
alter table public.official_codes enable row level security;

create table private.login_attempts (
  ts  timestamptz not null default now(),
  uid uuid,
  ok  boolean not null
);
create index login_attempts_by_ts on private.login_attempts (ts);

-- Official only. Returns the new code; it is never retrievable again.
create or replace function public.create_official_code(code_label text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(10);
  raw text := '';
  i int;
begin
  if not private.is_official() then
    raise exception 'only an official can create codes' using errcode = '42501';
  end if;
  if length(trim(coalesce(code_label, ''))) not between 1 and 60 then
    raise exception 'a name is required' using errcode = '22023';
  end if;

  for i in 0..9 loop
    raw := raw || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
  end loop;

  insert into public.official_codes (label, code_hash, hint, created_by)
  values (trim(code_label), crypt(raw, gen_salt('bf', 8)), right(raw, 2), auth.uid());

  return substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 2);
end;
$$;

-- Anyone may try. Answers 'official', 'wrong', or 'locked' (too many wrong
-- tries; wait). Answered, not raised: an error would roll back the record of
-- the failed try, and the limit would never be reached.
create or replace function public.redeem_official_code(code text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  me uuid := auth.uid();
  typed text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  found public.official_codes%rowtype;
begin
  if me is null then
    raise exception 'no session' using errcode = '42501';
  end if;

  if (select count(*) from private.login_attempts
       where not ok and uid = me and ts > now() - interval '10 minutes') >= 5
     or (select count(*) from private.login_attempts
          where not ok and ts > now() - interval '10 minutes') >= 30 then
    return 'locked';
  end if;

  select * into found from public.official_codes c
   where length(typed) = 10 and c.code_hash = crypt(typed, c.code_hash)
   limit 1;

  if found.id is null then
    insert into private.login_attempts (uid, ok) values (me, false);
    return 'wrong';
  end if;

  insert into private.login_attempts (uid, ok) values (me, true);

  -- One phone at a time: the previous phone on this code is a resident again.
  if found.holder is not null and found.holder <> me then
    update public.user_roles set role = 'resident', granted_at = now()
     where user_id = found.holder and role = 'official';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at)
  values (me, 'official', found.created_by, now())
  on conflict (user_id) do update
    set role = 'official', granted_by = excluded.granted_by, granted_at = now();

  update public.official_codes set holder = me, last_used_at = now() where id = found.id;
  return 'official';
end;
$$;

-- Log out: the phone is a resident's again. Only for a phone that logged in
-- with a code — an official granted by device code has nothing to log out of.
create or replace function public.logout_official()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.official_codes where holder = me) then
    raise exception 'not logged in with a code' using errcode = 'P0002';
  end if;
  update public.official_codes set holder = null where holder = me;
  update public.user_roles set role = 'resident', granted_at = now() where user_id = me;
end;
$$;

-- The name on the code this phone is logged in with, or null.
create or replace function public.my_official_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select label from public.official_codes where holder = auth.uid() limit 1;
$$;

-- Officials only: every code, without its hash.
create or replace function public.list_official_codes()
returns table (id uuid, label text, hint text, holder_code text, created_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.label, c.hint,
         case when c.holder is null then null else upper(left(c.holder::text, 8)) end,
         c.created_at, c.last_used_at
    from public.official_codes c
   where private.is_official()
   order by c.created_at;
$$;

-- Officials only. The phone using the code becomes a resident. An official
-- cannot delete the code they are logged in with (that would lock them out).
create or replace function public.delete_official_code(code_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  found public.official_codes%rowtype;
begin
  if not private.is_official() then
    raise exception 'only an official can delete codes' using errcode = '42501';
  end if;
  select * into found from public.official_codes where id = code_id;
  if found.id is null then return; end if;
  if found.holder = auth.uid() then
    raise exception 'cannot delete your own code' using errcode = 'SB001';
  end if;
  if found.holder is not null then
    update public.user_roles set role = 'resident', granted_at = now()
     where user_id = found.holder and role = 'official';
  end if;
  delete from public.official_codes where id = code_id;
end;
$$;

revoke execute on function public.create_official_code(text) from public, anon;
revoke execute on function public.redeem_official_code(text) from public, anon;
revoke execute on function public.logout_official() from public, anon;
revoke execute on function public.my_official_code() from public, anon;
revoke execute on function public.list_official_codes() from public, anon;
revoke execute on function public.delete_official_code(uuid) from public, anon;
grant execute on function public.create_official_code(text) to authenticated;
grant execute on function public.redeem_official_code(text) to authenticated;
grant execute on function public.logout_official() to authenticated;
grant execute on function public.my_official_code() to authenticated;
grant execute on function public.list_official_codes() to authenticated;
grant execute on function public.delete_official_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Strings. login.* and codes.* are staff-facing; machine-translated languages
-- fall back to Tagalog (scripts/generate-translations.mjs).
-- ---------------------------------------------------------------------------

insert into public.translations (message_key, language, text) values
  ('login.title', 'en', 'OFFICIAL LOGIN'),
  ('login.title', 'tl', 'LOGIN NG OPISYAL'),
  ('login.title', 'ceb', 'LOGIN SA OPISYAL'),
  ('login.title', 'fil', 'LOGIN NG OPISYAL'),
  ('login.title', 'ilo', 'LOGIN TI OPISYAL'),

  ('login.intro', 'en', 'For barangay officials. Enter your own official code.'),
  ('login.intro', 'tl', 'Para sa mga opisyal ng barangay. Ilagay ang sarili mong official code.'),
  ('login.intro', 'ceb', 'Para sa mga opisyal sa barangay. Isulod ang imong kaugalingong official code.'),
  ('login.intro', 'fil', 'Para sa mga opisyal ng barangay. Ilagay ang sarili mong official code.'),
  ('login.intro', 'ilo', 'Para kadagiti opisyal ti barangay. Ikabilmo ti bukodmo nga official code.'),

  ('login.code', 'en', 'OFFICIAL CODE'),
  ('login.code', 'tl', 'OFFICIAL CODE'),
  ('login.code', 'ceb', 'OFFICIAL CODE'),
  ('login.code', 'fil', 'OFFICIAL CODE'),
  ('login.code', 'ilo', 'OFFICIAL CODE'),

  ('login.submit', 'en', 'LOG IN'),
  ('login.submit', 'tl', 'MAG-LOG IN'),
  ('login.submit', 'ceb', 'MO-LOG IN'),
  ('login.submit', 'fil', 'MAG-LOG IN'),
  ('login.submit', 'ilo', 'AG-LOG IN'),

  ('login.wrong', 'en', 'Wrong code. Check it and try again.'),
  ('login.wrong', 'tl', 'Maling code. Suriin at subukang muli.'),
  ('login.wrong', 'ceb', 'Sayop nga code. Susiha ug sulayi pag-usab.'),
  ('login.wrong', 'fil', 'Maling code. Suriin at subukang muli.'),
  ('login.wrong', 'ilo', 'Biddut a code. Kitaem ket padasem manen.'),

  ('login.locked', 'en', 'Too many wrong tries. Wait 10 minutes.'),
  ('login.locked', 'tl', 'Masyadong maraming maling subok. Maghintay ng 10 minuto.'),
  ('login.locked', 'ceb', 'Daghan kaayong sayop nga pagsulay. Paghulat og 10 minutos.'),
  ('login.locked', 'fil', 'Masyadong maraming maling subok. Maghintay ng 10 minuto.'),
  ('login.locked', 'ilo', 'Adu unay ti biddut a padas. Aguray iti 10 a minuto.'),

  ('login.done', 'en', 'Logged in. This phone is now an official''s.'),
  ('login.done', 'tl', 'Naka-log in na. Pang-opisyal na ang teleponong ito.'),
  ('login.done', 'ceb', 'Naka-log in na. Pang-opisyal na kining telepono.'),
  ('login.done', 'fil', 'Naka-log in na. Pang-opisyal na ang teleponong ito.'),
  ('login.done', 'ilo', 'Naka-log in on. Para iti opisyal daytoy a telepono.'),

  ('login.go', 'en', 'OPEN OFFICIAL PAGE'),
  ('login.go', 'tl', 'BUKSAN ANG PAHINA NG OPISYAL'),
  ('login.go', 'ceb', 'ABLIHI ANG PANID SA OPISYAL'),
  ('login.go', 'fil', 'BUKSAN ANG PAHINA NG OPISYAL'),
  ('login.go', 'ilo', 'LUKATAN TI PANID TI OPISYAL'),

  ('login.as', 'en', 'LOGGED IN AS OFFICIAL · {n}'),
  ('login.as', 'tl', 'NAKA-LOG IN BILANG OPISYAL · {n}'),
  ('login.as', 'ceb', 'NAKA-LOG IN ISIP OPISYAL · {n}'),
  ('login.as', 'fil', 'NAKA-LOG IN BILANG OPISYAL · {n}'),
  ('login.as', 'ilo', 'NAKA-LOG IN A KAS OPISYAL · {n}'),

  ('login.logout', 'en', 'LOG OUT'),
  ('login.logout', 'tl', 'MAG-LOG OUT'),
  ('login.logout', 'ceb', 'MO-LOG OUT'),
  ('login.logout', 'fil', 'MAG-LOG OUT'),
  ('login.logout', 'ilo', 'AG-LOG OUT'),

  ('login.hold_logout', 'en', 'Press and hold — this phone goes back to a resident''s'),
  ('login.hold_logout', 'tl', 'Pindutin nang matagal — babalik sa residente ang teleponong ito'),
  ('login.hold_logout', 'ceb', 'Pindota ug dugay — mobalik sa residente kining telepono'),
  ('login.hold_logout', 'fil', 'Pindutin nang matagal — babalik sa residente ang teleponong ito'),
  ('login.hold_logout', 'ilo', 'Ipindot a nabayag — agsubli iti agnanaed daytoy a telepono'),

  ('codes.title', 'en', 'OFFICIAL CODES'),
  ('codes.title', 'tl', 'MGA OFFICIAL CODE'),
  ('codes.title', 'ceb', 'MGA OFFICIAL CODE'),
  ('codes.title', 'fil', 'MGA OFFICIAL CODE'),
  ('codes.title', 'ilo', 'DAGITI OFFICIAL CODE'),

  ('codes.intro', 'en', 'Each official gets their own code to log in at /lgu. One phone at a time.'),
  ('codes.intro', 'tl', 'Bawat opisyal ay may sariling code para mag-log in sa /lgu. Isang telepono lang bawat code.'),
  ('codes.intro', 'ceb', 'Ang matag opisyal adunay kaugalingong code aron mo-log in sa /lgu. Usa ka telepono matag code.'),
  ('codes.intro', 'fil', 'Bawat opisyal ay may sariling code para mag-log in sa /lgu. Isang telepono lang bawat code.'),
  ('codes.intro', 'ilo', 'Tunggal opisyal ket addaan iti bukodna a code tapno ag-log in iti /lgu. Maysa laeng a telepono iti tunggal code.'),

  ('codes.name', 'en', 'NAME OF THE OFFICIAL'),
  ('codes.name', 'tl', 'PANGALAN NG OPISYAL'),
  ('codes.name', 'ceb', 'NGALAN SA OPISYAL'),
  ('codes.name', 'fil', 'PANGALAN NG OPISYAL'),
  ('codes.name', 'ilo', 'NAGAN TI OPISYAL'),

  ('codes.create', 'en', 'CREATE CODE'),
  ('codes.create', 'tl', 'GUMAWA NG CODE'),
  ('codes.create', 'ceb', 'MAGHIMO OG CODE'),
  ('codes.create', 'fil', 'GUMAWA NG CODE'),
  ('codes.create', 'ilo', 'AGARAMID TI CODE'),

  ('codes.new', 'en', 'Write this down now and give it only to {n}. It will not be shown again.'),
  ('codes.new', 'tl', 'Isulat ito ngayon at ibigay lamang kay {n}. Hindi na ito ipapakitang muli.'),
  ('codes.new', 'ceb', 'Isulat kini karon ug ihatag lang kang {n}. Dili na kini ipakita pag-usab.'),
  ('codes.new', 'fil', 'Isulat ito ngayon at ibigay lamang kay {n}. Hindi na ito ipapakitang muli.'),
  ('codes.new', 'ilo', 'Isuratmo daytoy ita ket itedmo laeng ken {n}. Saanen a maipakita manen.'),

  ('codes.none', 'en', 'No codes yet.'),
  ('codes.none', 'tl', 'Wala pang code.'),
  ('codes.none', 'ceb', 'Wala pay code.'),
  ('codes.none', 'fil', 'Wala pang code.'),
  ('codes.none', 'ilo', 'Awan pay ti code.'),

  ('codes.on', 'en', 'IN USE ON {n}'),
  ('codes.on', 'tl', 'GAMIT SA {n}'),
  ('codes.on', 'ceb', 'GIGAMIT SA {n}'),
  ('codes.on', 'fil', 'GAMIT SA {n}'),
  ('codes.on', 'ilo', 'US-USAREN ITI {n}'),

  ('codes.unused', 'en', 'NOT USED YET'),
  ('codes.unused', 'tl', 'HINDI PA NAGAMIT'),
  ('codes.unused', 'ceb', 'WALA PA MAGAMIT'),
  ('codes.unused', 'fil', 'HINDI PA NAGAMIT'),
  ('codes.unused', 'ilo', 'SAAN PAY NAUSAR'),

  ('codes.hold_delete', 'en', 'Press and hold to delete — the phone using it becomes a resident''s'),
  ('codes.hold_delete', 'tl', 'Pindutin nang matagal para burahin — magiging residente ang teleponong gumagamit nito'),
  ('codes.hold_delete', 'ceb', 'Pindota ug dugay aron papason — mahimong residente ang teleponong naggamit niini'),
  ('codes.hold_delete', 'fil', 'Pindutin nang matagal para burahin — magiging residente ang teleponong gumagamit nito'),
  ('codes.hold_delete', 'ilo', 'Ipindot a nabayag tapno maikkat — agbalin nga agnanaed ti telepono a mangus-usar iti daytoy')
on conflict (message_key, language) do update set text = excluded.text;
