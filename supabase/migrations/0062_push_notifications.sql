-- Notifications that arrive when the app is closed.
--
-- Everything this product does to raise an alarm has, until now, required
-- somebody to already be looking at it. The tab badge, the dashboard queue and
-- the alarm sound all need the app open, and at two in the morning — which is
-- when a river rises — a phone is in a pocket. A warning system that can only
-- warn the people already watching is not finished.
--
-- Web Push closes that. The subscription below is the endpoint a browser gives
-- us to reach one device; the message is signed with a VAPID key pair so the
-- push service knows the sender is us.

create table if not exists public.push_subscriptions (
  -- A client-generated id, because the offline queue upserts on `id` and
  -- updates by `id` — and every write in this app goes through that queue
  -- (scripts/check-write-paths.mjs enforces it).
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The browser hands out a new endpoint whenever it re-subscribes, so this is
  -- unique but not the identity: a device that re-subscribes keeps its row.
  endpoint text not null unique,
  -- The device's public key and auth secret, for the payload encryption.
  p256dh text not null,
  auth text not null,
  /*
   * Switched off rather than deleted. The queue can insert and update; it has
   * no delete, and a subscription that could not be turned off would keep a
   * volunteer receiving alerts after they had asked not to. The sender prunes
   * endpoints the push service reports as gone, which is the other half of it:
   * this flag is the person's choice, that is the browser's.
   */
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user
  on public.push_subscriptions (user_id) where active;

alter table public.push_subscriptions enable row level security;

/*
 * A device manages its OWN subscriptions and can see nobody else's.
 *
 * There is no staff exception here, deliberately. An endpoint is a capability:
 * anyone holding one can send that phone a notification, so the list of who
 * can be reached is not something an official needs and not something a
 * compromised official account should be able to take. The sender runs with
 * the service role inside an Edge Function, outside RLS entirely.
 */
drop policy if exists read_own_push on public.push_subscriptions;
create policy read_own_push on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists write_own_push on public.push_subscriptions;
create policy write_own_push on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

/* ---------------------------------------------------------------------------
 * The VAPID key pair
 *
 * The PUBLIC half is public by design — it ships to every browser that
 * subscribes, so it lives here in the open and is read with the advisory
 * snapshot rather than through a build-time environment variable. That is not
 * laziness: an env var would have to be set again in every deployment, and a
 * missing one fails silently at the moment somebody tries to subscribe.
 *
 * The PRIVATE half is NOT in this file and never will be. It is set once,
 * directly against the database, into `private.push_keys` — the same place and
 * the same reasoning as the PIN hash in `private.access_settings`: no grants
 * to anon or authenticated, reachable only by the Edge Function running as the
 * service role. Committing it here would publish it to a public repository,
 * and anyone holding it can send notifications as this barangay.
 *
 * To rotate: generate a new pair, update both halves together, and expect
 * every existing subscription to stop working until each device re-subscribes.
 * ------------------------------------------------------------------------ */

create table if not exists public.push_settings (
  -- One row, enforced. `true` is the only value the check allows.
  id boolean primary key default true check (id),
  vapid_public_key text,
  updated_at timestamptz not null default now()
);

alter table public.push_settings enable row level security;

drop policy if exists read_push_settings on public.push_settings;
create policy read_push_settings on public.push_settings
  for select to authenticated using (true);

/* No write policy at all: the key pair is changed by an administrator against
   the database, not by anything holding a session. */

insert into public.push_settings (id, vapid_public_key)
values (true, 'BJEXFDhUJY31qnasMr6BMuOqsIzS9IirGkTSaWqVhCd-y3bJsdD5gsfU78ognQAZzGNIEY74TNEgsNkXeLCUgKM')
on conflict (id) do update set
  vapid_public_key = excluded.vapid_public_key,
  updated_at = now();

create table if not exists private.push_keys (
  id boolean primary key default true check (id),
  vapid_private_key text not null,
  subject text not null default 'mailto:salbabayan@callaguip.example'
);

revoke all on private.push_keys from public, anon, authenticated;

/*
 * What the Edge Function reads.
 *
 * In `public` because PostgREST only exposes functions in the schemas it is
 * configured for, and `private` is deliberately not one of them — so this one
 * lives in the open and is locked shut instead: `security definer` to see a
 * table with no grants, no execute for anon or authenticated, and a single
 * explicit grant to the service role the Edge Function runs as. An
 * authenticated session calling it gets a permission error, not the key.
 */
create or replace function public.push_credentials()
returns table (public_key text, private_key text, subject text)
language sql
security definer
set search_path = public, private, pg_temp
as $$
  select s.vapid_public_key, k.vapid_private_key, k.subject
  from public.push_settings s, private.push_keys k
  where s.id and k.id;
$$;

revoke all on function public.push_credentials() from public, anon, authenticated;
grant execute on function public.push_credentials() to service_role;

/* ---------------------------------------------------------------------------
 * Strings
 * ------------------------------------------------------------------------ */

insert into public.translations (message_key, language, text) values
  ('push.title', 'en', 'Alerts when the app is closed'),
  ('push.title', 'tl', 'Abiso kahit sarado ang app'),
  ('push.title', 'ceb', 'Pahibalo bisan sirado ang app'),
  ('push.title', 'fil', 'Abiso kahit sarado ang app'),
  ('push.title', 'ilo', 'Pakaammo uray nakarikep ti app'),

  ('push.body', 'en', 'Your phone will ring when someone calls for help, even if SalbaBayan is not open.'),
  ('push.body', 'tl', 'Tutunog ang telepono mo kapag may humingi ng saklolo, kahit hindi bukas ang SalbaBayan.'),
  ('push.body', 'ceb', 'Motingog ang imong telepono kung adunay mangayo ug tabang, bisan dili abli ang SalbaBayan.'),
  ('push.body', 'fil', 'Tutunog ang telepono mo kapag may humingi ng saklolo, kahit hindi bukas ang SalbaBayan.'),
  ('push.body', 'ilo', 'Agtunog ti teleponom no adda agkiddaw iti tulong, uray no saan a nakalukat ti SalbaBayan.'),

  ('push.turn_on', 'en', 'TURN ON'),
  ('push.turn_on', 'tl', 'BUKSAN'),
  ('push.turn_on', 'ceb', 'ABLIHI'),
  ('push.turn_on', 'fil', 'BUKSAN'),
  ('push.turn_on', 'ilo', 'LUKATAN'),

  ('push.turn_off', 'en', 'TURN OFF'),
  ('push.turn_off', 'tl', 'ISARA'),
  ('push.turn_off', 'ceb', 'SIRAHI'),
  ('push.turn_off', 'fil', 'ISARA'),
  ('push.turn_off', 'ilo', 'IREKEP'),

  ('push.on', 'en', 'On for this phone'),
  ('push.on', 'tl', 'Bukas sa teleponong ito'),
  ('push.on', 'ceb', 'Abli para niini nga telepono'),
  ('push.on', 'fil', 'Bukas sa teleponong ito'),
  ('push.on', 'ilo', 'Nakalukat iti daytoy a telepono'),

  ('push.blocked', 'en', 'This phone is blocking notifications. Allow them in browser settings, then come back.'),
  ('push.blocked', 'tl', 'Naka-block ang abiso sa teleponong ito. Payagan ito sa settings ng browser, tapos bumalik dito.'),
  ('push.blocked', 'ceb', 'Gibabagan niini nga telepono ang mga pahibalo. Tugoti kini sa settings sa browser, dayon balik dinhi.'),
  ('push.blocked', 'fil', 'Naka-block ang abiso sa teleponong ito. Payagan ito sa settings ng browser, tapos bumalik dito.'),
  ('push.blocked', 'ilo', 'Ibabbaan daytoy a telepono dagiti pakaammo. Palubosam iti settings ti browser, sana agsubli ditoy.'),

  ('push.unsupported', 'en', 'This phone cannot receive alerts while the app is closed. On iPhone, add SalbaBayan to the Home Screen first.'),
  ('push.unsupported', 'tl', 'Hindi makakatanggap ng abiso ang teleponong ito kapag sarado ang app. Sa iPhone, idagdag muna ang SalbaBayan sa Home Screen.'),
  ('push.unsupported', 'ceb', 'Dili makadawat ug pahibalo kini nga telepono kung sirado ang app. Sa iPhone, idugang una ang SalbaBayan sa Home Screen.'),
  ('push.unsupported', 'fil', 'Hindi makakatanggap ng abiso ang teleponong ito kapag sarado ang app. Sa iPhone, idagdag muna ang SalbaBayan sa Home Screen.'),
  ('push.unsupported', 'ilo', 'Saan a makaawat iti pakaammo daytoy a telepono no nakarikep ti app. Iti iPhone, inayonmo nga umuna ti SalbaBayan iti Home Screen.'),

  ('push.sos_title', 'en', 'SOMEONE NEEDS RESCUE'),
  ('push.sos_title', 'tl', 'MAY HUMIHINGI NG SAKLOLO'),
  ('push.sos_title', 'ceb', 'ADUNAY NANGAYO UG TABANG'),
  ('push.sos_title', 'fil', 'MAY HUMIHINGI NG SAKLOLO'),
  ('push.sos_title', 'ilo', 'ADDA AGKIDKIDDAW ITI TULONG')
on conflict (message_key, language) do update set text = excluded.text;
