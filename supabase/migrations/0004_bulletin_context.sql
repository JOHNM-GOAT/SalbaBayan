-- Phase 1 — Advisory Core.
--
-- Adds the bulletin context an official records alongside the signal level.
-- Every column is nullable on purpose: an official raising the signal in a
-- hurry must not be blocked on filling in a wind speed, and the advisory view
-- has to degrade cleanly when they do not. The one exception is
-- `default_language`, which FR-3.5 requires to be *configured* rather than
-- hard-coded, so it carries a barangay-level default.

alter table public.barangays
  -- Bulletin provenance, shown so a resident can tell whether the advisory
  -- they are reading matches the bulletin they heard on the radio (FR-2.3).
  add column storm_name  text,
  add column bulletin_no smallint check (bulletin_no > 0),
  add column wind_kph    smallint check (wind_kph >= 0),

  -- FR-2.7: evacuation-level signals show a leave-by deadline and remaining
  -- time. Stored as an absolute instant, not a duration, so every device
  -- counts down to the same moment regardless of when it last synced — a
  -- cached advisory that silently restarted its countdown would be worse than
  -- no countdown at all.
  add column evacuate_by timestamptz,

  -- FR-3.5: the language a message falls back to when it has no translation
  -- in the resident's selection. Configured per barangay because the right
  -- fallback in Laguna is not the right fallback in Leyte.
  add column default_language text not null default 'tl';

comment on column public.barangays.evacuate_by is
  'Absolute deadline for residents to have left. Null when the current signal '
  'level does not warrant evacuation.';

-- Bring the San Isidro fixture in line with the approved advisory design.
-- The deadline is relative to application time so the countdown renders in a
-- live state during a demo rather than as a permanently expired timestamp.
update public.barangays
set storm_name  = 'Igme',
    bulletin_no = 8,
    wind_kph    = 175,
    evacuate_by = now() + interval '3 hours'
where name = 'San Isidro';
