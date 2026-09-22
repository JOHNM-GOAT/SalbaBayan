-- Hazard and water reports need a name on file (0038). Applied together with
-- the app release that asks for the name: before it, residents would have had
-- no way to give one and could not report at all. SOS is deliberately
-- untouched (insert_rescue): it always goes out, marked "name not given".

-- Reports need a name on file. SOS (insert_rescue) is deliberately untouched.
drop policy insert_hazards on public.hazard_reports;
create policy insert_hazards on public.hazard_reports for insert to authenticated
  with check (reported_by = auth.uid()
              and exists (select 1 from public.profiles p where p.id = auth.uid()));

drop policy insert_water on public.water_reports;
create policy insert_water on public.water_reports for insert to authenticated
  with check (reported_by = auth.uid()
              and exists (select 1 from public.profiles p where p.id = auth.uid()));
