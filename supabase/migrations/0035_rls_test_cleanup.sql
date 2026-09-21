-- ---------------------------------------------------------------------------
-- The security test cleans up after itself
-- ---------------------------------------------------------------------------
-- scripts/rls-test.mjs runs against the live project, as a throwaway anonymous
-- device, and has to write real rows to prove residents CAN report. Those rows
-- were never removed: by 2026-09-21 every open hazard and every waiting SOS in
-- the barangay was test data (archived in archive.rls_test_*_20260921, then
-- deleted).
--
-- The test now marks what it writes 'rls-test' and calls this at the end. The
-- function can only ever delete the CALLER's own rows carrying that mark, and
-- the caller's own account only if it is anonymous — so it is harmless in
-- anyone else's hands.

create or replace function public.purge_my_rls_test_rows()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;

  delete from public.water_reports   where reported_by  = me and location_label = 'rls-test';
  delete from public.rescue_requests where requested_by = me and notes = 'rls-test';
  delete from public.hazard_reports  where reported_by  = me and description = 'rls-test';

  begin
    delete from auth.users where id = me and is_anonymous;
  exception when foreign_key_violation then
    -- The account still owns real rows; keep it.
    null;
  end;
end;
$$;

revoke execute on function public.purge_my_rls_test_rows() from public, anon;
grant execute on function public.purge_my_rls_test_rows() to authenticated;
