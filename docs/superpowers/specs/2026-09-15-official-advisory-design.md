# Official sets the advisory — design

**Date:** 2026-09-15
**Status:** approved in brainstorming and spec review; refined while writing the implementation plan (see "Refinements")
**Plan:** `docs/superpowers/plans/2026-09-15-official-advisory.md`
**PRD:** §4 (the official "sets the current signal level"), FR-1.2, FR-2.3, FR-2.7, FR-3.1

## Summary

An official can change the barangay's advisory — signal level 0–5, storm name,
bulletin number, wind speed and leave-by time — from a new `/advisory` screen.
Every change is saved through the offline write queue, recorded in an
append-only `signal_history` table by a database trigger, and pushed live to
every phone that has the app open.

Today nothing in `src/` writes `current_signal_level`, `storm_name`,
`bulletin_no`, `wind_kph` or `evacuate_by`. The headline instruction every
resident reads can only be changed with SQL.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Offline behaviour | Queued like every write, with a loud **NOT SENT YET** banner until it lands |
| 2 | Which changes need hold-to-confirm | **Every level change**, raising or lowering. Details-only edits are a plain tap |
| 3 | Leave-by time | **Required at Signal 3+**, cleared automatically below 3 |
| 4 | Who reads the history | **Officials only** |
| 5 | How the change and its history are written | **One queued update + a database trigger** (approach A) |
| 6 | Where database tests run | **Live, non-mutating checks only**; happy path verified once by hand |
| 7 | Wind speed | **Optional WIND (KPH) field**, recorded in history like the other advisory fields |

Decision 5 was first answered as "two queued writes" (B) by mistake and then
re-chosen as A. Nothing from the B design remains in this spec. Decision 7 was
settled in spec review.

## Refinements made while writing the plan

None of these changes a decision above; each makes the design match something
already in the codebase, or closes a gap found while writing real code.

- **The hold control's held label reuses `sos.cancelling`** ("Release to stop")
  instead of a new `adv.issuing`. Mid-hold, the instruction a person needs is how
  to back out, and it is the same for both controls.
- **Hold and button labels are sentence case**, matching `sos.hold_cancel`
  ("Press and hold to cancel") and its verbs in Tagalog and Cebuano.
- **The leave-by message says "leave-before"**, because the field is labelled
  with `ui.leave_by`, which reads LEAVE BEFORE.
- **The NOW line shows the level and when it was set, not who set it.** The
  snapshot's barangay select does not include `signal_set_by`, and widening it
  is out of scope. Who made each change is shown in Recent changes.
- **The patch sent to `barangays` is built by a pure `toBarangayPatch()`**, so it
  can be tested — in particular, that it never sends `signal_set_by`.
- **The leave-by input has pure conversion helpers** (`toLocalInputValue`,
  `fromLocalInputValue`). The live deadline carries seconds, which a
  `datetime-local` input cannot show; re-reading the displayed value would make
  an untouched deadline look changed. The input is parsed only when edited.
- **The "history cannot be deleted" check is a read-only `pg_policies` query**,
  not a REST probe. No constraint can stop a DELETE, so a probe would really
  erase a row if the policy leaked.

## Findings that shaped the design

- `barangays` is already in the `supabase_realtime` publication, and the
  publication sends updates (`pubupdate = true`). No migration is needed for
  live delivery — but **nothing in the app subscribes to it**, so today a
  raised signal reaches open phones only on reload or reconnect.
- `barangays` already has `signal_set_at` and `signal_set_by`. The live row was
  seeded, so `signal_set_by` is null.
- `barangays` already enforces `bulletin_no > 0` and `wind_kph >= 0` (migration
  0004). A form that does not check these first would only surface a typo later,
  as a REFUSED banner.
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
  wind_kph     smallint check (wind_kph >= 0),
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

The `3` is coupled to `EVACUATION_SIGNAL = 3` in `src/lib/advisory.ts` and to
`EVACUATION_LEVEL` in `src/lib/advisoryForm.ts`; `scripts/advisory-test.mjs`
fails if the three disagree. The live row passes (level 3, `evacuate_by` set). A
violation is SQLSTATE `23514`, which `queuePolicy.ts` already treats as
permanent, so a violating queued change is blocked visibly rather than retried.

### Triggers

A change counts as an **advisory change** when any of `current_signal_level`,
`storm_name`, `bulletin_no`, `wind_kph` or `evacuate_by` differs from the old
row. Updating `default_language` or `expected_households` is not an advisory
change and writes no history.

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
the change: a rejected update (RLS, a check constraint) writes no history, and an
accepted one always writes exactly one row.

### Existing data

The live row's Signal 3 predates history. No history row is invented for it; the
screen shows it as "set before history was recorded".

