-- Phase 7 — Evacuation Centre Headcount Tracking (PRD §7.8).

-- ---------------------------------------------------------------------------
-- 1. The same attribution gap, in the two remaining tables that have it
-- ---------------------------------------------------------------------------
--
-- `insert_headcounts` and `insert_checkins` both required staff, but neither
-- required the recorder to be the person recording. This is the third and
-- fourth instance of the pattern 0007 and 0009 fixed for rescue requests and
-- hazards; they are done together here so the class is finally closed.
--
-- It matters more on the ledger than anywhere else. The headcount screen tells
-- a volunteer the ledger is APPEND-ONLY and cannot be erased, which is the
-- entire reason a count assembled by several people in a crowded hall can be
-- trusted. An entry attributed to nobody — or to somebody else — quietly
-- removes the accountability that claim rests on, while still looking like a
-- complete audit trail.
drop policy insert_headcounts on public.headcounts;

create policy insert_headcounts on public.headcounts for insert to authenticated
  with check (private.is_staff() and recorded_by = auth.uid());

drop policy insert_checkins on public.checkins;

create policy insert_checkins on public.checkins for insert to authenticated
  with check (private.is_staff() and scanned_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Ledger reads
-- ---------------------------------------------------------------------------
--
-- Every read of this table is "the ledger for one centre, newest first", and
-- during an event it runs continuously on every open device.
create index headcount_by_centre
  on public.headcounts (evac_center_id, ts desc);

-- ---------------------------------------------------------------------------
-- 3. Check-in fixtures, so the vulnerability breakdown has something to show
-- ---------------------------------------------------------------------------
--
-- The breakdown beside the headcount cannot come from the ledger: a `+1` is
-- deliberately anonymous, because a volunteer counting people through a door
-- has no time to ask who each one is. It comes from `checkins` joined to
-- `residents.vulnerability_tags` — which is Phase 8's data.
--
-- Seeding a few here means the panel demonstrates something true rather than
-- three zeros that look like a broken query. They are marked plainly as
-- fixtures, and the scanner that would create them for real arrives in Phase 8.
insert into public.checkins (id, resident_id, status, ts, scanned_by)
select gen_random_uuid(), r.id, 'checked_in', now() - interval '40 minutes', null
from public.residents r
where r.name in ('Maria Santos', 'Elena Bautista', 'Ana Dela Cruz', 'Roberto Aquino')
on conflict do nothing;
