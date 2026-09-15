-- Close the owner-omission bypass on hazard and water reports.
--
-- This is the same hole migration 0007 found and closed on rescue_requests,
-- left open on the two tables beside it. 0001 wrote all three the same way:
--
--   with check (reported_by = auth.uid() or reported_by is null)
--
-- The `or ... is null` was there so a write queued before the anonymous session
-- existed could still be accepted. It is not needed for that, and has not been
-- for some time: the client stamps the owner at enqueue AND re-stamps at flush
-- (see stampOwner in lib/offlineQueue.ts), and flushQueue refuses to send
-- anything at all until there is a uid to stamp with. So no path in the app
-- produces a null-owner report. What the clause actually does is let anyone who
-- can reach the REST API file reports that belong to nobody, by leaving one
-- field out of a JSON body — the identical technique 0007 describes.
--
-- On hazards the consequence is not only attribution. `resolve_hazards` is
-- `reported_by = auth.uid() or private.is_staff()`, so a report with a null
-- owner can be cleared by NOBODY except staff — there is no uid for it to
-- match. An anonymous script can fill the barangay's hazard map with pins that
-- no resident is able to take down, on a feed that has no moderation queue by
-- design (FR-7.1).
--
-- Requiring attribution does not reintroduce a login, for the same reason it
-- did not in 0007: every client here already holds an anonymous auth.uid().
--
-- Existing rows are deliberately left alone. UPDATE and SELECT are untouched,
-- so nothing that is already filed changes or disappears; this constrains what
-- may be inserted from here on. The two null-owner hazards in the demo database
-- are the 0002 seed fixtures, which are inserted by the migration itself and
-- never pass through RLS.

drop policy insert_hazards on public.hazard_reports;

create policy insert_hazards on public.hazard_reports for insert to authenticated
  with check (reported_by = auth.uid());

drop policy insert_water on public.water_reports;

create policy insert_water on public.water_reports for insert to authenticated
  with check (reported_by = auth.uid());

comment on column public.hazard_reports.reported_by is
  'Required on insert. Attribution is what makes an unmoderated feed accountable, and it is also the only thing that lets the reporter resolve their own report — see resolve_hazards.';

comment on column public.water_reports.reported_by is
  'Required on insert. See migration 0019 and the matching rule for rescue_requests in 0007.';
