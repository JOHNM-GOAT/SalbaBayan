-- ---------------------------------------------------------------------------
-- A full-access device is "LGU"
-- ---------------------------------------------------------------------------
-- A device given full access by the access code (0042) stands for the LGU,
-- not a person: its name is "LGU" (confirmed), so the app never asks it for a
-- name and staff see "LGU" on anything it sends. Logging out (0044) removes
-- that name, so the device is asked for a real one if a resident uses it.
--
-- "LGU" has no last name, so the last name may now be empty in the database.
-- The app's own form still requires one from everyone else.

alter table public.profiles drop constraint if exists profiles_last_name_check;
alter table public.profiles add constraint profiles_last_name_check
  check (length(trim(last_name)) <= 60);

create or replace function private.make_lgu_profile(target uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.profiles (id, first_name, last_name, address, confirmed_at, confirmed_by)
  values (target, 'LGU', '', null, now(), target)
  on conflict (id) do update
    set first_name = 'LGU', last_name = '', address = null,
        confirmed_at = now(), confirmed_by = target, updated_at = now();
$$;

revoke execute on function private.make_lgu_profile(uuid) from public, anon, authenticated;

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
  perform private.make_lgu_profile(me);
  return 'official';
end;
$$;

create or replace function public.leave_full_access()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.is_super() then
    raise exception 'this device does not have full access' using errcode = '42501';
  end if;
  update public.user_roles
     set role = 'resident', is_super = false, granted_at = now()
   where user_id = auth.uid();
  delete from public.profiles
   where id = auth.uid() and first_name = 'LGU' and last_name = '';
end;
$$;

-- Devices that already used the access code.
select private.make_lgu_profile(user_id) from public.user_roles where is_super;
