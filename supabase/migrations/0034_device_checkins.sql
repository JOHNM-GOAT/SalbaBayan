-- ---------------------------------------------------------------------------
-- Counting people in by scanning their phone's QR (ME tab)
-- ---------------------------------------------------------------------------
-- A volunteer at the hall scans a resident's device QR, enters how many people
-- came with that phone, and the hall's headcount goes up by that many.
--
-- A phone counts once per evacuation: a second scan within 3 days is stored
-- (it happened) but marked counted = false and adds nothing. The decision is
-- made HERE, not only on the phone, because scans are queued offline and two
-- volunteers can scan the same phone with no signal between them.
--
-- Written through the offline queue, which flushes with ON CONFLICT DO NOTHING.
-- A BEFORE INSERT trigger still fires on such a retry, so the headcount row
-- reuses this row's id and is itself ON CONFLICT DO NOTHING: a retried flush
-- can never add the same family twice.

create table public.device_checkins (
  id             uuid primary key,
  device_code    text not null check (device_code ~ '^[0-9A-F]{8}$'),
  evac_center_id uuid not null references public.evac_centers (id) on delete cascade,
  people         integer not null check (people between 1 and 50),
  counted        boolean not null default true,
  ts             timestamptz not null default now(),
  scanned_by     uuid references auth.users (id)
);

create index device_checkins_by_code on public.device_checkins (device_code, ts desc);

alter table public.device_checkins enable row level security;

create policy read_device_checkins on public.device_checkins for select to authenticated
  using (private.is_staff());

create policy insert_device_checkins on public.device_checkins for insert to authenticated
  with check (private.is_staff() and scanned_by = auth.uid());

create or replace function private.count_device_checkin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.counted := not exists (
    select 1 from public.device_checkins d
     where d.device_code = new.device_code
       and d.counted
       and d.id <> new.id
       and d.ts > new.ts - interval '3 days'
       and d.ts <= new.ts + interval '3 days'
  );

  if new.counted then
    insert into public.headcounts (id, evac_center_id, delta, ts, recorded_by)
    values (new.id, new.evac_center_id, new.people, new.ts, new.scanned_by)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

create trigger count_device_checkin
  before insert on public.device_checkins
  for each row execute function private.count_device_checkin();

-- ---------------------------------------------------------------------------
-- Strings (check-in screen, staff only)
-- ---------------------------------------------------------------------------
-- Reviewed languages, Filipino (= Tagalog) and Ilocano. Other machine-translated
-- languages fall back to Tagalog (ci.* is optional in
-- scripts/generate-translations.mjs).

insert into public.translations (message_key, language, text) values
  ('ci.phone', 'en', 'PHONE {n}'),
  ('ci.phone', 'tl', 'TELEPONO {n}'),
  ('ci.phone', 'ceb', 'TELEPONO {n}'),
  ('ci.phone', 'fil', 'TELEPONO {n}'),
  ('ci.phone', 'ilo', 'TELEPONO {n}'),

  ('ci.how_many', 'en', 'How many people came with this phone?'),
  ('ci.how_many', 'tl', 'Ilang tao ang kasama ng teleponong ito?'),
  ('ci.how_many', 'ceb', 'Pila ka tawo ang kauban niining teleponoha?'),
  ('ci.how_many', 'fil', 'Ilang tao ang kasama ng teleponong ito?'),
  ('ci.how_many', 'ilo', 'Mano a tattao ti kadua daytoy a telepono?'),

  ('ci.hold_count', 'en', 'Hold to count {n} in'),
  ('ci.hold_count', 'tl', 'Pindutin nang matagal para bilangin ang {n}'),
  ('ci.hold_count', 'ceb', 'Pindota ug dugay aron ihap ang {n}'),
  ('ci.hold_count', 'fil', 'Pindutin nang matagal para bilangin ang {n}'),
  ('ci.hold_count', 'ilo', 'Ipindot a nabayag tapno bilangen ti {n}'),

  ('ci.counted', 'en', '{n} counted in.'),
  ('ci.counted', 'tl', '{n} ang nabilang.'),
  ('ci.counted', 'ceb', '{n} ang naihap.'),
  ('ci.counted', 'fil', '{n} ang nabilang.'),
  ('ci.counted', 'ilo', '{n} ti nabilang.'),

  ('ci.already', 'en', 'Already checked in: {n}. Not counted again.'),
  ('ci.already', 'tl', 'Naka-check in na: {n}. Hindi na bibilangin muli.'),
  ('ci.already', 'ceb', 'Naka-check in na: {n}. Dili na ihapon pag-usab.'),
  ('ci.already', 'fil', 'Naka-check in na: {n}. Hindi na bibilangin muli.'),
  ('ci.already', 'ilo', 'Naka-check in on: {n}. Saanen a bilangen manen.')
on conflict (message_key, language) do update set text = excluded.text;
