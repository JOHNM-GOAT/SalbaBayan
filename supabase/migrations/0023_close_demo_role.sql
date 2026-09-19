-- Pre-launch cleanup: the test advisory, and the demo self-promotion path.
--
-- ---------------------------------------------------------------------------
-- 1. The live advisory held test data
-- ---------------------------------------------------------------------------
--
-- On 2026-09-16 the new advisory screen was tried on the live barangay, and it
-- was left at Signal 4, storm "asd", 23 kph, with a leave-before deadline that
-- passed the same afternoon. Every resident's placard showed it for days.
--
-- Reset to Signal 0 — "no active signal, keep listening for the next bulletin"
-- — which is what the app shows when nobody has set a real one. It is never
-- drawn as "all clear" (see SIGNAL_STYLES in src/lib/signal.ts).
--
-- Matched on the test storm name, so this touches exactly that state and is a
-- no-op anywhere else, including a freshly built database. The history trigger
-- (0021) records it with set_by null: a change made outside the app.

update public.barangays
set current_signal_level = 0,
    storm_name = null,
    bulletin_no = null,
    wind_kph = null,
    evacuate_by = null
where storm_name = 'asd';

-- ---------------------------------------------------------------------------
-- 2. Revoke every role a device granted itself
-- ---------------------------------------------------------------------------
--
-- set_demo_role (0017) let any device make itself a volunteer or an official,
-- recorded as granted_by = user_id. Seven devices still held elevated roles
-- that way — five volunteers and two officials — and an official can read
-- residents' vulnerability tags and, with 0021, issue a signal to the whole
-- barangay.
--
-- Set back to resident rather than deleted: that is exactly what the demo
-- switch's own demotion does, and it keeps the row inspectable. Roles granted
-- any other way — by SQL (granted_by null) or by another account — are
-- untouched.

update public.user_roles
set role = 'resident'
where granted_by = user_id
  and role in ('volunteer', 'official');

-- ---------------------------------------------------------------------------
-- 3. Close the path
-- ---------------------------------------------------------------------------
--
-- With the function gone, the DEMO switch changes navigation only: setDemoRole
-- (src/lib/supabase.ts) reads PostgREST's PGRST202 as "unavailable" and does
-- not roll the switch back. scripts/rls-test.mjs reports CLOSED and skips the
-- checks that need an official account.
--
-- Roles are granted by an official from here on. Until there is a screen for
-- it, that is an insert into public.user_roles with the device's user id.

drop function if exists public.set_demo_role(public.user_role);
