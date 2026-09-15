# Official sets the advisory — design

**Date:** 2026-09-15
**Status:** approved in brainstorming, awaiting spec review
**PRD:** §4 (the official "sets the current signal level"), FR-1.2, FR-2.3, FR-2.7, FR-3.1

## Summary

An official can change the barangay's advisory — signal level 0–5, storm name,
bulletin number and leave-by time — from a new `/advisory` screen. Every change
is saved through the offline write queue, recorded in an append-only
`signal_history` table by a database trigger, and pushed live to every phone that
has the app open.

Today nothing in `src/` writes `current_signal_level`, `storm_name`,
`bulletin_no` or `evacuate_by`. The headline instruction every resident reads can
only be changed with SQL.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Offline behaviour | Queued like every write, with a loud **NOT SENT** banner until it lands |
| 2 | Which changes need hold-to-confirm | **Every level change**, raising or lowering. Details-only edits are a plain tap |
| 3 | Leave-by time | **Required at Signal 3+**, cleared automatically below 3 |
| 4 | Who reads the history | **Officials only** |
| 5 | How the change and its history are written | **One queued update + a database trigger** (approach A) |
| 6 | Where database tests run | **Live, non-mutating checks only**; happy path verified once by hand |

Decision 5 was first answered as "two queued writes" (B) by mistake and then
re-chosen as A. Nothing from the B design remains in this spec.

## Findings that shaped the design

- `barangays` is already in the `supabase_realtime` publication, and the
  publication sends updates (`pubupdate = true`). No migration is needed for
  live delivery — but **nothing in the app subscribes to it**, so today a
  raised signal reaches open phones only on reload or reconnect.
- `barangays` already has `signal_set_at` and `signal_set_by`. The live row was
  seeded, so `signal_set_by` is null.
- Live RLS: `read_barangays` (select, `true`) and `write_barangays` (all,
  `private.is_official()`). Officials can already update the advisory.
- There is one barangay row, at Signal 3. Its `evacuate_by` is set, but
  **passed on 2026-09-05**, so residents currently see "deadline passed".
- `HoldToCancel` is hard-wired to SOS-cancel wording and the alarm fill.
- `translate()` supports a single `{n}` variable. Strings needing a time and a
  device identity must be composed in code, not interpolated.
- `.env.local` holds only the URL and anon key — no service-role key. Official
  test setup depends on `set_demo_role` (migration 0017).
- There are no triggers in the repo yet. `security definer` functions in the
  `private` schema are the established precedent (0003, 0006).

## 1. Data model — migration `0021_signal_history.sql`

### Table

```sql
create table public.signal_history (
  id           uuid primary key default gen_random_uuid(),
  barangay_id  uuid not null references public.barangays (id) on delete cascade,
  level        smallint not null check (level between 0 and 5),
  storm_name   text,
  bulletin_no  smallint check (bulletin_no > 0),
  evacuate_by  timestamptz,
  set_by       uuid references auth.users (id),   -- null = changed outside the app
  set_at       timestamptz,                        -- when the official tapped
  received_at  timestamptz not null default now()  -- when it reached the server
);

create index signal_history_by_barangay
  on public.signal_history (barangay_id, received_at desc);

alter table public.signal_history enable row level security;

create policy read_signal_history on public.signal_history
  for select to authenticated
  using (private.is_official());
```

There are **no insert, update or delete policies**. Rows come only from the
trigger, which runs as the function owner and bypasses RLS. No client — official
or otherwise — can write, edit or delete history.

### Leave-by constraint

```sql
alter table public.barangays
  add constraint leave_by_at_evacuation
    check (current_signal_level < 3 or evacuate_by is not null);
```

The `3` is coupled to `EVACUATION_SIGNAL = 3` in `src/lib/advisory.ts`. The
migration comment names both places. The live row passes (level 3, `evacuate_by`
set). A violation is SQLSTATE `23514`, which `queuePolicy.ts` already treats as
permanent, so a violating queued change is blocked visibly rather than retried.

### Triggers

