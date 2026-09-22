-- ---------------------------------------------------------------------------
-- Official access: a shared PIN, a super access code, user management
-- ---------------------------------------------------------------------------
-- Replaces the per-official login codes of 0037 (none were ever created).
--
-- * Being an official is still a role in user_roles, granted by an official
--   (device code / QR, 0032) or by the access code below. The PIN grants
--   nothing: it only unlocks the official pages on a device that is ALREADY
--   an official. verify_official_pin() answers true for officials only, so a
--   resident or volunteer who knows the PIN still gets nothing.
-- * The access code turns ANY device into an official with full
--   administration (`is_super`; the app shows it simply as "Official"). It is
--   stored only as a bcrypt hash, wrong tries are limited to 10 per 10
--   minutes across all devices, and a super official can change it or switch
--   it off.
-- * Super officials manage users: list them, and set any device's role.
--   Only they can change the PIN and the access code. A regular official
--   cannot touch a super official's role.
--
-- The PIN and access code themselves are NOT in this file. They are seeded
-- into private.access_settings directly on the live project (as bcrypt hashes
-- computed there), so neither ever appears in the repository. A fresh database
-- starts with both unset: nobody can unlock or use a code until an operator
-- seeds them.

drop function if exists public.create_official_code(text);
drop function if exists public.redeem_official_code(text);
drop function if exists public.logout_official();
drop function if exists public.my_official_code();
drop function if exists public.list_official_codes();
drop function if exists public.delete_official_code(uuid);
drop table if exists public.official_codes;

alter table private.login_attempts add column if not exists kind text not null default 'code';

alter table public.user_roles add column is_super boolean not null default false;

create or replace function private.is_super()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.user_roles
                  where user_id = auth.uid() and role = 'official' and is_super);
$$;

/*
 * user_roles can be written directly by officials (manage_roles, 0003). This
 * keeps that from reaching the super flag: from a device's own session it can
 * never be set, and a super official's row cannot be changed or removed by a
 * regular official. Inside the SECURITY DEFINER functions below current_user
 * is the owner, so they are not restricted here — they check the caller
 * themselves. Security INVOKER on purpose, for that reason.
 */
create or replace function private.guard_user_roles()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op in ('UPDATE', 'DELETE') and old.is_super and not private.is_super() then
      raise exception 'only a super official can change this role' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'INSERT' then
      new.is_super := false;
    else
      new.is_super := old.is_super;
    end if;
  end if;
  if tg_op <> 'DELETE' and new.role <> 'official' then
    new.is_super := false;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_user_roles
  before insert or update or delete on public.user_roles
  for each row execute function private.guard_user_roles();

