-- Who cleared a hazard.
--
-- `hazard_reports` recorded that a report was marked fixed and never by whom,
-- so "who said this road is passable?" had no answer at all — not in the app,
-- not in the table. On a downed-power-line report that is the question that
-- matters most, and it was the one question the barangay could not ask.
--
-- The column is stamped by a trigger rather than sent by the client, and that
-- is the whole security of it: the value is `auth.uid()` at the moment the
-- resolve actually lands in Postgres, so it names the device that did it
-- whatever the client puts in the request body. A resolve queued offline and
-- flushed an hour later still names the device that queued it, because it is
-- the same session flushing it.

alter table public.hazard_reports
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

comment on column public.hazard_reports.resolved_by is
  'Who marked this fixed. Stamped by stamp_hazard_resolver(); never accepted from the client.';

create or replace function public.stamp_hazard_resolver()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'resolved' then
    if old.status = 'resolved' then
      -- Already cleared. Who cleared it does not change afterwards, and a
      -- later PATCH must not be able to rewrite the record of it.
      new.resolved_by := old.resolved_by;
    else
      new.resolved_by := auth.uid();
    end if;
  else
    -- Back to open (nothing does this today, and if anything ever does, the
    -- report is open again and nobody has cleared it).
    new.resolved_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_hazard_resolver on public.hazard_reports;
create trigger stamp_hazard_resolver
  before update on public.hazard_reports
  for each row
  execute function public.stamp_hazard_resolver();

-- Rows resolved before this migration have no resolver and must not pretend
-- to: the answer for them is "not recorded", which is what null says.

insert into public.translations (message_key, language, text) values
  ('hazard.cleared_by', 'en', 'Cleared by'),
  ('hazard.cleared_by', 'tl', 'Inayos ni'),
  ('hazard.cleared_by', 'ceb', 'Giayo ni'),
  ('hazard.cleared_by', 'fil', 'Inayos ni'),
  ('hazard.cleared_by', 'ilo', 'Inaywanan ni'),
  ('hazard.cleared_unknown', 'en', 'Cleared before this was recorded'),
  ('hazard.cleared_unknown', 'tl', 'Inayos bago pa ito naitala'),
  ('hazard.cleared_unknown', 'ceb', 'Giayo sa wala pa kini marekord'),
  ('hazard.cleared_unknown', 'fil', 'Inayos bago pa ito naitala'),
  ('hazard.cleared_unknown', 'ilo', 'Naaywanan sakbay a nailista daytoy')
on conflict (message_key, language) do update set text = excluded.text;