A change counts as an **advisory change** when any of `current_signal_level`,
`storm_name`, `bulletin_no` or `evacuate_by` differs from the old row. Updating
`default_language` or `expected_households` is not an advisory change and writes
no history.

**Before update** — `private.stamp_signal_setter()`:

- On an advisory change, sets `new.signal_set_by := auth.uid()`. The server
  records who made the change; the client cannot supply it. From the SQL editor
  `auth.uid()` is null, which is recorded honestly as "outside the app".
- On an advisory change where `signal_set_at` was not changed by the update
  (a SQL-editor edit), sets `new.signal_set_at := now()`, so history never copies
  a stale tap time. App changes always send a fresh tap time.

**After update** — `private.record_signal_history()`, with a `WHEN` clause
limiting it to advisory changes: inserts one `signal_history` row from `new`,
copying `signal_set_by` into `set_by` and `signal_set_at` into `set_at`.

Both functions are `language plpgsql`, `security definer`,
`set search_path = public, pg_temp`, in `private` (not exposed at `/rest/v1/rpc`).
Postgres does not check `EXECUTE` on trigger functions when they fire, so no
grant is needed; the manual happy-path check (§4d) confirms this on a real
official's update.

Because the history insert happens inside the same statement, it is atomic with
the change: a rejected update (RLS, the leave-by constraint) writes no history,
and an accepted one always writes exactly one row.

### Existing data

The live row's Signal 3 predates history. No history row is invented for it; the
screen shows it as "set before history was recorded".

## 2. Saving, NOT SENT and live updates

### 2a. The save — `src/lib/advisoryAdmin.ts` (new)

```ts
export async function setAdvisory(input: {
  barangayId: string;
  level: number;
  stormName: string | null;
  bulletinNo: number | null;
  evacuateBy: Date | null;
}): Promise<WriteOutcome>
```

Calls `enqueueUpdate("barangays", barangayId, patch)` with:

| column | value |
|---|---|
| `current_signal_level` | `level` |
| `storm_name` | trimmed, empty → null |
| `bulletin_no` | `bulletinNo` |
| `evacuate_by` | ISO string at level ≥ 3, **null below 3** |
| `signal_set_at` | tap time, `new Date().toISOString()` |

`signal_set_by` is not sent — the trigger stamps it. Validation happens before
this is called (see `advisoryForm.ts`, §3); the database constraint is the
backstop.

### 2b. Queue changes — `src/lib/offlineQueue.ts`

- Add `"barangays"` to `QueueTable`.
- Add `barangays: "signal_set_by"` to `OWNER_COLUMN`, with a comment: owner
  stamping runs only on inserts, and the trigger stamps this column on updates.
- `check:writes` is unchanged; the queue remains the only writer.

Two changes queued offline share the key `<barangayId>:update`, so the second
**replaces** the first. Only the final change is sent, and history records only
what reached the server — correct for a broadcast, where residents would only
ever see the final state.

