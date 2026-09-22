-- ---------------------------------------------------------------------------
-- Clearing flood reports — officials only
-- ---------------------------------------------------------------------------
-- A flood report stayed on every map until it aged out. Now an official can
-- clear it, two ways:
--
--   1. WATER GONE on the report itself: sets cleared_at.
--   2. A new reading from an official at the same spot replaces what was
--      there. The older reports within 50 m — and, for ones placed only by
--      street, those on the same street — are cleared by the database, not
--      the app, so every screen agrees. A reading of 'none' (NO WATER) clears
--      the spot and is itself stored already cleared: it is history, not a
--      flood.
--
-- Residents and volunteers keep reporting as before. Their reports add pins;
-- they never clear or replace anything, and 'none' is refused from them.
-- Cleared reports are kept, never deleted.

alter table public.water_reports
  add column cleared_at timestamptz,
  add column cleared_by uuid references auth.users (id) on delete set null;

alter table public.water_reports drop constraint if exists water_reports_level_category_check;
alter table public.water_reports add constraint water_reports_level_category_check
  check (level_category in ('knee', 'waist', 'chest', 'above_head', 'none'));

-- Officials may update a report; the trigger below limits that to clearing it.
create policy clear_water on public.water_reports
  for update to authenticated
  using (private.is_official())
  with check (private.is_official());

create or replace function private.guard_water_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  area_lat double precision;
  area_lng double precision;
begin
  -- Outside the app (SQL editor, migrations): not restricted.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Clearing is the only change, and it is stamped with who did it.
    if (to_jsonb(new) - 'cleared_at' - 'cleared_by') is distinct from
       (to_jsonb(old) - 'cleared_at' - 'cleared_by') then
      raise exception 'a flood report can only be cleared, not changed' using errcode = '42501';
    end if;
    if new.cleared_at is not null and old.cleared_at is null then
      new.cleared_by := auth.uid();
    elsif new.cleared_at is distinct from old.cleared_at then
      raise exception 'a cleared flood report stays cleared' using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  if not private.is_official() then
    if new.level_category = 'none' or new.cleared_at is not null then
      raise exception 'only an official can clear a flood report' using errcode = '42501';
    end if;
    return new;
  end if;

  -- An official's reading replaces the ones already at that spot.
  update public.water_reports w
     set cleared_at = coalesce(new.ts, now()), cleared_by = auth.uid()
   where w.cleared_at is null
     and w.id <> new.id
     and (
       (new.lat is not null and w.lat is not null and
        sqrt(power((w.lat - new.lat) * 110574, 2) +
             power((w.lng - new.lng) * 111320 * cos(radians(new.lat)), 2)) <= 50)
       or (w.lat is null and w.purok_id = new.purok_id)
     );

  if new.level_category = 'none' then
    new.cleared_at := coalesce(new.ts, now());
    new.cleared_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger water_reports_guard
  before insert or update on public.water_reports
  for each row
  execute function private.guard_water_report();

-- Clears must reach open maps as they happen, like new reports do.
alter table public.water_reports replica identity full;

-- ---------------------------------------------------------------------------
-- Strings. dash.* falls back to Tagalog in the other machine languages.
-- ---------------------------------------------------------------------------

insert into public.translations (message_key, language, text) values
  ('dash.water_gone', 'en', 'Press and hold: the water is gone'),
  ('dash.water_gone', 'tl', 'Pindutin nang matagal: wala na ang tubig'),
  ('dash.water_gone', 'ceb', 'Pindota ug dugay: wala na ang tubig'),
  ('dash.water_gone', 'fil', 'Pindutin nang matagal: wala na ang tubig'),
  ('dash.water_gone', 'ilo', 'Ipindot a nabayag: awanen ti danum'),

  ('dash.no_water', 'en', 'NO WATER'),
  ('dash.no_water', 'tl', 'WALANG TUBIG'),
  ('dash.no_water', 'ceb', 'WALAY TUBIG'),
  ('dash.no_water', 'fil', 'WALANG TUBIG'),
  ('dash.no_water', 'ilo', 'AWAN TI DANUM'),

  ('dash.replaces', 'en', 'Replaces the older flood reports at this spot.'),
  ('dash.replaces', 'tl', 'Papalitan nito ang mga lumang ulat ng baha sa lugar na ito.'),
  ('dash.replaces', 'ceb', 'Ilisan niini ang mga daan nga report sa baha niining dapita.'),
  ('dash.replaces', 'fil', 'Papalitan nito ang mga lumang ulat ng baha sa lugar na ito.'),
  ('dash.replaces', 'ilo', 'Sukatanna dagiti daan a report ti layus iti daytoy a lugar.')
on conflict (message_key, language) do update set text = excluded.text;
