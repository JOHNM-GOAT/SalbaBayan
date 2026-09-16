-- The official sets the advisory (PRD §4), and every change is recorded.
--
-- Until now nothing in the app could change current_signal_level, storm_name,
-- bulletin_no, wind_kph or evacuate_by — the headline instruction every
-- resident reads could only be changed with SQL. The app now writes these
-- through the offline queue as a single UPDATE on barangays, and this migration
-- makes that update accountable.
--
-- The history is written by a TRIGGER, not by the client, and that is the whole
-- design. A client-written history row is a second write: it can land while the
-- change behind it is refused, or be skipped entirely by a patched client, and
-- an audit log that a client can decline to write is not an audit log. Inside
-- the trigger, the history row commits or rolls back with the change itself.

-- ---------------------------------------------------------------------------
-- 1. The history
-- ---------------------------------------------------------------------------

create table public.signal_history (
  id           uuid primary key default gen_random_uuid(),
  barangay_id  uuid not null references public.barangays (id) on delete cascade,
  level        smallint not null check (level between 0 and 5),
  storm_name   text,
  bulletin_no  smallint check (bulletin_no > 0),
  wind_kph     smallint check (wind_kph >= 0),
  evacuate_by  timestamptz,
  -- Null when the change was made outside the app (the SQL editor has no
  -- auth.uid()). Recorded as unknown rather than refused.
  set_by       uuid references auth.users (id),
  -- When the official tapped. For a change queued offline this can be hours
  -- before received_at, and an audit needs both.
  set_at       timestamptz,
  -- When it reached Postgres — the earliest moment residents could be told.
  received_at  timestamptz not null default now()
);

create index signal_history_by_barangay
  on public.signal_history (barangay_id, received_at desc);

alter table public.signal_history enable row level security;

-- Officials only (spec decision 4). There are deliberately NO insert, update or
-- delete policies: rows come only from the trigger below, which runs as the
-- function owner and is not subject to RLS. No client can write, edit or erase
-- history — including an official.
create policy read_signal_history on public.signal_history
  for select to authenticated
  using (private.is_official());

-- ---------------------------------------------------------------------------
-- 2. Leave-by is required at evacuation level
-- ---------------------------------------------------------------------------
--
-- The 3 here is EVACUATION_SIGNAL in src/lib/advisory.ts, and EVACUATION_LEVEL
-- in src/lib/advisoryForm.ts. Change one, change all three: the app decides
-- when to show the leave-by countdown from that constant, and this decides when
-- a deadline must exist for it to count down to. scripts/advisory-test.mjs
-- fails if they disagree.
--
-- A violation is SQLSTATE 23514, which src/lib/queuePolicy.ts treats as
-- permanent — a queued change without a deadline is blocked visibly on the
-- official's screen instead of retrying forever.

alter table public.barangays
  add constraint leave_by_at_evacuation
    check (current_signal_level < 3 or evacuate_by is not null);

-- ---------------------------------------------------------------------------
-- 3. Stamp who changed it
-- ---------------------------------------------------------------------------
--
-- An "advisory change" is a change to any of the five columns a resident's
-- placard is drawn from. Updating default_language or expected_households is
-- not one, and must not produce a history row that reads as a signal change.

create function private.stamp_signal_setter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.current_signal_level, new.storm_name, new.bulletin_no, new.wind_kph, new.evacuate_by)
     is distinct from
     (old.current_signal_level, old.storm_name, old.bulletin_no, old.wind_kph, old.evacuate_by)
  then
    -- The server says who did it. The client is never asked.
    new.signal_set_by := auth.uid();

    -- The app always sends a fresh tap time. An edit that did not (the SQL
    -- editor) gets the arrival time, so history never copies a stale one.
    if new.signal_set_at is not distinct from old.signal_set_at then
      new.signal_set_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger barangays_stamp_signal_setter
  before update on public.barangays
  for each row
  execute function private.stamp_signal_setter();

-- ---------------------------------------------------------------------------
-- 4. Record it
-- ---------------------------------------------------------------------------

create function private.record_signal_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.signal_history
    (barangay_id, level, storm_name, bulletin_no, wind_kph, evacuate_by, set_by, set_at)
  values
    (new.id, new.current_signal_level, new.storm_name, new.bulletin_no,
     new.wind_kph, new.evacuate_by, new.signal_set_by, new.signal_set_at);

  return null;
end;
$$;

create trigger barangays_record_signal_history
  after update on public.barangays
  for each row
  when (
    (new.current_signal_level, new.storm_name, new.bulletin_no, new.wind_kph, new.evacuate_by)
    is distinct from
    (old.current_signal_level, old.storm_name, old.bulletin_no, old.wind_kph, old.evacuate_by)
  )
  execute function private.record_signal_history();

-- No EXECUTE grant: Postgres does not check it on trigger functions when they
-- fire. Both live in `private`, which PostgREST does not expose, so neither is
-- reachable at /rest/v1/rpc/.

comment on table public.signal_history is
  'Append-only record of every advisory change, written only by the '
  'barangays_record_signal_history trigger. Officials may read it; nobody may '
  'write, edit or delete it through the API.';
