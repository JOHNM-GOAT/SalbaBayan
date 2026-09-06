-- Phase 9 — Pre-Storm Readiness Checklist (PRD §5.2 F4).
--
-- F4 is "a dashboard computed from existing tables — no new state machine,
-- pure read-side aggregation". Almost true: three of its four checks are
-- computable from what is already there. FR-4.3 ("residents registered
-- against expected population") is not, because nothing records what the
-- expected population IS.
--
-- Without it the check can only say "42 residents registered", which is a
-- number with no meaning attached — 42 out of 45 is a barangay that is ready,
-- 42 out of 400 is one that is not, and the whole point of this screen is to
-- tell those apart before a storm rather than during one.
alter table public.barangays
  add column if not exists expected_households integer
    check (expected_households is null or expected_households > 0);

comment on column public.barangays.expected_households is
  'Denominator for the readiness check. Null means nobody has recorded it, '
  'which the dashboard reports as unknown rather than guessing at.';

update public.barangays
set expected_households = 48
where name = 'San Isidro' and expected_households is null;
