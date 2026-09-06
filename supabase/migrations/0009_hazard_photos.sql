-- Phase 6 — Hazard Reports (PRD §7.7).

-- ---------------------------------------------------------------------------
-- 1. Close the same attribution hole that 0007 closed for rescue requests
-- ---------------------------------------------------------------------------
--
-- `insert_hazards` accepted `reported_by IS NULL`, so any caller could file an
-- unattributed report. That is not merely untidy — it breaks a stated
-- requirement. FR-7.2 says a report is resolvable by its reporter, and
-- `resolve_hazards` is scoped to `reported_by = auth.uid() or is_staff()`. A
-- row with a null owner therefore lands successfully and can never be resolved
-- by the person who filed it: they would watch their own cleared hazard sit in
-- the feed indefinitely, exactly the way an unattributed SOS became invisible
-- to its sender.
--
-- The client already stamps this (OWNER_COLUMN in lib/offlineQueue.ts), so the
-- null branch only ever enabled the failure. No login is added: every caller
-- already holds an anonymous auth.uid().
drop policy insert_hazards on public.hazard_reports;

create policy insert_hazards on public.hazard_reports for insert to authenticated
  with check (reported_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Photo storage
-- ---------------------------------------------------------------------------
--
-- PRIVATE, not public. A hazard photo shows somebody's street, and often their
-- house and belongings, taken at the worst moment of their year. A public
-- bucket hands out a permanent unauthenticated URL for that, which sits badly
-- next to the rest of §9 — where even vulnerability tags are staff-only.
-- Authenticated reads cost one signed URL and keep the material inside the
-- barangay.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hazard-photos',
  'hazard-photos',
  false,
  -- 5 MB. Generous for a phone photo, and a hard stop on a device with a
  -- misbehaving camera filling a resident's storage quota mid-storm.
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Objects are keyed `<uid>/<hazard id>`, so the owner is provable from the
-- path itself rather than from a column a client could set.
create policy hazard_photo_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'hazard-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Any signed-in resident may look. A hazard photo is community information —
-- the whole point is that a neighbour can see the blocked road for themselves.
create policy hazard_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'hazard-photos');

-- Deleting is the uploader's own business only; there is no moderation queue
-- (FR-7.1), so nobody else gets to remove someone's evidence.
create policy hazard_photo_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'hazard-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 3. Feed ordering
-- ---------------------------------------------------------------------------
create index hazard_open_by_time
  on public.hazard_reports (ts desc)
  where status = 'open';