-- A regular official granting roles by device code (0032) must not demote a
-- super official either; the trigger above refuses it, with a clearer error here.
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
  select array_agg(id) into ids from auth.users where left(id::text, 8) = lower(device_code);
  if ids is null then
    raise exception 'no device has that code' using errcode = 'P0002';
  end if;
  if cardinality(ids) > 1 then
    raise exception 'more than one device has that code' using errcode = 'P0003';
  end if;
  if ids[1] = auth.uid() then
    raise exception 'officials cannot change their own role' using errcode = 'SB001';
  end if;
  if not private.is_super()
     and exists (select 1 from public.user_roles where user_id = ids[1] and is_super) then
    raise exception 'only a super official can change this role' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role, granted_by, granted_at)
  values (ids[1], new_role, auth.uid(), now())
  on conflict (user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at,
        is_super = case when excluded.role = 'official' then public.user_roles.is_super else false end;
  return new_role;
end;
$$;

create table private.access_settings (
  id                 boolean primary key default true check (id),
  pin_hash           text,
  super_code_hash    text,
  super_code_enabled boolean not null default true,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
insert into private.access_settings (id) values (true) on conflict do nothing;

-- What this device is: its role, and whether it has full administration.
create or replace function public.my_access()
returns table (role public.user_role, is_super boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(r.role, 'resident'::public.user_role), coalesce(r.is_super, false)
    from (select 1) one
    left join public.user_roles r on r.user_id = auth.uid();
$$;

-- True only for an official device with the right PIN. No lockout, by design:
-- the PIN unlocks pages the device's role already allows, nothing more.
create or replace function public.verify_official_pin(pin text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select private.is_official()
     and coalesce(pin, '') ~ '^[0-9]{4}$'
     and exists (select 1 from private.access_settings s
                  where s.pin_hash is not null and s.pin_hash = crypt(pin, s.pin_hash));
$$;

-- Any device. Answers 'official', 'wrong', 'locked' or 'disabled' — answered,
-- not raised, so a wrong try is recorded rather than rolled back.
create or replace function public.redeem_access_code(code text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  me uuid := auth.uid();
  settings private.access_settings%rowtype;
begin
  if me is null then
    raise exception 'no session' using errcode = '42501';
  end if;
  select * into settings from private.access_settings where id;
  if not coalesce(settings.super_code_enabled, false) or settings.super_code_hash is null then
    return 'disabled';
  end if;
  if (select count(*) from private.login_attempts
       where kind = 'super' and not ok and ts > now() - interval '10 minutes') >= 10 then
    return 'locked';
  end if;
  if coalesce(code, '') = '' or settings.super_code_hash <> crypt(code, settings.super_code_hash) then
    insert into private.login_attempts (uid, ok, kind) values (me, false, 'super');
    return 'wrong';
  end if;

  insert into private.login_attempts (uid, ok, kind) values (me, true, 'super');
  insert into public.user_roles (user_id, role, granted_by, granted_at, is_super)
  values (me, 'official', null, now(), true)
  on conflict (user_id) do update
    set role = 'official', is_super = true, granted_by = null, granted_at = now();
  return 'official';
end;
$$;

-- Super only. -----------------------------------------------------------------

create or replace function public.set_official_pin(new_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not private.is_super() then
    raise exception 'only a super official can change the PIN' using errcode = '42501';
  end if;
  if coalesce(new_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'the PIN is 4 digits' using errcode = '22023';
  end if;
  update private.access_settings
     set pin_hash = crypt(new_pin, gen_salt('bf', 10)), updated_at = now(), updated_by = auth.uid()
   where id;
end;
$$;

create or replace function public.set_access_code(new_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not private.is_super() then
    raise exception 'only a super official can change the access code' using errcode = '42501';
  end if;
  if length(coalesce(new_code, '')) < 8 then
    raise exception 'the access code needs at least 8 characters' using errcode = '22023';
  end if;
  update private.access_settings
     set super_code_hash = crypt(new_code, gen_salt('bf', 10)), super_code_enabled = true,
         updated_at = now(), updated_by = auth.uid()
   where id;
end;
$$;

create or replace function public.set_access_code_enabled(enabled boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_super() then
    raise exception 'only a super official can switch the access code' using errcode = '42501';
  end if;
  update private.access_settings
     set super_code_enabled = coalesce(enabled, false), updated_at = now(), updated_by = auth.uid()
   where id;
end;
$$;

create or replace function public.access_status()
returns table (pin_set boolean, code_set boolean, code_enabled boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.pin_hash is not null, s.super_code_hash is not null, s.super_code_enabled, s.updated_at
    from private.access_settings s
   where s.id and private.is_super();
$$;

-- Every device with a name or a staff role (and the caller), for User Management.
create or replace function public.list_users(search text default '')
returns table (
  device_code text, first_name text, last_name text, confirmed boolean,
  role public.user_role, is_super boolean, is_me boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select upper(left(u.id::text, 8)), p.first_name, p.last_name, p.confirmed_at is not null,
         coalesce(r.role, 'resident'::public.user_role), coalesce(r.is_super, false), u.id = auth.uid()
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles r on r.user_id = u.id
   where private.is_super()
     and (p.id is not null or r.role in ('volunteer', 'official') or u.id = auth.uid())
     and (coalesce(search, '') = ''
          or left(u.id::text, 8) ilike trim(search) || '%'
          or (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) ilike '%' || trim(search) || '%')
   order by case coalesce(r.role, 'resident') when 'official' then 0 when 'volunteer' then 1 else 2 end,
            p.last_name nulls last, p.first_name
   limit 300;
$$;

--   42501 not super   22023 bad code   P0002 no such device   P0003 ambiguous
--   SB001 changing yourself
create or replace function public.set_user_role(device_code text, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  if not private.is_super() then
    raise exception 'only a super official can manage users' using errcode = '42501';
  end if;
  if device_code is null or device_code !~ '^[0-9a-fA-F]{8}$' then
    raise exception 'a device code is 8 hex characters' using errcode = '22023';
  end if;
  select array_agg(id) into ids from auth.users where left(id::text, 8) = lower(device_code);
  if ids is null then
    raise exception 'no device has that code' using errcode = 'P0002';
  end if;
  if cardinality(ids) > 1 then
    raise exception 'more than one device has that code' using errcode = 'P0003';
  end if;
  if ids[1] = auth.uid() then
    raise exception 'you cannot change your own role' using errcode = 'SB001';
  end if;
  insert into public.user_roles (user_id, role, granted_by, granted_at)
  values (ids[1], new_role, auth.uid(), now())
  on conflict (user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at,
        is_super = false;
end;
$$;

revoke execute on function public.my_access() from public, anon;
revoke execute on function public.verify_official_pin(text) from public, anon;
revoke execute on function public.redeem_access_code(text) from public, anon;
revoke execute on function public.set_official_pin(text) from public, anon;
revoke execute on function public.set_access_code(text) from public, anon;
revoke execute on function public.set_access_code_enabled(boolean) from public, anon;
revoke execute on function public.access_status() from public, anon;
revoke execute on function public.list_users(text) from public, anon;
revoke execute on function public.set_user_role(text, public.user_role) from public, anon;
grant execute on function public.my_access() to authenticated;
grant execute on function public.verify_official_pin(text) to authenticated;
grant execute on function public.redeem_access_code(text) to authenticated;
grant execute on function public.set_official_pin(text) to authenticated;
grant execute on function public.set_access_code(text) to authenticated;
grant execute on function public.set_access_code_enabled(boolean) to authenticated;
grant execute on function public.access_status() to authenticated;
grant execute on function public.list_users(text) to authenticated;
grant execute on function public.set_user_role(text, public.user_role) to authenticated;
