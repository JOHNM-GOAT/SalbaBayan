-- Security hardening: the RLS helpers were in `public`, so PostgREST exposed
-- them as callable RPC endpoints (`/rest/v1/rpc/is_official`). They are
-- internal policy machinery, not API surface.
--
-- Note we cannot simply REVOKE EXECUTE: Postgres evaluates RLS policy
-- expressions with the caller's privileges, so revoking would break every
-- policy that calls them. Moving to a schema PostgREST does not expose is the
-- correct fix, and the one the Supabase linter recommends.
--
-- Clears 6 security advisories (3 functions x anon + authenticated).

create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to anon, authenticated;

create function private.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid()),
    'resident'::public.user_role
  );
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.current_role_name() in ('volunteer', 'official');
$$;

create function private.is_official()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.current_role_name() = 'official';
$$;

drop policy write_barangays    on public.barangays;
drop policy write_puroks       on public.puroks;
drop policy write_centers      on public.evac_centers;
drop policy write_translations on public.translations;
drop policy write_protocols    on public.protocols;
drop policy read_own_role      on public.user_roles;
drop policy manage_roles       on public.user_roles;
drop policy read_residents     on public.residents;
drop policy write_residents    on public.residents;
drop policy read_documents     on public.documents;
drop policy write_documents    on public.documents;
drop policy resolve_hazards    on public.hazard_reports;
drop policy read_rescue        on public.rescue_requests;
drop policy update_rescue      on public.rescue_requests;
drop policy insert_headcounts  on public.headcounts;
drop policy read_checkins      on public.checkins;
drop policy insert_checkins    on public.checkins;

create policy write_barangays on public.barangays for all to authenticated
  using (private.is_official()) with check (private.is_official());
create policy write_puroks on public.puroks for all to authenticated
  using (private.is_official()) with check (private.is_official());
create policy write_centers on public.evac_centers for all to authenticated
  using (private.is_official()) with check (private.is_official());
create policy write_translations on public.translations for all to authenticated
  using (private.is_official()) with check (private.is_official());
create policy write_protocols on public.protocols for all to authenticated
  using (private.is_official()) with check (private.is_official());

create policy read_own_role on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.is_official());
create policy manage_roles on public.user_roles for all to authenticated
  using (private.is_official()) with check (private.is_official());

create policy read_residents on public.residents for select to authenticated
  using (private.is_staff());
create policy write_residents on public.residents for all to authenticated
  using (private.is_official()) with check (private.is_official());

create policy read_documents on public.documents for select to authenticated
  using (private.is_official());
create policy write_documents on public.documents for all to authenticated
  using (private.is_official()) with check (private.is_official());

create policy resolve_hazards on public.hazard_reports for update to authenticated
  using (reported_by = auth.uid() or private.is_staff())
  with check (reported_by = auth.uid() or private.is_staff());

create policy read_rescue on public.rescue_requests for select to authenticated
  using (requested_by = auth.uid() or private.is_staff());
create policy update_rescue on public.rescue_requests for update to authenticated
  using (requested_by = auth.uid() or private.is_staff())
  with check (requested_by = auth.uid() or private.is_staff());

create policy insert_headcounts on public.headcounts for insert to authenticated
  with check (private.is_staff());

create policy read_checkins on public.checkins for select to authenticated
  using (private.is_staff());
create policy insert_checkins on public.checkins for insert to authenticated
  with check (private.is_staff());

drop function public.is_official();
drop function public.is_staff();
drop function public.current_role_name();
