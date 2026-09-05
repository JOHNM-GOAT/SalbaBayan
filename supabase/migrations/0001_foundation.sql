-- SalbaBayan — Phase 0 foundation schema
-- Source of truth: stage-2/PRD-detailed.md §6.3 (data model), §4.2 (permission matrix)
--
-- Auth model: every client signs in anonymously, so every caller is the
-- `authenticated` Postgres role with a real auth.uid(). No login screen is ever
-- shown. Roles are granted by an official inserting a row into user_roles;
-- absence of a row means `resident`, the least-privileged default.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('resident', 'volunteer', 'official');

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role    public.user_role not null default 'resident',
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now()
);

-- SECURITY DEFINER so the policy check itself is not subject to RLS on
-- user_roles, which would otherwise recurse. search_path is pinned to prevent
-- a malicious schema from shadowing the table.
create function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid()),
    'resident'::public.user_role
  );
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_name() in ('volunteer', 'official');
$$;

create function public.is_official()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_role_name() = 'official';
$$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table public.barangays (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  municipality         text not null,
  province             text not null,
  -- The single value every advisory read joins against (PRD FR-1.2).
  -- 0 = no active signal. Deliberately NOT nullable: "not configured" is a
  -- real state the UI must show, and null would let it read as "safe".
  current_signal_level smallint not null default 0
    check (current_signal_level between 0 and 5),
  signal_set_at        timestamptz,
  signal_set_by        uuid references auth.users (id)
);

create table public.puroks (
  id              uuid primary key default gen_random_uuid(),
  barangay_id     uuid not null references public.barangays (id) on delete cascade,
  name            text not null,
  boundary_geojson jsonb,
  unique (barangay_id, name)
);

create table public.evac_centers (
  id       uuid primary key default gen_random_uuid(),
  purok_id uuid not null references public.puroks (id) on delete cascade,
  name     text not null,
  capacity integer not null check (capacity > 0)
);

create table public.translations (
  message_key text not null,
  language    text not null,
  text        text not null,
  primary key (message_key, language)
);

create table public.protocols (
  id            uuid primary key default gen_random_uuid(),
  purok_id      uuid not null references public.puroks (id) on delete cascade,
  signal_level  smallint not null check (signal_level between 1 and 5),
  route         text,
  route_geojson jsonb,
  evac_center_id uuid references public.evac_centers (id) on delete set null,
  -- Resolves through translations by the resident's selected language.
  action_key    text not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  -- One protocol per cell of the Purok x Signal matrix.
  unique (purok_id, signal_level)
);

create table public.residents (
  id                 uuid primary key default gen_random_uuid(),
  purok_id           uuid not null references public.puroks (id) on delete cascade,
  name               text not null,
  qr_token           text not null unique,
  -- elderly / infant / medical. Readable by staff only (NFR-4.3).
  vulnerability_tags text[] not null default '{}'
);

