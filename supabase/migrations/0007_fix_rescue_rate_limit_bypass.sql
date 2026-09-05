-- The SOS rate limit added in 0006 could be bypassed by omitting one field.
--
-- `private.recent_rescue_count()` counts rows `where requested_by = auth.uid()`.
-- Nothing required `requested_by` to be set, so a row inserted with a NULL
-- owner counted against nobody and the limit never fired. Confirmed against the
-- live REST API: seven consecutive inserts all returned 201 against a limit of
-- five, using nothing more exotic than leaving a field out of the JSON body.
--
-- Requiring attribution closes it, and does NOT reintroduce a login: under this
-- auth model every caller already holds an anonymous auth.uid(), so FR-4.2
-- ("no authentication required to create a request") still holds. It also moves
-- a rule the client was following voluntarily into the database, which is where
-- it belonged — the same ownership stamping an earlier bug proved is needed for
-- a resident to read their own request back at all.
--
-- Verified after: five accepted, sixth and seventh rejected 403, and the
-- owner-omitted bypass rejected 403.

drop policy insert_rescue on public.rescue_requests;

create policy insert_rescue on public.rescue_requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and private.recent_rescue_count() < 5
  );
