-- ---------------------------------------------------------------------------
-- 1. The barangay hall holds about 250 people
-- ---------------------------------------------------------------------------
-- Confirmed by the barangay. Officials can still change it from the map
-- (SET EVACUATION CENTRE), which writes the same column.

update public.evac_centers
   set capacity = 250
 where name = '#5 Callaguip Barangay Hall';

-- ---------------------------------------------------------------------------
-- 2. A fingerprint of every translation
-- ---------------------------------------------------------------------------
-- The snapshot is refetched on every live change — each signal, each hazard
-- report — and the translations are ~9,700 rows (~600 KB) that almost never
-- change. Phones ask for this 32-character hash first and download the
-- translations only when it differs from the one they cached with.
--
-- security invoker: the caller's RLS still decides what is readable, so the
-- hash describes exactly the rows that caller would download.

create or replace function public.translations_version()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select md5(coalesce(
    string_agg(message_key || '|' || language || '=' || text, E'\n'
               order by message_key collate "C", language collate "C"),
    ''))
  from public.translations;
$$;

revoke execute on function public.translations_version() from public, anon;
grant execute on function public.translations_version() to authenticated;