## 2. Saving, NOT SENT and live updates

### 2a. The save — `src/lib/advisoryAdmin.ts` (new)

```ts
export async function setAdvisory(
  input: AdvisoryInput & { barangayId: string },
): Promise<WriteOutcome>
```

`AdvisoryInput` is `{ level, stormName, bulletinNo, windKph, evacuateBy }` with
cleaned values, from `advisoryForm.ts`. `setAdvisory` calls
`enqueueUpdate("barangays", barangayId, toBarangayPatch(input, tappedAt))`.
`toBarangayPatch` (pure, in `advisoryForm.ts`) produces exactly:

| column | value |
|---|---|
| `current_signal_level` | `level` |
| `storm_name` | trimmed, empty → null |
| `bulletin_no` | `bulletinNo` |
| `wind_kph` | `windKph` |
| `evacuate_by` | ISO string at level ≥ 3, **null below 3** |
| `signal_set_at` | tap time |

`signal_set_by` is never sent — the trigger stamps it. Cleared fields are sent as
null rather than omitted, so the placard stops showing them. Validation happens
before this is called (§3); the database constraints are the backstop.

`advisoryAdmin.ts` also holds the history read:

```ts
export async function recentSignalHistory(
  barangayId: string,
): Promise<SignalHistoryRow[] | null>   // null = could not be read
```

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

It considers only `table === "barangays"`, `op === "update"`, a payload whose
`id` is this barangay, and a numeric `current_signal_level`. The hook re-reads
`queuedWrites()` on `onQueueChanged`.

| state | banner |
|---|---|
| `none` | none |
| `queued` | amber: **NOT SENT YET** — residents have not been told Signal *n*. Use the megaphone or radio until this clears. Plus the tap time. |
| `blocked` | red: **REFUSED** — Signal *n* was not issued. Plus the reason and **Retry** (`retryBlocked(queueId)` then `flushQueue()`). |

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
  after the NOT SENT banner. Not a tab — the official's tab bar is full.
- Add `/advisory` to `SHELL_ROUTES` in `src/app/sw.ts`, so it opens offline.
- Content is held to a phone-width column (`max-w-[34rem]`) inside the official's
  76rem shell.

### Layout

```
← CHANGE ADVISORY
[ NOT SENT YET / REFUSED banner, when there is one ]

NOW      SIGNAL NO. 3 · SET 2:10 PM                  ← server truth

NEW LEVEL
[ 0 ] [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]
STORM NAME     [ Igme        ]
BULLETIN NO.   [ 9 ]      WIND (KPH)   [ 175 ]
LEAVE BEFORE   [ 15 Sep, 6:00 PM ]   ← only at Signal 3+, required

WHAT RESIDENTS WILL SEE
[ real SignalPlacard + LeaveByStrip, drawn with the new values ]

[ ████░░░░  Press and hold to issue Signal No. 4 ]

RECENT CHANGES
  4 · 2:10 PM · D-4CD7 · SENT 2:10 PM
```

"SET 2:10 PM" is composed in code from the `adv.set` label and a clock value,
because `translate()` supports only one variable. When history is empty, Recent
changes shows the current level with "set before history was recorded".

### Rules

- **Neutral level buttons.** `globals.css` forbids the severity ramp on buttons.
  The selected button uses the accent (`hv`); each number carries a small
  ramp-coloured bar as information. Level 0 is labelled with `ui.no_signal`,
  levels 1–5 with `ui.signal_no`.
- **Hold vs. tap** (decided by `advisoryForm.ts`):
  - level changed → `HoldToConfirm`, 1.8s, labelled `adv.hold_issue` (or
    `adv.hold_lift` for level 0), showing `sos.cancelling` while held
  - level unchanged, any detail changed (storm, bulletin, wind, leave-by) → plain
    **Save details** button
  - nothing changed, or the form is invalid → disabled
- **Bulletin number** is optional. When given, it must be a whole number of 1 or
  more — the same rule as the database's `bulletin_no > 0`.
- **Wind (kph)** is optional. When given, it must be a whole number from 0 to
  500. The database only requires `>= 0`; the upper bound catches an extra digit
  (1750 for 175) before it reaches every resident's placard.
- **Leave-by** is a `datetime-local` input:
  - shown and required only at level ≥ 3
  - crossing from below 3 into 3+ defaults to now + 3 hours
  - already at 3+ keeps the current deadline
  - must be in the future to confirm; a past deadline shows **THIS DEADLINE HAS
    PASSED** and blocks confirmation
  - converted in the device's time zone, and parsed **only** in the input's change
    handler — never by re-reading the displayed value, which has lost its seconds
