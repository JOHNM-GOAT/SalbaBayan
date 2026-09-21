-- ---------------------------------------------------------------------------
-- Starting a new evacuation
-- ---------------------------------------------------------------------------
-- The hall's headcount is a ledger summed forever, so the next typhoon would
-- have started from the last one's number. An official now marks the start of
-- an evacuation; the headcount and the "already counted" check on phone scans
-- count only from that moment. The ledger itself is never deleted — it is the
-- audit trail of the last storm.
--
-- A column on barangays, not a table, so it rides the advisory snapshot: cached
-- on every phone, readable offline, and pushed live to open phones. Only an
-- official can set it — restrict_staff_barangay_update (0026) already refuses a
-- volunteer any change except the household count — and it is not one of the
-- advisory columns, so setting it does not write signal history.

alter table public.barangays add column evacuation_started_at timestamptz;

create or replace function private.count_device_checkin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  started timestamptz := (select b.evacuation_started_at
                            from public.evac_centers c
                            join public.puroks p on p.id = c.purok_id
                            join public.barangays b on b.id = p.barangay_id
                           where c.id = new.evac_center_id);
begin
  new.counted := not exists (
    select 1 from public.device_checkins d
     where d.device_code = new.device_code
       and d.counted
       and d.id <> new.id
       and d.ts > greatest(new.ts - interval '3 days', coalesce(started, '-infinity'))
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

-- ---------------------------------------------------------------------------
-- Strings (headcount screen). evac.* falls back to Tagalog in the
-- machine-translated languages, like roles.* and ci.*.
-- ---------------------------------------------------------------------------

insert into public.translations (message_key, language, text) values
  ('evac.since', 'en', 'COUNTING SINCE {n}'),
  ('evac.since', 'tl', 'BINIBILANG MULA {n}'),
  ('evac.since', 'ceb', 'GIIHAP SUKAD {n}'),
  ('evac.since', 'fil', 'BINIBILANG MULA {n}'),
  ('evac.since', 'ilo', 'MABILBILANG MANIPUD {n}'),

  ('evac.new', 'en', 'START NEW EVACUATION'),
  ('evac.new', 'tl', 'SIMULAN ANG BAGONG PAGLIKAS'),
  ('evac.new', 'ceb', 'SUGDI ANG BAG-ONG PAGBAKWIT'),
  ('evac.new', 'fil', 'SIMULAN ANG BAGONG PAGLIKAS'),
  ('evac.new', 'ilo', 'RUGIAN TI BARO A PANAGBAKWIT'),

  ('evac.new_hint', 'en', 'The count starts again from 0 and every phone can be scanned in again. The old count stays in the history.'),
  ('evac.new_hint', 'tl', 'Magsisimula muli sa 0 ang bilang at puwedeng i-scan muli ang bawat telepono. Mananatili sa kasaysayan ang lumang bilang.'),
  ('evac.new_hint', 'ceb', 'Magsugod pag-usab sa 0 ang ihap ug ma-scan pag-usab ang matag telepono. Magpabilin sa kasaysayan ang daan nga ihap.'),
  ('evac.new_hint', 'fil', 'Magsisimula muli sa 0 ang bilang at puwedeng i-scan muli ang bawat telepono. Mananatili sa kasaysayan ang lumang bilang.'),
  ('evac.new_hint', 'ilo', 'Mangrugi manen iti 0 ti bilang ket mabalin manen nga i-scan ti tunggal telepono. Agtalinaed iti pakasaritaan ti daan a bilang.'),

  ('evac.hold_new', 'en', 'Press and hold to start from 0'),
  ('evac.hold_new', 'tl', 'Pindutin nang matagal para magsimula sa 0'),
  ('evac.hold_new', 'ceb', 'Pindota ug dugay aron magsugod sa 0'),
  ('evac.hold_new', 'fil', 'Pindutin nang matagal para magsimula sa 0'),
  ('evac.hold_new', 'ilo', 'Ipindot a nabayag tapno mangrugi iti 0')
on conflict (message_key, language) do update set text = excluded.text;
