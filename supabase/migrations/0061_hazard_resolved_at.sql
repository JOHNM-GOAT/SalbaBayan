-- When a hazard was cleared.
--
-- `resolved_by` (0060) answered who; this answers when, and the FIXED tab
-- needs it to be in any order at all. Water already records `cleared_at`, so
-- the list was sorting one kind by when it was dealt with and the other by
-- when it was REPORTED — a tree reported on Monday and cut up this morning sat
-- below a puddle reported an hour ago and cleared an hour ago. An official
-- looking for "what have we just finished" was reading a list ordered by
-- something else entirely.
--
-- Stamped by the same trigger and on the same terms as `resolved_by`: set from
-- the server's clock when the report crosses into 'resolved', preserved
-- afterwards, and never taken from the request body. `now()` rather than the
-- client's clock because a phone's time can be wrong by hours and this is what
-- the barangay's record of the storm will be ordered by.

alter table public.hazard_reports
  add column if not exists resolved_at timestamptz;

comment on column public.hazard_reports.resolved_at is
  'When this was marked fixed. Stamped by stamp_hazard_resolver(); never accepted from the client.';

create or replace function public.stamp_hazard_resolver()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'resolved' then
    if old.status = 'resolved' then
      -- Already cleared. Who cleared it and when do not change afterwards, and
      -- a later PATCH must not be able to rewrite the record of either.
      new.resolved_by := old.resolved_by;
      new.resolved_at := old.resolved_at;
    else
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    end if;
  else
    -- Back to open (nothing does this today, and if anything ever does, the
    -- report is open again and nobody has cleared it).
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

-- Rows resolved before this migration have no resolution time and must not
-- invent one. The dashboard falls back to the report time for them, which is
-- the only thing those rows actually know.
