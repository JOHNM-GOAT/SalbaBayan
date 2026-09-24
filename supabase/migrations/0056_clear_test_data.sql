-- Clearing the test data out of the live barangay, before Callaguip uses this.
--
-- Everything below names the exact rows it removes, and every statement is
-- guarded so it does nothing to anything else. A cleanup migration that says
-- "set the signal to 0" without a WHERE is a migration that one day clears a
-- real evacuation order in the middle of a storm, because someone re-ran the
-- folder against a live database. These statements can be re-run any number of
-- times and, once the rows named here are gone, do nothing at all.
--
-- What was here, and why it had to go:
--
--   * The advisory read Signal 2, "AGHON", bulletin 12, 150 kph — the synthetic
--     bulletin from testing the PAGASA card (0055). No such storm exists.
--   * Two hazards and three flood readings filed on 22 and 24 September while
--     the report screens were being tried out. One of them said ABOVE HEAD on
--     Smith Street, which is the most alarming thing this app can display.
--   * An evacuation had been open since 22 September, so the hall's headcount
--     had been counting for two days.

/* The advisory, only while it still holds the fixture's values. */
update public.barangays set
  current_signal_level = 0,
  storm_name = null,
  bulletin_no = null,
  wind_kph = null,
  evacuate_by = null,
  signal_set_at = now()
where storm_name = 'AGHON'
  and bulletin_no = 12
  and wind_kph = 150;

/* The evacuation that was never ended. Named by its exact start, so a real
   evacuation opened later is untouchable by this. */
update public.barangays set evacuation_started_at = null
where evacuation_started_at = timestamptz '2026-09-22 12:17:10.405+00';

/*
 * The flood readings. Cleared rather than deleted — that is what an official
 * clearing water does (0051), and the row stays as a record that it was seen.
 * `cleared_by` is left null on purpose: no person did this, and stamping one of
 * the barangay's officials on it would be a small lie in an audit trail.
 */
update public.water_reports set cleared_at = now()
where cleared_at is null
  and id in (
    '891071be-8e6b-4228-89c4-c212259d590d',  -- knee, Asuncion Street
    '97f6f4e4-e967-423a-8ef4-61bd05c08553',  -- above head, Smith Street
    'cc9b8343-ded7-4c2c-bc62-a3d1baa58887'   -- waist, Oeste Street
  );

/* The two hazards, resolved the same way the app resolves them. */
update public.hazard_reports set status = 'resolved'
where status = 'open'
  and id in (
    '7a7b4a57-9b93-4817-b432-e88edc8c9d79',  -- fallen tree
    'b253fc9e-60a9-48f4-a555-7407591d53ad'   -- blocked road
  );
