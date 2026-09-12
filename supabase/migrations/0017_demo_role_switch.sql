-- Let the DEMO switch actually grant the role it selects.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE A REAL BARANGAY USES THIS BUILD
-- ---------------------------------------------------------------------------
--
-- This function is a self-promotion path. Any device that can reach the API can
-- call it and make itself a volunteer or an official. That means it can clear a
-- downed-power-line warning, read the resident roster, and mark people as
-- accounted for during a headcount.
--
-- It exists because the product is being demonstrated, the switcher is the
-- thing being demonstrated with, and until now selecting VOLUNTEER changed the
-- tab bar and nothing else — so the volunteer's central action, marking a
-- hazard fixed, could not be shown at all without hand-granting a role to every
-- device in the room. The team weighed that against the hole and chose this,
-- with the hole stated.
--
-- To close it for a real deployment, drop the function:
--
--   drop function if exists public.set_demo_role(public.user_role);
--
-- Nothing else depends on it. Roles then go back to being granted by an
-- official inserting a row into user_roles, which is what 0001 describes and
-- what every RLS policy in the schema is still written against. The switcher
-- degrades to what it was: navigation only.
--
-- What this deliberately does NOT do is weaken any policy. `private.is_staff()`
-- and `private.is_official()` are untouched, every table's RLS is untouched,
-- and the function cannot grant a role to anyone but its own caller — so a
-- device can promote itself and nobody else, and removing the function removes
-- the capability completely.

create or replace function public.set_demo_role(target public.user_role)
returns public.user_role
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.user_roles (user_id, role, granted_by)
  values (auth.uid(), target, auth.uid())
  on conflict (user_id) do update
    set role = excluded.role,
        granted_by = excluded.granted_by,
        granted_at = now()
  returning role;
$$;

-- `authenticated` only. Every client here signs in anonymously, so this is not
-- a meaningful restriction on its own — it just keeps the function off the
-- anonymous REST surface, where it would be reachable without even a session.
revoke all on function public.set_demo_role(public.user_role) from public;
grant execute on function public.set_demo_role(public.user_role) to authenticated;

comment on function public.set_demo_role(public.user_role) is
  'DEMO ONLY. Lets a device grant itself a role so the actor switcher can '
  'show all three roles end to end. Drop this function before a real '
  'deployment; see migration 0017 for why and for what it does not touch.';
