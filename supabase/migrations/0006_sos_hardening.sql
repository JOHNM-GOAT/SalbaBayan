-- Phase 3 — SOS & Rescue Map (PRD §7.4).
--
-- Two changes, both about the same thing: a distress call must never be
-- blocked, delayed, or silently mis-timed by machinery around it.

-- ---------------------------------------------------------------------------
-- 1. GPS must not be able to block an SOS
-- ---------------------------------------------------------------------------
--
-- `lat` and `lng` were NOT NULL, which quietly made a satellite fix a
-- precondition for asking for help. Indoors, in a concrete house, during a
-- storm, a first fix can take 30+ seconds or never arrive at all — and that is
-- exactly the situation this button exists for. FR-4.1 says one tap; a tap
-- that waits on GPS is not one tap.
--
-- The Purok is already known from onboarding, so a request with no precise fix
-- still tells responders which street to search. "Purok 3, no GPS" is
-- enormously more useful than no request.
alter table public.rescue_requests
  alter column lat drop not null,
  alter column lng drop not null;

comment on column public.rescue_requests.lat is
  'Null when no GPS fix was available. Never block the request on it — purok_id carries the coarse location.';

-- ---------------------------------------------------------------------------
-- 2. A server-stamped timestamp, separate from the tap time
-- ---------------------------------------------------------------------------
--
-- `ts` is the moment the human pressed the button. It is supplied by the
-- client on purpose: a request queued offline for forty minutes must show a
-- forty-minute wait on the responder map, not a zero-second one. That is the
-- Phase 3 gate.
--
-- But precisely because it is client-supplied, `ts` cannot be trusted for rate
-- limiting — a client could backdate it to slip past any window. So arrival
-- time is recorded separately and stamped by Postgres, where the client cannot
-- reach it.
alter table public.rescue_requests
  add column created_at timestamptz not null default now();

comment on column public.rescue_requests.ts is
  'When the resident tapped. Client-supplied, may predate arrival by hours. Drives the responder elapsed timer.';
comment on column public.rescue_requests.created_at is
  'When the row reached Postgres. Server-stamped and un-forgeable. Used for rate limiting only.';

-- ---------------------------------------------------------------------------
-- 3. Rate limiting (FR-4.6)
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, and in `private` rather than `public`, for the same two
-- reasons as the other RLS helpers (see 0003): the policy must be able to read
-- the table it guards without recursing through that table's own RLS, and
-- nothing here should be exposed at /rest/v1/rpc/.
--
-- The limit is deliberately loose. Over-restricting a distress call is a far
-- worse failure than letting a few duplicates through: a resident tapping
-- repeatedly because they are frightened and unsure it worked is the expected
-- behaviour, not abuse. Five per hour per device stops a runaway loop or a
-- malicious script while staying far above anything a real person in trouble
-- would produce.
create function private.recent_rescue_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.rescue_requests
  where requested_by = auth.uid()
    and created_at > now() - interval '1 hour';
$$;

-- EXECUTE must stay granted to `authenticated`. Postgres evaluates an RLS
-- policy expression with the CALLER's privileges, so revoking it here would
-- leave the policy unable to call the function it depends on, and every SOS
-- insert would fail with a 403. (0003 documented this and it was still
-- repeated once here — the revoke is what keeps it written down.)
-- What actually hides the helper from /rest/v1/rpc/ is the `private` schema
-- being outside PostgREST's exposed schemas, not a grant.
grant execute on function private.recent_rescue_count() to authenticated;

drop policy insert_rescue on public.rescue_requests;

create policy insert_rescue on public.rescue_requests for insert to authenticated
  with check (
    -- Still no role requirement: any resident may raise a request (FR-4.2).
    -- Anonymous devices are `authenticated` under this auth model.
    private.recent_rescue_count() < 5
  );

-- ---------------------------------------------------------------------------
-- 4. Responder queue ordering
-- ---------------------------------------------------------------------------
--
-- The responder view sorts by wait time across every active request, which is
-- the one query that runs constantly during an event.
create index rescue_active_by_wait
  on public.rescue_requests (ts)
  where status in ('pending', 'acknowledged');