**Zero-row message.** When RLS refuses an update, PostgREST returns zero rows
rather than an error, and the queue (audit fix #6) blocks the row. Its message
changes from `no row <id> in <table> to update` to:

> no row was updated in `<table>` for `<id>` — it may not exist, or this device
> isn't allowed to change it

Postgres returns the same result for both causes, so the message names both.

### 2c. The banner — `src/lib/pendingAdvisory.ts` (pure) + `src/components/usePendingAdvisory.ts`

`pendingAdvisory(rows, barangayId)` returns:

```ts
type PendingAdvisory =
  | { state: "none" }
  | { state: "queued"; level: number; tappedAt: string }
  | { state: "blocked"; level: number; tappedAt: string; queueId: string; reason: string };
```

It considers only `table === "barangays"`, `op === "update"`, and a payload whose
`id` is this barangay. The hook re-reads `queuedWrites()` on `onQueueChanged`.

| state | banner |
|---|---|
| `none` | none |
| `queued` | amber: **NOT SENT** — residents have not been told Signal *n* yet. Use the megaphone or radio until this clears. Plus the tap time. |
| `blocked` | red: **REFUSED** — Signal *n* was not issued. Plus the reason and **RETRY** (`retryBlocked(queueId)`). |

Level 0 uses separate wording ("…have not been told the signal was lifted").

The banner appears on `/official` and `/advisory`. The placard on both keeps
showing the **server's** level; the unsent level appears only in the banner, so a
change that has not gone out never looks like it has.

### 2d. Live updates — `src/lib/advisory.ts` + `src/components/AppRuntime.tsx`

- `subscribeAdvisory(onChange)` in `advisory.ts`: one multiplexed channel
  (`advisory-live`) for `event: "UPDATE"` on `public.barangays`, following the
  `subscribeHazards` / `subscribeRescue` pattern — one channel, a listener set,
  torn down when the last listener leaves.
- `AppRuntime` subscribes once `userId` exists. The handler calls
  `refreshAdvisory()` and sets the snapshot if it returned one. It must **not**
  call `load()`: `load()` paints the cached snapshot first, which would flash the
  old level on every phone before the new one.
- Offline phones miss the event and are covered by the existing
  reload-on-reconnect.
- **Limit:** only phones with the app open receive it. Waking a sleeping phone
  needs push notifications, which are out of scope.

## 3. The screen

### Route and entry

- New route `src/app/advisory/page.tsx`, officials only.
- Entry point: a **CHANGE ADVISORY** button under the placard on `/official`,
  alongside the NOT SENT banner. Not a tab — the official's tab bar is full.
- Add `/advisory` to `SHELL_ROUTES` in `src/app/sw.ts`, so it opens offline.
- Content is held to a phone-width column (`max-w-[34rem]`) inside the official's
  76rem shell.

### Layout

```
← CHANGE ADVISORY
[ NOT SENT / REFUSED banner, when there is one ]

NOW      SIGNAL NO. 3 · SET 2:10 PM · D-4CD7        ← server truth

NEW LEVEL
[ 0 ] [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]
STORM NAME     [ Igme        ]
BULLETIN NO.   [ 9 ]
LEAVE BY       [ 15 Sep, 6:00 PM ]   ← only at Signal 3+, required
               in 3h 0m

WHAT RESIDENTS WILL SEE
[ real SignalPlacard + LeaveByStrip, drawn with the new values ]

[ ████░░░░  HOLD TO ISSUE SIGNAL NO. 4 ]

RECENT CHANGES
  4 · 2:10 PM · D-4CD7 · SENT 2:10 PM
  3 · —       · —      · set before history was recorded
```

"SET 2:10 PM · D-4CD7" is composed in code from a `adv.set` label and mono
values, because `translate()` supports only one variable.

### Rules

- **Neutral level buttons.** `globals.css` forbids the severity ramp on buttons.
  The selected button uses the accent (`hv`); each number carries a small
  ramp-coloured bar as information. Level 0 is labelled with `ui.no_signal`,
  levels 1–5 with `ui.signal_no`.
- **Hold vs. tap** (decided by `advisoryForm.ts`):
  - level changed → `HoldToConfirm`, 1.8s
  - level unchanged, details changed → plain **SAVE DETAILS** button
  - nothing changed, or the form is invalid → disabled
- **Leave-by** is a `datetime-local` input:
  - shown and required only at level ≥ 3
  - crossing from below 3 into 3+ defaults to now + 3 hours
  - already at 3+ keeps the current deadline
  - must be in the future to confirm; a past deadline shows **THIS DEADLINE HAS
    PASSED** and blocks confirmation
- **Preview** renders the real `SignalPlacard` and `LeaveByStrip` with the draft
  values. `SignalPlacard` gains an optional `barangay` prop; without it, it reads
  the snapshot exactly as today.
- **After confirming**, the official stays on the screen; the banner is the
  feedback.
- **Recent changes** reads the last 10 `signal_history` rows for this barangay,
  newest first, when online. Offline it shows **Not available offline**. The
  device label uses `deviceLabel()` from `ledger.ts`.
- **Access:** while the role is loading, a skeleton; for a non-official,
  **Only an official can change the advisory.**

### `src/lib/advisoryForm.ts` (pure)

Exports the rules above so they can be unit-tested:

- `leaveByRequired(level)`
- `defaultLeaveBy(fromLevel, toLevel, current, now)`
- `validate(draft, now)` → list of problems (`leave_by_missing`, `leave_by_past`)
- `confirmMode(current, draft)` → `"hold" | "tap" | "disabled"`
- `toPatchInput(draft)` → the `setAdvisory` input, with leave-by nulled below 3

### `HoldToConfirm`

`src/components/HoldToCancel.tsx` becomes `HoldToConfirm` with props
`label`, `holdingLabel`, `tone` (`"alarm" | "accent"`) and `onConfirm`. The
`onConfirm` ref and pointer-down timestamp — the fixes recorded in its comments —
are preserved. `HoldToCancel` remains as a thin wrapper with the SOS wording and
`tone="alarm"`, so `/sos` is unchanged. `/advisory` uses `tone="accent"`.

### Strings — migration `0022_advisory_strings.sql`

en / tl / ceb for each key:

| key | en |
|---|---|
| `off.change_advisory` | CHANGE ADVISORY |
| `adv.now` | NOW |
| `adv.set` | SET |
| `adv.new_level` | NEW LEVEL |
| `adv.storm` | STORM NAME |
| `adv.bulletin` | BULLETIN NO. |
| `adv.leave_by_required` | A leave-by time is required at Signal 3 and above |
| `adv.deadline_passed` | THIS DEADLINE HAS PASSED |
| `adv.preview` | WHAT RESIDENTS WILL SEE |
| `adv.hold_issue` | HOLD TO ISSUE SIGNAL NO. {n} |
| `adv.hold_lift` | HOLD TO LIFT THE SIGNAL |
| `adv.issuing` | ISSUING… |
| `adv.save_details` | SAVE DETAILS |
| `adv.not_sent` | NOT SENT — residents have not been told Signal {n} yet. Use the megaphone or radio until this clears. |
| `adv.not_sent_lift` | NOT SENT — residents have not been told the signal was lifted. |
| `adv.refused` | REFUSED — Signal {n} was not issued |
| `adv.refused_lift` | REFUSED — the signal was not lifted |
| `adv.retry` | RETRY |
| `adv.history` | RECENT CHANGES |
| `adv.sent` | SENT |
| `adv.history_offline` | Not available offline |
| `adv.before_history` | set before history was recorded |
| `adv.officials_only` | Only an official can change the advisory. |

Existing keys reused: `ui.signal_no`, `ui.no_signal`, `ui.leave_by`.

## 4. Testing

### 4a. Unit tests — `scripts/advisory-test.mjs`, added to `verify` as `check:advisory`

**`advisoryForm.ts`**
- leave-by required at 3, 4, 5; not at 0, 1, 2
- a missing leave-by at 3+ is a problem; a past one is a problem; a future one is not
- `defaultLeaveBy` gives now + 3h only when crossing from below 3 into 3+
- `defaultLeaveBy` keeps the current deadline when already at 3+
- `confirmMode`: level change → `hold` (raising and lowering); details only →
  `tap`; no change → `disabled`; invalid → `disabled`
- `toPatchInput` nulls leave-by below 3

**`pendingAdvisory.ts`**
- no rows → `none`
- a live update for this barangay → `queued` with its level and tap time
- a blocked one → `blocked` with its reason and queue id
- other tables and other barangays are ignored
- inserts are ignored

### 4b. Live database checks — added to `scripts/rls-test.mjs`

All non-mutating:

| check | as | why it changes nothing |
|---|---|---|
| a resident's update to `barangays` returns 0 rows | anonymous | refused by RLS |
| no history row appeared for it | anonymous update, counted by a promoted official | count before = count after |
| a resident cannot read `signal_history` | anonymous | read only |
| a resident cannot insert into `signal_history` | anonymous | refused |
| an official cannot insert into `signal_history` | promoted | no insert policy exists |
| an official cannot update or delete an existing `signal_history` row | promoted | no policies exist; see note below |
| `{ current_signal_level: 5, evacuate_by: null }` is rejected with `23514` | promoted | the statement aborts |

The constraint check sends level 5 with no deadline, **not** `evacuate_by: null`
alone: if the live row were ever below 3, clearing the leave-by alone would
succeed and write a real history row.

The history count comparison uses a promoted official account, because a
resident cannot read `signal_history`.

**The update and delete checks need a real row to aim at.** PostgREST answers an
update or delete that matches nothing with zero rows whether or not a policy
refused it, so against an empty table those checks pass even if the policies were
wide open. The test targets the newest existing `signal_history` row, and checks
it is unchanged (or still present) afterwards. If the table is empty — true on the
live database until the first real change — it prints
**SKIPPED — no history rows yet** rather than reporting a pass it did not earn.

The promoted account is demoted and the demotion checked, as today. When
`set_demo_role` is not installed, the official rows print
**SKIPPED — needs an official** instead of failing.

### 4c. Existing gates

- `check:writes` — `advisoryAdmin.ts` uses `enqueueUpdate`.
- `check:i18n` — every new key is seeded in 0022.
- `check:actors` — new assertion: **every `page.tsx` route is in `SHELL_ROUTES`**,
  not only tab routes. `/advisory` is the first official non-tab route.

### 4d. Manual checks, once

1. **Happy path.** An official issues a real change. One SQL select confirms
   exactly one new `signal_history` row with the right `set_by`, `set_at` and
   `received_at`, and `barangays.signal_set_by` set. This also confirms the
   trigger fires for a non-owner update.
2. **Live update.** A second device with the app open shows the new level without
   reloading, and does not flash the old level first.
3. **Offline.** In airplane mode, issue a change: the amber banner appears and the
   placard still shows the old level. After reconnecting, the banner clears and
   the change arrives on the second device.

## Files

| file | change |
|---|---|
| `supabase/migrations/0021_signal_history.sql` | new — table, RLS, constraint, triggers |
| `supabase/migrations/0022_advisory_strings.sql` | new — strings |
| `src/lib/advisoryAdmin.ts` | new — `setAdvisory` |
| `src/lib/advisoryForm.ts` | new — pure form rules |
| `src/lib/pendingAdvisory.ts` | new — pure banner state |
| `src/components/usePendingAdvisory.ts` | new — hook |
| `src/components/AdvisoryBanner.tsx` | new — NOT SENT / REFUSED banner |
| `src/components/HoldToConfirm.tsx` | new — generalised hold control |
| `src/components/HoldToCancel.tsx` | becomes a wrapper around `HoldToConfirm` |
| `src/components/SignalPlacard.tsx` | optional `barangay` prop |
| `src/app/advisory/page.tsx` | new — the screen |
| `src/app/official/page.tsx` | CHANGE ADVISORY button + banner |
| `src/app/sw.ts` | `/advisory` in `SHELL_ROUTES` |
| `src/lib/offlineQueue.ts` | `barangays` in the queue; zero-row message |
| `src/lib/advisory.ts` | `subscribeAdvisory` |
| `src/components/AppRuntime.tsx` | subscribe; refresh without cache repaint |
| `scripts/advisory-test.mjs` | new — unit tests |
| `scripts/rls-test.mjs` | non-mutating database checks |
| `scripts/actors-test.mjs` | every route in `SHELL_ROUTES` |
| `package.json` | `check:advisory` in `verify` |

## Out of scope

- Push notifications to phones without the app open.
- More than one barangay. `fetchAdvisory` still reads `.limit(1)`.
- Editing Purok protocols or routes (recommendation #5).
- Granting roles (recommendation #3) and dropping `set_demo_role`.

## Open item for spec review

- **Wind speed.** `barangays.wind_kph` is shown on the placard but is not part
  of the approved form. As designed, an official changing the bulletin leaves the
  old wind speed on residents' placards. Options: add an optional **WIND (KPH)**
  field to the form and to the trigger's advisory-change columns, or leave it as
  designed.
