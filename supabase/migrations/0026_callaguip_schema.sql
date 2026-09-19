-- Schema for relocating the app to #5 Callaguip, Batac City, Ilocos Norte.
--
-- Nothing here removes or rewrites data. The geography itself — and clearing
-- the old test records — is 0027, which scripts/generate-callaguip.mjs writes.
-- Keeping them apart means this part can be read on its own: every rule the
-- relocation adds is in this file.

-- ---------------------------------------------------------------------------
-- 1. Where the barangay is, how big it is, and where each area starts
-- ---------------------------------------------------------------------------
--
-- The map screens used to centre on a constant typed into three files. The
-- barangay's own point now travels in the snapshot, so moving the app is a data
-- change rather than a code change.
--
-- `boundary_geojson` is the barangay's outline. It is drawn on the map, and it
-- is what keeps an evacuation centre inside the barangay (section 4).
--
-- `population` is shown to officials with its source, so the figure is never
-- mistaken for a live count. It is not the readiness baseline — that remains
-- `expected_households`, which staff can now update (section 3).

alter table public.barangays
  add column lat double precision,
  add column lng double precision,
  add column boundary_geojson jsonb,
  add column population integer check (population >= 0),
  add column population_source text;

-- Each area's starting point on the street network. Routes begin here. Areas
-- are named after streets until the barangay supplies its Purok list, and a
-- street has no outline, so boundary_geojson on puroks may stay null.
alter table public.puroks
  add column lat double precision,
  add column lng double precision;

-- ---------------------------------------------------------------------------
-- 2. A centre's capacity may be "not set yet"
-- ---------------------------------------------------------------------------
--
-- It was required and positive. The barangay hall's real capacity has not been
-- supplied, and inventing one would drive the headcount's FULL warning from a
-- guess. The existing check (capacity > 0) still applies whenever a value is
-- given; a null passes it.

alter table public.evac_centers
  alter column capacity drop not null;

-- ---------------------------------------------------------------------------
-- 3. Volunteers may set the household count — and nothing else
-- ---------------------------------------------------------------------------
--
-- The readiness dashboard measures registered households against
-- `expected_households`. Volunteers are the people going door to door, so they
-- can now enter it too. Row-level security cannot restrict columns, so the
-- policy lets staff update the row and the trigger refuses any staff change
-- beyond that one column. Officials keep full write access (write_barangays).
--
-- A change made outside the app (auth.uid() is null — the SQL editor, or a
-- migration like 0027) is not an app user and is not restricted here, the same
-- way the history trigger in 0021 records such changes as "outside the app".

create policy staff_set_households on public.barangays
  for update to authenticated
  using (private.is_staff())
  with check (private.is_staff());

create function private.restrict_staff_barangay_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or private.is_official() then
    return new;
  end if;

  if (to_jsonb(new) - 'expected_households') is distinct from
     (to_jsonb(old) - 'expected_households') then
    raise exception 'only an official can change anything but the household count'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Named to sort before barangays_stamp_signal_setter (0021), so the refusal
-- happens before any advisory stamping.
create trigger barangays_restrict_staff_update
  before update on public.barangays
  for each row
  execute function private.restrict_staff_barangay_update();

-- ---------------------------------------------------------------------------
-- 4. An evacuation centre must be inside the barangay
-- ---------------------------------------------------------------------------
--
-- Officials place the centre on the map, and the app refuses a point outside
-- Callaguip before it is saved. This is the same rule again where it cannot be
-- skipped. The error is 23514, which the offline queue treats as permanent, so
-- a refused move shows as REFUSED instead of retrying forever.

create function private.point_in_ring(lng double precision, lat double precision, ring jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  inside boolean := false;
  n int := jsonb_array_length(ring);
  j int := n - 1;
  xi float8; yi float8; xj float8; yj float8;
begin
  for i in 0 .. n - 1 loop
    xi := (ring -> i ->> 0)::float8;
    yi := (ring -> i ->> 1)::float8;
    xj := (ring -> j ->> 0)::float8;
    yj := (ring -> j ->> 1)::float8;
    if ((yi > lat) <> (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    j := i;
  end loop;
  return inside;
end;
$$;

create function private.evac_center_inside_barangay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  outline jsonb;
begin
  if new.lat is null or new.lng is null then
    return new;
  end if;

  select b.boundary_geojson into outline
  from public.puroks p
  join public.barangays b on b.id = p.barangay_id
  where p.id = new.purok_id;

  if outline is null then
    return new;
  end if;

  if not private.point_in_ring(new.lng, new.lat, outline -> 'coordinates' -> 0) then
    raise exception 'an evacuation centre must be inside the barangay'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger evac_centers_inside_barangay
  before insert or update on public.evac_centers
  for each row
  execute function private.evac_center_inside_barangay();

-- ---------------------------------------------------------------------------
-- 5. Geography edits reach open phones
-- ---------------------------------------------------------------------------
--
-- barangays and protocols were already in the realtime publication. Areas and
-- centres were not, so an official moving the evacuation centre would not have
-- reached a resident's open map until a reload.

alter publication supabase_realtime add table public.puroks, public.evac_centers;
