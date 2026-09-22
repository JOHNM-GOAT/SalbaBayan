-- ---------------------------------------------------------------------------
-- Resident names, and staff confirmation
-- ---------------------------------------------------------------------------
-- Every device may give a first and last name (required) and an address
-- (optional). A typed name is only a claim, so a volunteer or official
-- CONFIRMS it — at the hall, scanning the person's ME-tab QR — and reports
-- show staff CONFIRMED or UNCONFIRMED.
--
--   * Hazard and water reports will need a name on file — migration 0039,
--     applied with the app release that asks for the name. SOS never does:
--     it goes out marked "name not given".
--   * Names and addresses are readable by the person themselves and by staff
--     only (Data Privacy Act, RA 10173). The public hazard map stays anonymous.
--   * Changing the first or last name clears the confirmation, so a confirmed
--     phone cannot be renamed into someone else. Address edits keep it.
--   * Only confirm_resident() can set the confirmation; a device's own
--     updates can never set or keep a confirmation they did not earn.
--
-- `id` is the device's own uid. Named `id` because every write goes through
-- the offline queue, which keys rows by `id`.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  first_name   text not null check (length(trim(first_name)) between 1 and 60),
  last_name    text not null check (length(trim(last_name)) between 1 and 60),
  address      text check (address is null or length(address) <= 160),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy read_profiles on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_staff());

create policy insert_own_profile on public.profiles for insert to authenticated
  with check (id = auth.uid() and confirmed_at is null and confirmed_by is null);

create policy update_own_profile on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Security INVOKER on purpose: current_user is then the caller for a device's
-- own update, and the function owner only inside confirm_resident().
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if current_user in ('authenticated', 'anon') then
    new.confirmed_at := old.confirmed_at;
    new.confirmed_by := old.confirmed_by;
    new.created_at := old.created_at;
    if (trim(new.first_name), trim(new.last_name)) is distinct from (trim(old.first_name), trim(old.last_name)) then
      new.confirmed_at := null;
      new.confirmed_by := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

-- Staff only. By the device code shown on the person's ME tab.
--   42501 not staff   22023 bad code   P0002 no name on file for that code
--   SB001 confirming yourself
create or replace function public.confirm_resident(device_code text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ids uuid[];
begin
  if not private.is_staff() then
    raise exception 'only volunteers and officials can confirm residents' using errcode = '42501';
  end if;
  if device_code is null or device_code !~ '^[0-9a-fA-F]{8}$' then
    raise exception 'a device code is 8 hex characters' using errcode = '22023';
  end if;
  select array_agg(p.id) into ids from public.profiles p
   where left(p.id::text, 8) = lower(device_code);
  if ids is null or cardinality(ids) <> 1 then
    raise exception 'no name on file for that device' using errcode = 'P0002';
  end if;
  if ids[1] = auth.uid() then
    raise exception 'you cannot confirm yourself' using errcode = 'SB001';
  end if;
  update public.profiles set confirmed_at = now(), confirmed_by = auth.uid() where id = ids[1];
end;
$$;

revoke execute on function public.confirm_resident(text) from public, anon;
grant execute on function public.confirm_resident(text) to authenticated;

-- Staff reading a scanned phone: its name, if any (the check-in card).
create or replace function public.profile_for_device(device_code text)
returns table (first_name text, last_name text, address text, confirmed_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.first_name, p.last_name, p.address, p.confirmed_at
    from public.profiles p
   where private.is_staff()
     and device_code ~ '^[0-9a-fA-F]{8}$'
     and left(p.id::text, 8) = lower(device_code)
   limit 1;
$$;

revoke execute on function public.profile_for_device(text) from public, anon;
grant execute on function public.profile_for_device(text) to authenticated;