- **Preview** renders the real `SignalPlacard` and `LeaveByStrip` with the draft
  values, including wind. `SignalPlacard` gains an optional `barangay` prop;
  without it, it reads the snapshot exactly as today.
- **After confirming**, the draft is cleared and the official stays on the
  screen; the banner is the feedback.
- **Recent changes** reads the last 10 `signal_history` rows for this barangay,
  newest first. When it cannot be read it shows **Not available offline**. The
  device label uses `deviceLabel()` from `ledger.ts`.
- **Access:** while the role is loading, a skeleton; for a non-official — or a
  role still unknown after the skeleton's time is up —
  **Only an official can change the advisory.**

### `src/lib/advisoryForm.ts` (pure)

- `EVACUATION_LEVEL`, `LEAVE_BY_DEFAULT_MS`, `WIND_MAX_KPH`
- `valuesFromBarangay(barangay)` → the form's starting values
- `leaveByRequired(level)`
- `defaultLeaveBy(fromLevel, toLevel, current, now)`
- `validate(draft, now)` → problems: `leave_by_missing`, `leave_by_past`,
  `bulletin_invalid`, `wind_invalid`
- `confirmMode(current, draft, now)` → `"hold" | "tap" | "disabled"`
- `toPatchInput(draft)` → cleaned `AdvisoryInput`; throws on an invalid number
- `toBarangayPatch(input, tappedAt)` → the column patch (§2a)
- `toLocalInputValue(date)`, `fromLocalInputValue(value)` → leave-by input conversion

### `HoldToConfirm`

`src/components/HoldToCancel.tsx` becomes `HoldToConfirm` with props
`label`, `holdingLabel`, `tone` (`"alarm" | "accent"`) and `onConfirm`. The
`onConfirm` ref and pointer-down timestamp — the fixes recorded in its comments —
are preserved. `HoldToCancel` remains as a thin wrapper with the SOS wording and
`tone="alarm"`, so `/sos` is unchanged. `/advisory` uses `tone="accent"`.

### Strings — migration `0022_advisory_strings.sql`

25 keys, each in en / tl / ceb:

| key | en |
|---|---|
| `off.change_advisory` | CHANGE ADVISORY |
| `adv.now` | NOW |
| `adv.set` | SET |
| `adv.new_level` | NEW LEVEL |
| `adv.storm` | STORM NAME |
| `adv.bulletin` | BULLETIN NO. |
| `adv.bulletin_invalid` | Bulletin number must be a whole number, 1 or more. |
| `adv.wind` | WIND (KPH) |
| `adv.wind_invalid` | Wind speed must be a whole number from 0 to 500. |
| `adv.leave_by_required` | A leave-before time is required at Signal 3 and above. |
| `adv.deadline_passed` | THIS DEADLINE HAS PASSED |
| `adv.preview` | WHAT RESIDENTS WILL SEE |
| `adv.hold_issue` | Press and hold to issue Signal No. {n} |
| `adv.hold_lift` | Press and hold to lift the signal |
| `adv.save_details` | Save details |
| `adv.not_sent` | NOT SENT YET — residents have not been told Signal {n}. Use the megaphone or radio until this clears. |
| `adv.not_sent_lift` | NOT SENT YET — residents have not been told the signal was lifted. |
| `adv.refused` | REFUSED — Signal {n} was not issued. |
| `adv.refused_lift` | REFUSED — the signal was not lifted. |
| `adv.retry` | Retry |
| `adv.history` | RECENT CHANGES |
| `adv.sent` | SENT |
| `adv.history_offline` | Not available offline |
| `adv.before_history` | set before history was recorded |
| `adv.officials_only` | Only an official can change the advisory. |

Existing keys reused: `ui.signal_no`, `ui.no_signal`, `ui.leave_by`,
`sos.cancelling`, `ui.no_cache`. The Tagalog and Cebuano follow the app's existing
vocabulary and should be reviewed by a native speaker before a real deployment.

## 4. Testing

### 4a. Unit tests — `scripts/advisory-test.mjs`, added to `verify` as `check:advisory`

**`advisoryForm.ts`**
- `EVACUATION_LEVEL` equals `EVACUATION_SIGNAL` in `advisory.ts` and the `3` in
  migration 0021
- leave-by required at 3, 4, 5; not at 0, 1, 2
- a missing leave-by at 3+ is a problem; a past one (or exactly now) is a problem;
  a future one is not; below 3 neither matters
- `defaultLeaveBy`: now + 3h only when crossing into 3+; keeps the current
  deadline within 3+; null below 3
- bulletin: empty is valid; 1 and 12 are valid; 0, -1, 2.5 and text are invalid
- wind: empty is valid; 0, 175 and 500 are valid; -1, 501, 17.5 and 1750 are invalid
- `confirmMode`: raising or lowering → `hold`; wind, bulletin, storm or leave-by
  alone → `tap`; no change (including whitespace-only) → `disabled`; invalid →
  `disabled`