create table public.documents (
  filename   text primary key,
  title      text not null,
  content    text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Event data — every one of these is written through the offline queue, so
-- `id` is client-generated and upsert-safe.
-- ---------------------------------------------------------------------------

create table public.water_reports (
  id             uuid primary key,
  purok_id       uuid not null references public.puroks (id) on delete cascade,
  location_label text,
  -- Body-referenced depth scale (PRD FR-6.1). No numeric entry by design.
  level_category text not null check (level_category in ('knee', 'waist', 'chest', 'above_head')),
  ts             timestamptz not null default now(),
  reported_by    uuid references auth.users (id)
);

create table public.hazard_reports (
  id          uuid primary key,
  purok_id    uuid not null references public.puroks (id) on delete cascade,
  category    text not null check (category in ('fallen_tree', 'blocked_road', 'downed_lines', 'flooding', 'other')),
  description text,
  photo_url   text,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  ts          timestamptz not null default now(),
  reported_by uuid references auth.users (id)
);

create table public.rescue_requests (
  id          uuid primary key,
  resident_id uuid references public.residents (id) on delete set null,
  purok_id    uuid references public.puroks (id) on delete set null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  status      text not null default 'pending'
    check (status in ('pending', 'acknowledged', 'rescued', 'cancelled')),
  -- The moment the user tapped, NOT the moment the row arrived. The responder
  -- elapsed timer runs from this (PRD §12).
  ts          timestamptz not null default now(),
  notes       text,
  requested_by uuid references auth.users (id),
  acknowledged_by uuid references auth.users (id),
  acknowledged_at timestamptz
);

-- Append-only ledger. Never updated, never deleted; count is SUM(delta).
-- This is what makes concurrent +1 taps safe without locking (PRD FR-8.2).
create table public.headcounts (
  id             uuid primary key,
  evac_center_id uuid not null references public.evac_centers (id) on delete cascade,
  delta          integer not null check (delta <> 0),
  ts             timestamptz not null default now(),
  recorded_by    uuid references auth.users (id)
);

create table public.checkins (
  id          uuid primary key,
  resident_id uuid not null references public.residents (id) on delete cascade,
  status      text not null check (status in ('checked_in', 'evacuated', 'needs_help')),
  ts          timestamptz not null default now(),
  scanned_by  uuid references auth.users (id)
);

create index on public.protocols (purok_id, signal_level);
create index on public.water_reports (purok_id, ts desc);
create index on public.hazard_reports (purok_id, ts desc);
create index on public.rescue_requests (status, ts);
create index on public.headcounts (evac_center_id);
create index on public.checkins (resident_id, ts desc);

-- ---------------------------------------------------------------------------
-- Row Level Security — the actual role boundary (PRD NFR-5, §11).
-- Enabled on every table. Nothing relies on client-side checks.
-- ---------------------------------------------------------------------------

alter table public.user_roles      enable row level security;
alter table public.barangays       enable row level security;
alter table public.puroks          enable row level security;
alter table public.evac_centers    enable row level security;
alter table public.translations    enable row level security;
alter table public.protocols       enable row level security;
alter table public.residents       enable row level security;
alter table public.documents       enable row level security;
alter table public.water_reports   enable row level security;
alter table public.hazard_reports  enable row level security;
alter table public.rescue_requests enable row level security;
alter table public.headcounts      enable row level security;
alter table public.checkins        enable row level security;

-- Public reference data: everyone reads, only officials write.
create policy read_barangays on public.barangays for select to authenticated using (true);
create policy write_barangays on public.barangays for all to authenticated
  using (public.is_official()) with check (public.is_official());

create policy read_puroks on public.puroks for select to authenticated using (true);
create policy write_puroks on public.puroks for all to authenticated
  using (public.is_official()) with check (public.is_official());

create policy read_centers on public.evac_centers for select to authenticated using (true);
create policy write_centers on public.evac_centers for all to authenticated
  using (public.is_official()) with check (public.is_official());

create policy read_translations on public.translations for select to authenticated using (true);
create policy write_translations on public.translations for all to authenticated
  using (public.is_official()) with check (public.is_official());

create policy read_protocols on public.protocols for select to authenticated using (true);
create policy write_protocols on public.protocols for all to authenticated
  using (public.is_official()) with check (public.is_official());

-- Roles: you may read your own row. Only officials grant roles — this is what
-- stops a resident self-promoting to official (PRD §3).
create policy read_own_role on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_official());
create policy manage_roles on public.user_roles for all to authenticated
  using (public.is_official()) with check (public.is_official());

-- Residents carry vulnerability_tags, so staff only (NFR-4.3).
create policy read_residents on public.residents for select to authenticated
  using (public.is_staff());
create policy write_residents on public.residents for all to authenticated
  using (public.is_official()) with check (public.is_official());

create policy read_documents on public.documents for select to authenticated
  using (public.is_official());
create policy write_documents on public.documents for all to authenticated
  using (public.is_official()) with check (public.is_official());

-- Community reports: anyone submits, everyone reads the feed.
create policy read_water on public.water_reports for select to authenticated using (true);
create policy insert_water on public.water_reports for insert to authenticated
  with check (reported_by = auth.uid() or reported_by is null);

create policy read_hazards on public.hazard_reports for select to authenticated using (true);
create policy insert_hazards on public.hazard_reports for insert to authenticated
  with check (reported_by = auth.uid() or reported_by is null);
-- Resolve: your own report, or any report if you are staff (FR-7.2).
create policy resolve_hazards on public.hazard_reports for update to authenticated
  using (reported_by = auth.uid() or public.is_staff())
  with check (reported_by = auth.uid() or public.is_staff());

-- Rescue: creating one requires no role at all beyond having a session, which
-- every device gets silently. A person in danger is never blocked (FR-4.2).
create policy insert_rescue on public.rescue_requests for insert to authenticated
  with check (true);
-- You see your own request; staff see all of them.
create policy read_rescue on public.rescue_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_staff());
-- Requester may cancel their own; staff may move it through the state machine.
create policy update_rescue on public.rescue_requests for update to authenticated
  using (requested_by = auth.uid() or public.is_staff())
  with check (requested_by = auth.uid() or public.is_staff());

-- Centre operations are staff-only, and the ledger is insert-only: no update
-- and no delete policy exists, so history cannot be rewritten (FR-8.1).
create policy read_headcounts on public.headcounts for select to authenticated using (true);
create policy insert_headcounts on public.headcounts for insert to authenticated
  with check (public.is_staff());

create policy read_checkins on public.checkins for select to authenticated
  using (public.is_staff());
create policy insert_checkins on public.checkins for insert to authenticated
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Realtime (PRD FR-7.3) — push, never poll.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.water_reports;
alter publication supabase_realtime add table public.hazard_reports;
alter publication supabase_realtime add table public.rescue_requests;
alter publication supabase_realtime add table public.headcounts;
alter publication supabase_realtime add table public.protocols;
alter publication supabase_realtime add table public.barangays;