- `toPatchInput` nulls leave-by below 3, turns blanks into null, trims the storm
  name, and throws on an invalid number instead of saving null
- `valuesFromBarangay` maps nulls to empty text and the deadline to a `Date`
- `toBarangayPatch` has exactly the six columns, never `signal_set_by`, sends the
  leave-by as ISO at 3+ and null below 3, and sends cleared fields as null
- `toLocalInputValue` / `fromLocalInputValue`: local time, zero-padded, seconds
  dropped on display, exact minute round trip, seconds accepted on input,
  impossible or malformed values → null, and a documented check that re-reading a
  displayed deadline with seconds changes it

**`pendingAdvisory.ts`**
- no rows → `none`
- a live update for this barangay → `queued` with its level and tap time
  (falling back to the queue time); level 0 is kept, not dropped
- a blocked one → `blocked` with its reason (or empty) and queue id
- other tables, other barangays, inserts, pre-`op` rows and non-numeric levels
  are ignored

### 4b. Live database checks — added to `scripts/rls-test.mjs`

Every probe is non-mutating whether it passes or fails. Each write sends a body
that a CHECK constraint would reject anyway (`level: 9`, or Signal 5 with no
`evacuate_by`). Postgres evaluates RLS first, so refused by RLS is the pass, and
`23514` means RLS let the write through and only the constraint stopped it — a
leak, reported as a failure.

| check | as |
|---|---|
| a resident's change to `barangays` is refused (0 rows) | anonymous |
| a resident cannot write to `signal_history` | anonymous |
| an official can read `signal_history` | promoted |
| a refused change writes no history row (count before = count after) | resident change, counted by the promoted official |
| a resident sees none of the history an official can | both — **only when history is non-empty**, otherwise SKIPPED |
| an official cannot write to `signal_history` directly | promoted |
| an official cannot edit an existing history row (and it is unchanged) | promoted — **only when history is non-empty**, otherwise SKIPPED |
| Signal 3+ without a leave-by time is rejected with `23514` | promoted |

With the live table empty: 28 passed with two SKIPPED lines. After the first real
change: 30 passed.

The promoted account is demoted and the demotion checked, as today. When
`set_demo_role` is not installed, the official checks print
**SKIPPED — they need an official account** instead of failing.

**Deletion** is not probed over REST — no constraint can stop a DELETE, so a
leaking policy would really erase a row. §4d checks it with a read-only query.

### 4c. Existing gates

- `check:writes` — `advisoryAdmin.ts` writes only through `enqueueUpdate`.
- `check:i18n` — every new key is seeded in 0022.
- `check:actors` — new assertion: **every `page.tsx` route is in `SHELL_ROUTES`**,
  not only tab routes. `/advisory` is the first official non-tab route.

### 4d. Manual and read-only checks, once

1. **No write policies.** A read-only `pg_policies` query shows exactly one policy
   on `signal_history`, for `SELECT`. Any `INSERT`, `UPDATE`, `DELETE` or `ALL`
   policy means history can be altered.
2. **Happy path.** An official issues a real change that includes a wind speed.
   One SQL select confirms exactly one `signal_history` row with the right values,
   a non-null `set_by` matching `barangays.signal_set_by`, and `set_at` no later
   than `received_at`. This also confirms the trigger fires for a non-owner update.
3. **Live update.** A second device with the app open shows the new values without
   reloading, and does not flash older values first.
4. **Offline.** Offline via airplane mode or DevTools Network → Offline (not a
   `fetch` override, which supabase-js bypasses): the amber banner appears, both
   placards keep the old values, and after reconnecting the banner clears and the
   change arrives. History grows by exactly one row.

## Files

| file | change |
|---|---|
| `supabase/migrations/0021_signal_history.sql` | new — table, RLS, constraint, triggers |
| `supabase/migrations/0022_advisory_strings.sql` | new — strings |
| `src/lib/advisoryForm.ts` | new — pure form rules, patch shaping, leave-by conversion |
| `src/lib/pendingAdvisory.ts` | new — pure banner state |
| `src/lib/advisoryAdmin.ts` | new — `setAdvisory`, `recentSignalHistory` |
| `src/components/usePendingAdvisory.ts` | new — hook |
| `src/components/AdvisoryBanner.tsx` | new — NOT SENT YET / REFUSED banner |
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
- Showing who set the current signal on the NOW line (needs `signal_set_by` in
  the snapshot select).
- Editing Purok protocols or routes (recommendation #5).
- Granting roles (recommendation #3) and dropping `set_demo_role`.
