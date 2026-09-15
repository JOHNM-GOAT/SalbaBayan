# Official Sets the Advisory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an official change the barangay's advisory (signal level, storm name, bulletin number, wind speed, leave-by time) from a new `/advisory` screen, recorded in an append-only history and pushed live to open phones.

**Architecture:** One queued `update` on `barangays` through the existing offline write queue. A `private` security-definer trigger stamps the setter and inserts a `signal_history` row in the same statement. A realtime subscription to `barangays` refreshes every open phone's advisory snapshot. Pure modules (`advisoryForm.ts`, `pendingAdvisory.ts`) hold the rules and are unit-tested in Node.

**Tech Stack:** Next.js 16.3 App Router (static export), React 19, Tailwind v4 tokens, Supabase (Postgres, RLS, Realtime, PostgREST), Dexie offline queue, Node test scripts importing `.ts` directly.

**Spec:** `docs/superpowers/specs/2026-09-15-official-advisory-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing route code (AGENTS.md: this Next.js has breaking changes).
- Every Supabase write goes through `src/lib/offlineQueue.ts`. `npm run check:writes` fails the build otherwise.
- Every translation key is passed to `t()` as a literal: `t("adv.retry")`. Never `t(cond ? "a" : "b")` or a template string — `scripts/check-translations.mjs` only detects literal first arguments.
- Every new key is seeded for `en`, `tl` and `ceb`.
- `translate()` supports one variable, `{n}`. Compose anything needing two values in code.
- The severity ramp (`signal-*` colours) is never used for a button or a button's fill.
- Hold-to-confirm duration: 1.8s (the existing `HOLD_MS = 1800`).
- Evacuation level: `EVACUATION_SIGNAL = 3` in `src/lib/advisory.ts`; the database constraint uses the same `3`.
- Leave-by default when crossing into Signal 3+: now + 3 hours.
- Wind: optional whole number from 0 to 500. Bulletin: optional whole number of 1 or more.
- Build is `next build --webpack` (`npm run build`).
- Unit tests are plain Node scripts: `node scripts/<name>.mjs`, printing `PASS`/`FAIL` and exiting non-zero on failure.
- Match the surrounding code's comment style: comments explain *why*, at the density the file already uses.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Supabase project id: `mpdzehfmxwuxjklgeqrz`. Apply migrations with the Supabase MCP `apply_migration` tool; the migration file in `supabase/migrations/` must hold the identical SQL.

## File Map

| file | responsibility |
|---|---|
| `supabase/migrations/0021_signal_history.sql` | history table, RLS, leave-by constraint, two triggers |
| `supabase/migrations/0022_advisory_strings.sql` | UI strings, en/tl/ceb |
| `src/lib/advisoryForm.ts` | pure form rules: validation, confirm mode, defaults, the `barangays` patch, leave-by input conversion |
| `src/lib/pendingAdvisory.ts` | pure: queue rows → `none` / `queued` / `blocked` |
| `src/lib/advisoryAdmin.ts` | `setAdvisory()` → `enqueueUpdate`; the `recentSignalHistory()` read |
| `src/lib/offlineQueue.ts` | add `barangays` to the queue; honest zero-row message |
| `src/lib/advisory.ts` | `subscribeAdvisory()` multiplexed realtime channel |
| `src/components/AppRuntime.tsx` | subscribe; refresh without repainting the cache |
| `src/components/HoldToConfirm.tsx` | generalised hold control |
| `src/components/HoldToCancel.tsx` | thin SOS wrapper around `HoldToConfirm` |
| `src/components/SignalPlacard.tsx` | optional `barangay` prop for previews |
| `src/components/usePendingAdvisory.ts` | hook over `pendingAdvisory` + queue changes |
| `src/components/AdvisoryBanner.tsx` | NOT SENT / REFUSED banner |
| `src/app/advisory/page.tsx` | the screen |
| `src/app/official/page.tsx` | CHANGE ADVISORY button + banner |
| `src/app/sw.ts` | `/advisory` in `SHELL_ROUTES` |
| `scripts/advisory-test.mjs` | unit tests for both pure modules |
| `scripts/actors-test.mjs` | every page route is precached |
| `scripts/rls-test.mjs` | non-mutating live database checks |
| `package.json` | `check:advisory` script, added to `verify` |

---

### Task 1: History table, leave-by constraint and triggers (migration 0021)

**Files:**
- Create: `supabase/migrations/0021_signal_history.sql`

**Interfaces:**
- Consumes: existing `public.barangays` columns `current_signal_level`, `storm_name`, `bulletin_no`, `wind_kph`, `evacuate_by`, `signal_set_at`, `signal_set_by`; `private.is_official()`.
- Produces: table `public.signal_history (id, barangay_id, level, storm_name, bulletin_no, wind_kph, evacuate_by, set_by, set_at, received_at)`; constraint `leave_by_at_evacuation` on `barangays` (violation SQLSTATE `23514`); triggers `barangays_stamp_signal_setter` (before update) and `barangays_record_signal_history` (after update).

- [ ] **Step 1: Confirm the live row satisfies the new constraint**

Run with the Supabase MCP `execute_sql` tool (read-only):

```sql
select count(*) as violating
from public.barangays
where current_signal_level >= 3 and evacuate_by is null;
```

Expected: `violating = 0`. If it is not 0, stop — the constraint would fail to apply. Report back rather than editing data.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0021_signal_history.sql`:

```sql
-- The official sets the advisory (PRD §4), and every change is recorded.
--
-- Until now nothing in the app could change current_signal_level, storm_name,
-- bulletin_no, wind_kph or evacuate_by — the headline instruction every
-- resident reads could only be changed with SQL. The app now writes these
-- through the offline queue as a single UPDATE on barangays, and this migration
-- makes that update accountable.
--
-- The history is written by a TRIGGER, not by the client, and that is the whole
-- design. A client-written history row is a second write: it can land while the
-- change behind it is refused, or be skipped entirely by a patched client, and
-- an audit log that a client can decline to write is not an audit log. Inside
-- the trigger, the history row commits or rolls back with the change itself.

-- ---------------------------------------------------------------------------
-- 1. The history
-- ---------------------------------------------------------------------------

create table public.signal_history (
  id           uuid primary key default gen_random_uuid(),
  barangay_id  uuid not null references public.barangays (id) on delete cascade,
  level        smallint not null check (level between 0 and 5),
  storm_name   text,
  bulletin_no  smallint check (bulletin_no > 0),
  wind_kph     smallint check (wind_kph >= 0),
  evacuate_by  timestamptz,
  -- Null when the change was made outside the app (the SQL editor has no
  -- auth.uid()). Recorded as unknown rather than refused.
  set_by       uuid references auth.users (id),
  -- When the official tapped. For a change queued offline this can be hours
  -- before received_at, and an audit needs both.
  set_at       timestamptz,
  -- When it reached Postgres — the earliest moment residents could be told.
  received_at  timestamptz not null default now()
);

create index signal_history_by_barangay
  on public.signal_history (barangay_id, received_at desc);

alter table public.signal_history enable row level security;

-- Officials only (spec decision 4). There are deliberately NO insert, update or
-- delete policies: rows come only from the trigger below, which runs as the
-- function owner and is not subject to RLS. No client can write, edit or erase
-- history — including an official.
create policy read_signal_history on public.signal_history
  for select to authenticated
  using (private.is_official());

-- ---------------------------------------------------------------------------
-- 2. Leave-by is required at evacuation level
-- ---------------------------------------------------------------------------
--
-- The 3 here is EVACUATION_SIGNAL in src/lib/advisory.ts. Change one, change
-- both: the app decides when to show the leave-by countdown from that constant,
-- and this decides when a deadline must exist for it to count down to.
--
-- A violation is SQLSTATE 23514, which src/lib/queuePolicy.ts treats as
-- permanent — a queued change without a deadline is blocked visibly on the
-- official's screen instead of retrying forever.

alter table public.barangays
  add constraint leave_by_at_evacuation
    check (current_signal_level < 3 or evacuate_by is not null);

-- ---------------------------------------------------------------------------
-- 3. Stamp who changed it
-- ---------------------------------------------------------------------------
--
-- An "advisory change" is a change to any of the five columns a resident's
-- placard is drawn from. Updating default_language or expected_households is
-- not one, and must not produce a history row that reads as a signal change.

create function private.stamp_signal_setter()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.current_signal_level, new.storm_name, new.bulletin_no, new.wind_kph, new.evacuate_by)
     is distinct from
     (old.current_signal_level, old.storm_name, old.bulletin_no, old.wind_kph, old.evacuate_by)
  then
    -- The server says who did it. The client is never asked.
    new.signal_set_by := auth.uid();

    -- The app always sends a fresh tap time. An edit that did not (the SQL
    -- editor) gets the arrival time, so history never copies a stale one.
    if new.signal_set_at is not distinct from old.signal_set_at then
      new.signal_set_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger barangays_stamp_signal_setter
  before update on public.barangays
  for each row
  execute function private.stamp_signal_setter();

-- ---------------------------------------------------------------------------
-- 4. Record it
-- ---------------------------------------------------------------------------

create function private.record_signal_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.signal_history
    (barangay_id, level, storm_name, bulletin_no, wind_kph, evacuate_by, set_by, set_at)
  values
    (new.id, new.current_signal_level, new.storm_name, new.bulletin_no,
     new.wind_kph, new.evacuate_by, new.signal_set_by, new.signal_set_at);

  return null;
end;
$$;

create trigger barangays_record_signal_history
  after update on public.barangays
  for each row
  when (
    (new.current_signal_level, new.storm_name, new.bulletin_no, new.wind_kph, new.evacuate_by)
    is distinct from
    (old.current_signal_level, old.storm_name, old.bulletin_no, old.wind_kph, old.evacuate_by)
  )
  execute function private.record_signal_history();

-- No EXECUTE grant: Postgres does not check it on trigger functions when they
-- fire. Both live in `private`, which PostgREST does not expose, so neither is
-- reachable at /rest/v1/rpc/.

comment on table public.signal_history is
  'Append-only record of every advisory change, written only by the '
  'barangays_record_signal_history trigger. Officials may read it; nobody may '
  'write, edit or delete it through the API.';
```

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `project_id: mpdzehfmxwuxjklgeqrz`, `name: signal_history`, and the exact SQL from Step 2.

Expected: `{"success": true}`.

- [ ] **Step 4: Verify the objects exist (read-only)**

Run with `execute_sql`:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'signal_history') as history_table,
  (select relrowsecurity from pg_class where oid = 'public.signal_history'::regclass) as rls_on,
  (select count(*) from pg_policies where tablename = 'signal_history') as policies,
  (select count(*) from pg_constraint where conname = 'leave_by_at_evacuation') as leave_by_constraint,
  (select string_agg(tgname, ', ' order by tgname) from pg_trigger
     where tgrelid = 'public.barangays'::regclass and not tgisinternal) as triggers,
  (select count(*) from public.signal_history) as history_rows;
```

Expected: `history_table = 1`, `rls_on = true`, `policies = 1`, `leave_by_constraint = 1`, `triggers = barangays_record_signal_history, barangays_stamp_signal_setter`, `history_rows = 0`.

`history_rows = 0` confirms applying the migration did not itself fire the trigger. The behaviour of the triggers is tested against the live API in Task 11 and by hand in Task 12.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0021_signal_history.sql
git commit -m "feat(db): record every advisory change in signal_history

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Pure form rules (`advisoryForm.ts`)

**Files:**
- Create: `src/lib/advisoryForm.ts`
- Create: `scripts/advisory-test.mjs`
- Modify: `package.json` (the `"check:queue"` line and the `"verify"` line)

**Interfaces:**
- Consumes: nothing (no imports — must run in plain Node).
- Produces:
  - `EVACUATION_LEVEL: 3`, `LEAVE_BY_DEFAULT_MS: 10_800_000`, `WIND_MAX_KPH: 500`
  - `type AdvisoryValues = { level: number; stormName: string; bulletinNo: string; windKph: string; evacuateBy: Date | null }` — the form's raw state; text fields hold what was typed
  - `type AdvisoryInput = { level: number; stormName: string | null; bulletinNo: number | null; windKph: number | null; evacuateBy: Date | null }` — cleaned values ready to save
  - `type Problem = "leave_by_missing" | "leave_by_past" | "bulletin_invalid" | "wind_invalid"`
  - `type ConfirmMode = "hold" | "tap" | "disabled"`
  - `valuesFromBarangay(b: { current_signal_level: number; storm_name: string | null; bulletin_no: number | null; wind_kph: number | null; evacuate_by: string | null }): AdvisoryValues`
  - `leaveByRequired(level: number): boolean`
  - `defaultLeaveBy(fromLevel: number, toLevel: number, current: Date | null, now: number): Date | null`
  - `validate(draft: AdvisoryValues, now: number): Problem[]`
  - `confirmMode(current: AdvisoryValues, draft: AdvisoryValues, now: number): ConfirmMode`
  - `toPatchInput(draft: AdvisoryValues): AdvisoryInput` — throws on an invalid number field

- [ ] **Step 1: Write the failing test**

Create `scripts/advisory-test.mjs`:

```js
/**
 * The rules behind the official's advisory form (spec §3, §4a).
 *
 * These decide what reaches every resident's placard, so they are tested as
 * rules rather than clicked through. The failures they guard against are all
 * quiet ones: a Signal 4 with no leave-by time, a countdown to a deadline that
 * has already passed, 1750 kph where 175 was meant, a lowered signal that
 * slipped through on a plain tap.
 *
 * Run:  node scripts/advisory-test.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVACUATION_LEVEL,
  LEAVE_BY_DEFAULT_MS,
  WIND_MAX_KPH,
  confirmMode,
  defaultLeaveBy,
  leaveByRequired,
  toPatchInput,
  validate,
  valuesFromBarangay,
} from "../src/lib/advisoryForm.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-09-15T06:00:00Z");
const HOUR = 60 * 60 * 1000;
const FUTURE = new Date(NOW + 2 * HOUR);
const PAST = new Date(NOW - HOUR);

/** A valid Signal 3 advisory, with every field filled. */
const base = {
  level: 3,
  stormName: "Igme",
  bulletinNo: "8",
  windKph: "175",
  evacuateBy: FUTURE,
};

const draft = (patch) => ({ ...base, ...patch });

console.log("\nAdvisory form rules — SalbaBayan\n");

console.log("The evacuation level is one number, in three places:");
{
  const advisorySource = readFileSync(join(ROOT, "src/lib/advisory.ts"), "utf8");
  const appLevel = Number(advisorySource.match(/EVACUATION_SIGNAL = (\d+)/)?.[1]);
  check(
    "advisoryForm matches EVACUATION_SIGNAL in advisory.ts",
    appLevel === EVACUATION_LEVEL,
    `advisory.ts says ${appLevel}, advisoryForm says ${EVACUATION_LEVEL}`,
  );

  const migration = readFileSync(
    join(ROOT, "supabase/migrations/0021_signal_history.sql"),
    "utf8",
  );
  const dbLevel = Number(migration.match(/current_signal_level < (\d+)/)?.[1]);
  check(
    "advisoryForm matches the leave_by_at_evacuation constraint",
    dbLevel === EVACUATION_LEVEL,
    `migration says ${dbLevel}, advisoryForm says ${EVACUATION_LEVEL}`,
  );
}

console.log("\nLeave-by is required at evacuation level:");
for (const level of [3, 4, 5]) {
  check(`required at Signal ${level}`, leaveByRequired(level));
}
for (const level of [0, 1, 2]) {
  check(`not required at Signal ${level}`, !leaveByRequired(level));
}

check(
  "a missing leave-by at Signal 3+ is a problem",
  validate(draft({ evacuateBy: null }), NOW).includes("leave_by_missing"),
);
check(
  "a past leave-by is a problem",
  validate(draft({ evacuateBy: PAST }), NOW).includes("leave_by_past"),
  "residents would be told they are already late",
);
check(
  "a leave-by of exactly now is a problem",
  validate(draft({ evacuateBy: new Date(NOW) }), NOW).includes("leave_by_past"),
);
check("a future leave-by is fine", validate(base, NOW).length === 0);
check(
  "no leave-by below Signal 3 is fine",
  validate(draft({ level: 2, evacuateBy: null }), NOW).length === 0,
);
check(
  "a past leave-by below Signal 3 is ignored, because it will be cleared",
  validate(draft({ level: 2, evacuateBy: PAST }), NOW).length === 0,
);

console.log("\nThe default leave-by:");
check(
  "crossing into Signal 3+ defaults to now + 3 hours",
  defaultLeaveBy(2, 4, null, NOW)?.getTime() === NOW + LEAVE_BY_DEFAULT_MS,
);
check(
  "already at Signal 3+ keeps the current deadline",
  defaultLeaveBy(3, 5, FUTURE, NOW)?.getTime() === FUTURE.getTime(),
);
check(
  "dropping below Signal 3 clears it",
  defaultLeaveBy(4, 1, FUTURE, NOW) === null,
);
check("staying below Signal 3 has none", defaultLeaveBy(0, 2, null, NOW) === null);

console.log("\nBulletin number:");
for (const value of ["", "  ", "1", "12"]) {
  check(
    `"${value}" is valid`,
    !validate(draft({ bulletinNo: value }), NOW).includes("bulletin_invalid"),
  );
}
for (const value of ["0", "-1", "2.5", "abc"]) {
  check(
    `"${value}" is bulletin_invalid`,
    validate(draft({ bulletinNo: value }), NOW).includes("bulletin_invalid"),
  );
}

console.log("\nWind speed:");
for (const value of ["", "0", "175", String(WIND_MAX_KPH)]) {
  check(
    `"${value}" is valid`,
    !validate(draft({ windKph: value }), NOW).includes("wind_invalid"),
  );
}
for (const value of ["-1", String(WIND_MAX_KPH + 1), "17.5", "1750"]) {
  check(
    `"${value}" is wind_invalid`,
    validate(draft({ windKph: value }), NOW).includes("wind_invalid"),
    value === "1750" ? "an extra digit would reach every placard" : "",
  );
}

console.log("\nHold, tap, or nothing to do:");
check(
  "raising the level needs the hold",
  confirmMode(base, draft({ level: 4 }), NOW) === "hold",
);
check(
  "lowering the level needs the hold too",
  confirmMode(base, draft({ level: 1, evacuateBy: null }), NOW) === "hold",
  "a mis-tap on the way down sends an evacuated barangay home",
);
check(
  "wind only is a tap",
  confirmMode(base, draft({ windKph: "180" }), NOW) === "tap",
);
check(
  "bulletin only is a tap",
  confirmMode(base, draft({ bulletinNo: "9" }), NOW) === "tap",
);
check(
  "storm name only is a tap",
  confirmMode(base, draft({ stormName: "Julian" }), NOW) === "tap",
);
check(
  "leave-by only is a tap",
  confirmMode(base, draft({ evacuateBy: new Date(NOW + 5 * HOUR) }), NOW) === "tap",
);
check("no change is disabled", confirmMode(base, base, NOW) === "disabled");
check(
  "whitespace around the storm name is not a change",
  confirmMode(base, draft({ stormName: "  Igme " }), NOW) === "disabled",
);
check(
  "an invalid form is disabled even with a level change",
  confirmMode(base, draft({ level: 5, windKph: "-3" }), NOW) === "disabled",
);

console.log("\nWhat gets saved:");
{
  const lowered = toPatchInput(
    draft({ level: 2, evacuateBy: FUTURE, stormName: "  ", bulletinNo: "", windKph: "" }),
  );
  check("leave-by is nulled below Signal 3", lowered.evacuateBy === null);
  check("a blank storm name is null", lowered.stormName === null);
  check("a blank bulletin number is null", lowered.bulletinNo === null);
  check("a blank wind speed is null", lowered.windKph === null);

  const full = toPatchInput(draft({ stormName: " Igme ", bulletinNo: "8", windKph: "175" }));
  check("the storm name is trimmed", full.stormName === "Igme");
  check("numbers are numbers", full.bulletinNo === 8 && full.windKph === 175);
  check("leave-by is kept at Signal 3+", full.evacuateBy?.getTime() === FUTURE.getTime());

  let threw = false;
  try {
    toPatchInput(draft({ windKph: "fast" }));
  } catch {
    threw = true;
  }
  check(
    "an invalid number is refused, not saved as null",
    threw,
    "a typo would silently erase the wind speed from every placard",
  );
}

console.log("\nReading the current advisory:");
{
  const values = valuesFromBarangay({
    current_signal_level: 3,
    storm_name: null,
    bulletin_no: 8,
    wind_kph: null,
    evacuate_by: FUTURE.toISOString(),
  });
  check("nulls become empty text", values.stormName === "" && values.windKph === "");
  check("numbers become text", values.bulletinNo === "8");
  check("the deadline becomes a Date", values.evacuateBy?.getTime() === FUTURE.getTime());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/advisory-test.mjs`
Expected: exits non-zero with `ERR_MODULE_NOT_FOUND` for `src/lib/advisoryForm.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/advisoryForm.ts`:

```ts
/**
 * The rules behind the official's advisory form.
 *
 * No imports, for the same reason `queuePolicy.ts` and `hazardPermission.ts`
 * have none: these are rules rather than plumbing, they decide what reaches
 * every resident's placard, and a test must be able to load them in plain Node
 * without Dexie or a Supabase client coming along.
 *
 * The database is the backstop — `leave_by_at_evacuation`, `bulletin_no > 0`
 * and `wind_kph >= 0` all refuse bad rows. But a refusal there arrives as a
 * REFUSED banner, possibly hours later if the change was queued offline. These
 * rules catch the same mistakes while the official is still looking at the form.
 */

/**
 * Evacuation level. Must equal `EVACUATION_SIGNAL` in lib/advisory.ts and the
 * `3` in migration 0021's `leave_by_at_evacuation` constraint;
 * scripts/advisory-test.mjs fails if the three disagree.
 */
export const EVACUATION_LEVEL = 3;

/** How far ahead a new leave-by time defaults, when crossing into Signal 3+. */
export const LEAVE_BY_DEFAULT_MS = 3 * 60 * 60 * 1000;

/**
 * The upper bound on wind speed. The database only requires `>= 0`; this
 * catches an extra digit — 1750 for 175 — before it reaches every placard.
 */
export const WIND_MAX_KPH = 500;

/** The form's raw state. Text fields hold exactly what was typed. */
export type AdvisoryValues = {
  level: number;
  stormName: string;
  bulletinNo: string;
  windKph: string;
  evacuateBy: Date | null;
};

/** Cleaned values, ready for `setAdvisory`. */
export type AdvisoryInput = {
  level: number;
  stormName: string | null;
  bulletinNo: number | null;
  windKph: number | null;
  evacuateBy: Date | null;
};

export type Problem =
  | "leave_by_missing"
  | "leave_by_past"
  | "bulletin_invalid"
  | "wind_invalid";

export type ConfirmMode = "hold" | "tap" | "disabled";

export function leaveByRequired(level: number): boolean {
  return level >= EVACUATION_LEVEL;
}

/**
 * The leave-by time the form should hold after the level changes.
 *
 * Crossing into evacuation level starts a fresh deadline. Moving within it
 * keeps the one residents are already counting down to — silently resetting it
 * would move a deadline people are acting on. Leaving it clears the deadline,
 * because a countdown under a signal that no longer calls for evacuation
 * teaches residents to ignore countdowns.
 */
export function defaultLeaveBy(
  fromLevel: number,
  toLevel: number,
  current: Date | null,
  now: number,
): Date | null {
  if (!leaveByRequired(toLevel)) return null;
  if (leaveByRequired(fromLevel)) return current;
  return new Date(now + LEAVE_BY_DEFAULT_MS);
}

type Parsed = { ok: true; value: number | null } | { ok: false };

/** Blank is `null`; otherwise digits only — no sign, no decimal point. */
function parseOptionalWhole(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

export function validate(draft: AdvisoryValues, now: number): Problem[] {
  const problems: Problem[] = [];

  const bulletin = parseOptionalWhole(draft.bulletinNo);
  if (!bulletin.ok || (bulletin.value !== null && bulletin.value < 1)) {
    problems.push("bulletin_invalid");
  }

  const wind = parseOptionalWhole(draft.windKph);
  if (!wind.ok || (wind.value !== null && wind.value > WIND_MAX_KPH)) {
    problems.push("wind_invalid");
  }

  // Below evacuation level the deadline is cleared on save, so whatever the
  // form still holds is not a problem.
  if (leaveByRequired(draft.level)) {
    if (!draft.evacuateBy) problems.push("leave_by_missing");
    else if (draft.evacuateBy.getTime() <= now) problems.push("leave_by_past");
  }

  return problems;
}

/**
 * The values as they would be saved. Throws on an invalid number rather than
 * saving it as null — a typo in the wind field must not silently erase the wind
 * speed from every resident's placard. Call `validate` first.
 */
export function toPatchInput(draft: AdvisoryValues): AdvisoryInput {
  const bulletin = parseOptionalWhole(draft.bulletinNo);
  const wind = parseOptionalWhole(draft.windKph);
  if (!bulletin.ok || !wind.ok) {
    throw new Error("toPatchInput called with an invalid draft; validate first");
  }

  return {
    level: draft.level,
    stormName: draft.stormName.trim() || null,
    bulletinNo: bulletin.value,
    windKph: wind.value,
    evacuateBy: leaveByRequired(draft.level) ? draft.evacuateBy : null,
  };
}

/**
 * Whether confirming needs the hold, a plain tap, or is not available.
 *
 * Every level change needs the hold (spec decision 2) — lowering as much as
 * raising, because dropping to Signal 1 tells an evacuated barangay it is safe
 * to go home. Details alone are a tap. Values are compared as they would be
 * SAVED, so a stray space in the storm name is not a change worth confirming.
 */
export function confirmMode(
  current: AdvisoryValues,
  draft: AdvisoryValues,
  now: number,
): ConfirmMode {
  if (validate(draft, now).length > 0) return "disabled";
  if (draft.level !== current.level) return "hold";

  const before = toPatchInput(current);
  const after = toPatchInput(draft);
  const changed =
    before.stormName !== after.stormName ||
    before.bulletinNo !== after.bulletinNo ||
    before.windKph !== after.windKph ||
    (before.evacuateBy?.getTime() ?? null) !== (after.evacuateBy?.getTime() ?? null);

  return changed ? "tap" : "disabled";
}

/** The form's starting values, from the barangay row as the snapshot holds it. */
export function valuesFromBarangay(b: {
  current_signal_level: number;
  storm_name: string | null;
  bulletin_no: number | null;
  wind_kph: number | null;
  evacuate_by: string | null;
}): AdvisoryValues {
  return {
    level: b.current_signal_level,
    stormName: b.storm_name ?? "",
    bulletinNo: b.bulletin_no === null ? "" : String(b.bulletin_no),
    windKph: b.wind_kph === null ? "" : String(b.wind_kph),
    evacuateBy: b.evacuate_by ? new Date(b.evacuate_by) : null,
  };
}
```

Note: `confirmMode` calls `toPatchInput(current)`. The current values come from the database, which already enforces `bulletin_no > 0` and `wind_kph >= 0`, so they always parse.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/advisory-test.mjs`
Expected: every line `PASS`, ending `N passed, 0 failed` and exit code 0. (A `MODULE_TYPELESS_PACKAGE_JSON` warning from Node is expected and harmless — the other test scripts print it too.)

- [ ] **Step 5: Add the script to `verify`**

In `package.json`, replace:

```json
    "check:queue": "node scripts/queue-policy-test.mjs",
```

with:

```json
    "check:queue": "node scripts/queue-policy-test.mjs",
    "check:advisory": "node scripts/advisory-test.mjs",
```

And in the `"verify"` value, replace `npm run check:queue && ` with `npm run check:queue && npm run check:advisory && `.

Run: `npm run check:advisory`
Expected: `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/advisoryForm.ts scripts/advisory-test.mjs package.json
git commit -m "feat: advisory form rules with tests

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 3: Pure banner state (`pendingAdvisory.ts`)

**Files:**
- Create: `src/lib/pendingAdvisory.ts`
- Modify: `scripts/advisory-test.mjs` (the import block at the top, and the lines before the final summary)

**Interfaces:**
- Consumes: the queue-row shape written by `enqueueUpdate` in `src/lib/offlineQueue.ts` — queue id `<barangayId>:update`, `table: "barangays"`, `op: "update"`, `payload` holding the patch plus `id: <barangayId>`, `createdAt: number`, optional `lastError: string`, optional `blocked: boolean`. The patch always includes `current_signal_level` and `signal_set_at` (Task 4 guarantees this).
- Produces:
  - `type QueueRowLike = { id: string; table: string; op?: "insert" | "update"; payload: Record<string, unknown>; createdAt: number; lastError?: string; blocked?: boolean }`
  - `type PendingAdvisory = { state: "none" } | { state: "queued"; level: number; tappedAt: string } | { state: "blocked"; level: number; tappedAt: string; queueId: string; reason: string }`
  - `pendingAdvisory(rows: QueueRowLike[], barangayId: string): PendingAdvisory`

- [ ] **Step 1: Write the failing tests**

In `scripts/advisory-test.mjs`, add this import directly after the existing `} from "../src/lib/advisoryForm.ts";` line:

```js
import { pendingAdvisory } from "../src/lib/pendingAdvisory.ts";
```

Then insert this block immediately **before** the final line pair:

```js
console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
```

```js
console.log("\nWhat the NOT SENT banner shows:");
{
  const BARANGAY = "0561cfa1-2fe7-483d-ad06-7e512f98f02e";
  const TAPPED = "2026-09-15T06:10:00.000Z";

  /** What enqueueUpdate stores for a setAdvisory call. */
  const advisoryRow = (patch = {}, row = {}) => ({
    id: `${BARANGAY}:update`,
    table: "barangays",
    op: "update",
    payload: {
      current_signal_level: 4,
      signal_set_at: TAPPED,
      ...patch,
      id: BARANGAY,
    },
    createdAt: Date.parse(TAPPED),
    ...row,
  });

  check("an empty queue shows nothing", pendingAdvisory([], BARANGAY).state === "none");

  const queued = pendingAdvisory([advisoryRow()], BARANGAY);
  check(
    "a queued change is NOT SENT, with its level and tap time",
    queued.state === "queued" && queued.level === 4 && queued.tappedAt === TAPPED,
    JSON.stringify(queued),
  );

  const lifted = pendingAdvisory([advisoryRow({ current_signal_level: 0 })], BARANGAY);
  check(
    "lifting the signal is reported as level 0, not dropped",
    lifted.state === "queued" && lifted.level === 0,
    JSON.stringify(lifted),
  );

  const noTapTime = pendingAdvisory(
    [advisoryRow({ signal_set_at: undefined })],
    BARANGAY,
  );
  check(
    "without a tap time, the queue time is shown instead",
    noTapTime.state === "queued" && noTapTime.tappedAt === TAPPED,
    JSON.stringify(noTapTime),
  );

  const refused = pendingAdvisory(
    [advisoryRow({}, { blocked: true, lastError: "leave_by_at_evacuation" })],
    BARANGAY,
  );
  check(
    "a refused change is REFUSED, with its reason and queue id",
    refused.state === "blocked" &&
      refused.level === 4 &&
      refused.reason === "leave_by_at_evacuation" &&
      refused.queueId === `${BARANGAY}:update`,
    JSON.stringify(refused),
  );

  const noReason = pendingAdvisory([advisoryRow({}, { blocked: true })], BARANGAY);
  check(
    "a refused change with no recorded error still reports REFUSED",
    noReason.state === "blocked" && noReason.reason === "",
    JSON.stringify(noReason),
  );

  check(
    "another table's update to the same id is ignored",
    pendingAdvisory([advisoryRow({}, { table: "hazard_reports" })], BARANGAY).state === "none",
  );
  // Built explicitly: `advisoryRow` always sets `id: BARANGAY` last, so passing
  // a different id through its patch would be overwritten.
  const otherBarangay = {
    ...advisoryRow(),
    payload: { current_signal_level: 4, signal_set_at: TAPPED, id: "someone-else" },
  };
  check(
    "another barangay's change is ignored",
    pendingAdvisory([otherBarangay], BARANGAY).state === "none",
  );
  check(
    "an insert is ignored",
    pendingAdvisory([advisoryRow({}, { op: "insert" })], BARANGAY).state === "none",
  );
  check(
    "a row queued before `op` existed is ignored — those are inserts",
    pendingAdvisory([advisoryRow({}, { op: undefined })], BARANGAY).state === "none",
  );
  check(
    "a barangays update without a numeric level is ignored",
    pendingAdvisory([advisoryRow({ current_signal_level: "4" })], BARANGAY).state === "none",
    "it could otherwise be shown as 'the signal was lifted'",
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/advisory-test.mjs`
Expected: exits non-zero with `ERR_MODULE_NOT_FOUND` for `src/lib/pendingAdvisory.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pendingAdvisory.ts`:

```ts
/**
 * Whether this device holds an advisory change that has not reached residents.
 *
 * The honesty rule the whole app follows, applied to the one write that is a
 * broadcast: a local intention must never look like a fact other people can
 * see. When an official changes the signal offline, their placard keeps showing
 * the server's level, and this is what drives the banner saying what has NOT
 * gone out — so they know to use the megaphone until it clears.
 *
 * No imports, so it can be tested in Node. The row shape is declared here rather
 * than imported from offlineQueue.ts, the same arrangement as hazardMerge.ts.
 */

/** The fields this needs from a queue row; the real one carries more. */
export type QueueRowLike = {
  id: string;
  table: string;
  /** Absent on rows queued before updates were supported — those are inserts. */
  op?: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: number;
  lastError?: string;
  blocked?: boolean;
};

export type PendingAdvisory =
  | { state: "none" }
  | { state: "queued"; level: number; tappedAt: string }
  | {
      state: "blocked";
      level: number;
      tappedAt: string;
      /** The queue row's own id, for `retryBlocked`. */
      queueId: string;
      reason: string;
    };

/**
 * `enqueueUpdate` keys a row's update as `<id>:update`, so a second change to the
 * same barangay replaces the first. There is at most one row to find.
 */
export function pendingAdvisory(
  rows: QueueRowLike[],
  barangayId: string,
): PendingAdvisory {
  const row = rows.find(
    (r) =>
      r.table === "barangays" &&
      r.op === "update" &&
      r.payload.id === barangayId &&
      // A row with no numeric level is not one setAdvisory wrote. Ignoring it is
      // safer than guessing, because a guessed 0 would announce that the signal
      // was lifted.
      typeof r.payload.current_signal_level === "number",
  );

  if (!row) return { state: "none" };

  const level = row.payload.current_signal_level as number;
  const tappedAt =
    typeof row.payload.signal_set_at === "string"
      ? row.payload.signal_set_at
      : new Date(row.createdAt).toISOString();

  if (row.blocked) {
    return {
      state: "blocked",
      level,
      tappedAt,
      queueId: row.id,
      reason: row.lastError ?? "",
    };
  }

  return { state: "queued", level, tappedAt };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/advisory-test.mjs`
Expected: every line `PASS`, `0 failed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pendingAdvisory.ts scripts/advisory-test.mjs
git commit -m "feat: work out the advisory banner state from the write queue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: Saving through the queue (`toBarangayPatch`, `setAdvisory`, queue changes)

**Files:**
- Modify: `src/lib/advisoryForm.ts` (append `toBarangayPatch`)
- Modify: `scripts/advisory-test.mjs` (import + tests before the final summary)
- Modify: `src/lib/offlineQueue.ts` (`QueueTable`, `OWNER_COLUMN`, the zero-row `lastError`)
- Create: `src/lib/advisoryAdmin.ts`

**Interfaces:**
- Consumes: `AdvisoryInput`, `leaveByRequired` (Task 2); `enqueueUpdate(table, id, patch): Promise<WriteOutcome>` and `type WriteOutcome` from `src/lib/offlineQueue.ts`.
- Produces:
  - `toBarangayPatch(input: AdvisoryInput, tappedAt: string): Record<string, unknown>` in `advisoryForm.ts` — keys exactly `current_signal_level`, `storm_name`, `bulletin_no`, `wind_kph`, `evacuate_by`, `signal_set_at`
  - `setAdvisory(input: AdvisoryInput & { barangayId: string }): Promise<WriteOutcome>` in `advisoryAdmin.ts`
  - `"barangays"` as a valid `QueueTable`

- [ ] **Step 1: Write the failing tests**

In `scripts/advisory-test.mjs`, add `toBarangayPatch,` to the import list from `../src/lib/advisoryForm.ts` (alphabetically, after `toPatchInput,`).

Insert immediately before the final `console.log(\`\n${pass} passed, ${fail} failed\n\`);`:

```js
console.log("\nThe update sent to the barangay:");
{
  const TAPPED = "2026-09-15T06:10:00.000Z";

  const raised = toBarangayPatch(
    { level: 4, stormName: "Igme", bulletinNo: 9, windKph: 185, evacuateBy: FUTURE },
    TAPPED,
  );
  check(
    "it carries exactly the advisory columns and the tap time",
    JSON.stringify(Object.keys(raised).sort()) ===
      JSON.stringify(
        [
          "bulletin_no",
          "current_signal_level",
          "evacuate_by",
          "signal_set_at",
          "storm_name",
          "wind_kph",
        ],
      ),
    JSON.stringify(Object.keys(raised)),
  );
  check(
    "it never sends signal_set_by — only the trigger may say who changed it",
    !("signal_set_by" in raised),
  );
  check(
    "values are mapped to their columns",
    raised.current_signal_level === 4 &&
      raised.storm_name === "Igme" &&
      raised.bulletin_no === 9 &&
      raised.wind_kph === 185 &&
      raised.signal_set_at === TAPPED,
    JSON.stringify(raised),
  );
  check(
    "the leave-by is sent as an ISO string at Signal 3+",
    raised.evacuate_by === FUTURE.toISOString(),
  );

  const lowered = toBarangayPatch(
    { level: 1, stormName: null, bulletinNo: null, windKph: null, evacuateBy: FUTURE },
    TAPPED,
  );
  check(
    "the leave-by is sent as null below Signal 3, even if one was passed in",
    lowered.evacuate_by === null,
    "a countdown would keep running under a signal that no longer calls for evacuation",
  );
  check(
    "cleared fields are sent as null, so the placard stops showing them",
    lowered.storm_name === null && lowered.bulletin_no === null && lowered.wind_kph === null,
  );
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/advisory-test.mjs`
Expected: exits non-zero with a `SyntaxError` naming `toBarangayPatch` as not exported by `advisoryForm.ts`.

- [ ] **Step 3: Implement `toBarangayPatch`**

Append to `src/lib/advisoryForm.ts`:

```ts
/**
 * The UPDATE sent to `barangays`, column by column.
 *
 * `signal_set_by` is deliberately absent. The `stamp_signal_setter` trigger
 * (migration 0021) sets it from `auth.uid()`, and the server is the only
 * trustworthy source for who made a change; a value sent from here would be
 * overwritten at best and believed at worst.
 *
 * `tappedAt` is when the official confirmed, not when this reaches Postgres —
 * for a change queued offline those can be hours apart, and history records
 * both (`set_at` from this, `received_at` from the server).
 *
 * Cleared fields are sent as null rather than omitted. Omitting one would leave
 * the old value on every resident's placard, which is the opposite of what an
 * official who emptied the field meant.
 */
export function toBarangayPatch(
  input: AdvisoryInput,
  tappedAt: string,
): Record<string, unknown> {
  return {
    current_signal_level: input.level,
    storm_name: input.stormName,
    bulletin_no: input.bulletinNo,
    wind_kph: input.windKph,
    evacuate_by:
      leaveByRequired(input.level) && input.evacuateBy
        ? input.evacuateBy.toISOString()
        : null,
    signal_set_at: tappedAt,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/advisory-test.mjs`
Expected: every line `PASS`, `0 failed`.

- [ ] **Step 5: Let the queue write to `barangays`**

In `src/lib/offlineQueue.ts`, replace:

```ts
export type QueueTable =
  | "water_reports"
  | "hazard_reports"
  | "rescue_requests"
  | "headcounts"
  | "checkins";
```

with:

```ts
export type QueueTable =
  | "water_reports"
  | "hazard_reports"
  | "rescue_requests"
  | "headcounts"
  | "checkins"
  | "barangays";
```

Replace:

```ts
  headcounts: "recorded_by",
  checkins: "scanned_by",
};
```

with:

```ts
  headcounts: "recorded_by",
  checkins: "scanned_by",
  /*
   * Never stamped from here. Owner stamping runs only on INSERTS, and the only
   * write to barangays is an UPDATE from setAdvisory — where the
   * stamp_signal_setter trigger (migration 0021) sets this column from
   * auth.uid(). Listed because the record must cover every queue table.
   */
  barangays: "signal_set_by",
};
```

- [ ] **Step 6: Make the zero-row message honest**

In `src/lib/offlineQueue.ts`, replace:

```ts
            lastError: `no row ${rowId} in ${item.table} to update`,
```

with:

```ts
            /*
             * Both causes named, because Postgres gives the same answer for
             * both: an UPDATE refused by RLS returns zero rows, exactly like an
             * UPDATE aimed at a row that is not there. "No row to update" alone
             * told a non-official the barangay did not exist.
             */
            lastError:
              `no row was updated in ${item.table} for ${rowId} — ` +
              `it may not exist, or this device isn't allowed to change it`,
```

- [ ] **Step 7: Create `setAdvisory`**

Create `src/lib/advisoryAdmin.ts`:

```ts
/**
 * The official changes the advisory (PRD §4).
 *
 * Through the offline queue like every other write — an official at a barangay
 * hall with a failing connection must still be able to issue a warning, and a
 * change that evaporated would be worse than one that arrives late. What makes
 * a late one safe is that it is never hidden: the NOT SENT banner
 * (lib/pendingAdvisory.ts) says so until it lands.
 *
 * The history row is not written here. The record_signal_history trigger writes
 * it in the same statement as the change, so the change and its record cannot
 * be separated.
 */

import { enqueueUpdate, type WriteOutcome } from "./offlineQueue";
import { toBarangayPatch, type AdvisoryInput } from "./advisoryForm";

export async function setAdvisory(
  input: AdvisoryInput & { barangayId: string },
): Promise<WriteOutcome> {
  return enqueueUpdate(
    "barangays",
    input.barangayId,
    toBarangayPatch(input, new Date().toISOString()),
  );
}
```

- [ ] **Step 8: Verify types and the write-path guard**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run check:writes`
Expected: `write-path check: clean (1 permitted writer)` — `advisoryAdmin.ts` writes only through `enqueueUpdate`.

Run: `npm run check:queue`
Expected: `24 passed, 0 failed` — the queue's give-up rule is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/lib/advisoryForm.ts scripts/advisory-test.mjs src/lib/offlineQueue.ts src/lib/advisoryAdmin.ts
git commit -m "feat: save advisory changes through the offline queue

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: Live advisory updates on every open phone

**Files:**
- Modify: `src/lib/advisory.ts` (imports; new function after `refreshAdvisory`)
- Modify: `src/components/AppRuntime.tsx` (import; new effect after the `deviceRole` effect)

**Interfaces:**
- Consumes: `refreshAdvisory(): Promise<AdvisorySnapshot | null>` (existing, `src/lib/advisory.ts`); `getSupabase()`; `userId` and `setSnapshot` inside `AppRuntime`.
- Produces: `subscribeAdvisory(onChange: () => void): () => void` in `src/lib/advisory.ts`.

**Testing note:** Realtime cannot run in a Node script, so this task has no automated test. It is verified by type-checking and the build here, and by the two-device check in Task 12 (the new level appears without a reload, with no flash of the old one).

- [ ] **Step 1: Add the subscription**

In `src/lib/advisory.ts`, replace:

```ts
import Dexie, { type Table } from "dexie";
import { getSupabase } from "./supabase";
```

with:

```ts
import Dexie, { type Table } from "dexie";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
```

Then insert directly after the closing `}` of `refreshAdvisory` (the function ending `return null;\n  }\n}`), before the `/* ----` "Derivation" banner comment:

```ts
/* ---------------------------------------------------------------------------
 * Live updates
 * ------------------------------------------------------------------------ */

/**
 * Tell every open phone the moment the advisory changes.
 *
 * Until the official could set the signal from the app this was not needed —
 * and it was quietly missing anyway: the snapshot was refreshed only on load
 * and on reconnect, so a resident with the app already open kept reading
 * Signal 3 while the barangay had moved to Signal 4. `barangays` was already in
 * the realtime publication; nothing was listening.
 *
 * One channel, many listeners — the same shape `subscribeHazards` and
 * `subscribeRescue` had to grow. A channel name is global to the client, and
 * adding a second `postgres_changes` binding to a channel that has already
 * subscribed throws.
 *
 * Only phones with the app OPEN hear this. Waking a phone asleep in a pocket
 * needs push notifications, which this does not attempt.
 */
let advisoryChannel: RealtimeChannel | null = null;
const advisoryListeners = new Set<() => void>();

export function subscribeAdvisory(onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  advisoryListeners.add(onChange);

  if (!advisoryChannel) {
    advisoryChannel = supabase
      .channel("advisory-live")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "barangays" },
        () => {
          // Copied before notifying: a listener may unsubscribe in response.
          for (const listener of [...advisoryListeners]) listener();
        },
      )
      .subscribe();
  }

  return () => {
    advisoryListeners.delete(onChange);

    // Tear the channel down only when nobody is left, and drop the reference
    // first so a subscriber arriving mid-teardown builds a fresh one.
    if (advisoryListeners.size === 0 && advisoryChannel) {
      const channel = advisoryChannel;
      advisoryChannel = null;
      void supabase.removeChannel(channel);
    }
  };
}
```

- [ ] **Step 2: Subscribe once, in the runtime**

In `src/components/AppRuntime.tsx`, replace:

```ts
import {
  readCachedAdvisory,
  refreshAdvisory,
  type AdvisorySnapshot,
} from "@/lib/advisory";
```

with:

```ts
import {
  readCachedAdvisory,
  refreshAdvisory,
  subscribeAdvisory,
  type AdvisorySnapshot,
} from "@/lib/advisory";
```

Then replace:

```ts
    return onRoleChanged(read);
  }, [userId]);
```

with:

```ts
    return onRoleChanged(read);
  }, [userId]);

  /*
   * The advisory, live. Waits for `userId` because every read here is scoped
   * `to authenticated` — a refresh that raced the anonymous sign-in would come
   * back empty and be indistinguishable from "no barangay configured".
   *
   * `refreshAdvisory`, NOT `load`. `load` paints the cached snapshot before it
   * fetches, which is right on boot and wrong here: every open phone would flash
   * back to the OLD level for a moment before showing the new one. A resident
   * who glanced at the screen in that moment would read the wrong signal. A
   * refresh that fails keeps the snapshot already on screen, with its age shown
   * honestly in the sync strip.
   */
  useEffect(() => {
    if (!userId) return;
    return subscribeAdvisory(() => {
      void refreshAdvisory().then((fresh) => {
        if (fresh) setSnapshot(fresh);
      });
    });
  }, [userId]);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors. (If `react-hooks/set-state-in-effect` flags `setSnapshot`, it is inside an async callback, not called synchronously in the effect; follow the file's existing pattern and leave the call inside the `.then`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/advisory.ts src/components/AppRuntime.tsx
git commit -m "feat: push advisory changes to every open phone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: A reusable hold control, and a placard that can preview

**Files:**
- Create: `src/components/HoldToConfirm.tsx`
- Modify: `src/components/HoldToCancel.tsx` (whole file becomes a wrapper)
- Modify: `src/components/SignalPlacard.tsx:14-22`

**Interfaces:**
- Consumes: `useT` from `./AppRuntime`; `type Barangay` from `@/lib/advisory`.
- Produces:
  - `HoldToConfirm(props: { label: string; holdingLabel: string; tone: "alarm" | "accent"; onConfirm: () => void })`
  - `HoldToCancel({ onCancel }: { onCancel: () => void })` — unchanged signature
  - `SignalPlacard(props?: { barangay?: Barangay })` — without the prop, identical to today

**Testing note:** these are React components with no pure logic to extract, so there is no Node test. The regression that matters is the SOS screen's hold, which must behave exactly as before; it is protected by keeping the implementation byte-for-byte equivalent (only names and the fill colour change) and checked by type-checking, lint, `check:i18n` (the `sos.*` keys must still be detected) and the build.

- [ ] **Step 1: Create `HoldToConfirm`**

Create `src/components/HoldToConfirm.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 1800;

/**
 * A control that acts only after a sustained hold.
 *
 * Extracted from the SOS screen's hold-to-cancel (FR-4.5) when changing the
 * barangay's signal needed the same protection. Both are actions a mis-tap must
 * not be able to take: withdrawing a distress call, and telling a whole
 * barangay to evacuate or to go home. A tap — even a tap plus a confirm dialog —
 * is too easy to do by accident, and a dialog is dismissed unread by someone
 * working fast.
 *
 * A sustained hold cannot happen by accident, and the filling bar makes the
 * consequence legible without words. Releasing early aborts, and the progress
 * resets rather than resuming, so a half-press is never banked.
 *
 * The fill is `alarm` for SOS and `accent` for everything else. It is never a
 * severity colour: the signal ramp means severity and nothing else, and a
 * button filling in Signal 4's orange would be the ramp used as decoration.
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  tone,
  onConfirm,
}: {
  label: string;
  holdingLabel: string;
  tone: "alarm" | "accent";
  onConfirm: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startedAt = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  /*
   * `onConfirm` is held in a ref so it is NOT an effect dependency.
   *
   * This was a real bug, not a theoretical one. The SOS screen re-renders every
   * second for its elapsed timer and hands down a fresh callback each time. With
   * that identity in the dependency array the effect tore down and re-ran every
   * second — and because the effect was also where the clock started, every
   * re-run reset the hold to zero. A 1.8s hold interrupted every 1.0s can never
   * complete. The advisory screen re-renders on every keystroke, so it would hit
   * the same wall.
   *
   * A ref rather than asking callers for `useCallback`, deliberately: a control
   * whose correctness depends on every caller remembering to memoise a prop is a
   * control that breaks the next time someone uses it.
   */
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
  });

  useEffect(() => {
    if (!holding) return;

    const tick = () => {
      // `startedAt` is stamped at pointer-down, not here, so that even a
      // legitimate re-run of this effect cannot restart the clock.
      const held = Date.now() - (startedAt.current ?? Date.now());
      const next = Math.min(1, held / HOLD_MS);
      setProgress(next);

      if (next >= 1) {
        setHolding(false);
        setProgress(0);
        onConfirmRef.current();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [holding]);

  const start = () => {
    startedAt.current = Date.now();
    setHolding(true);
  };

  const stop = () => {
    startedAt.current = null;
    setHolding(false);
    setProgress(0);
  };

  return (
    <button
      type="button"
      // Pointer events cover mouse, touch and pen with one path. `onPointerLeave`
      // matters: dragging a thumb off the control must abort, not complete.
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className="tap relative w-full overflow-hidden rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-4 py-3 text-center select-none"
    >
      <span
        // Written out in full: Tailwind scans source text, so a class built
        // from `tone` would produce no CSS at all.
        className={`absolute inset-y-0 left-0 transition-none ${
          tone === "alarm" ? "bg-alarm/25" : "bg-hv/25"
        }`}
        style={{ width: `${progress * 100}%` }}
        aria-hidden
      />
      <span className="relative flex items-center justify-center gap-2 text-[13px] font-semibold text-paper-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        {holding ? holdingLabel : label}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Make `HoldToCancel` a wrapper**

Replace the entire contents of `src/components/HoldToCancel.tsx` with:

```tsx
"use client";

import { useT } from "./AppRuntime";
import { HoldToConfirm } from "./HoldToConfirm";

/**
 * Hold-to-cancel an SOS (FR-4.5).
 *
 * The hold itself — and the re-render bug it was hardened against — lives in
 * HoldToConfirm, which the advisory screen now shares. This keeps the SOS
 * screen's import, props and wording exactly as they were.
 */
export function HoldToCancel({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  return (
    <HoldToConfirm
      label={t("sos.hold_cancel")}
      holdingLabel={t("sos.cancelling")}
      tone="alarm"
      onConfirm={onCancel}
    />
  );
}
```

- [ ] **Step 3: Let the placard draw a preview**

In `src/components/SignalPlacard.tsx`, replace:

```tsx
import { useSync, useT } from "./AppRuntime";
import { signalStyle } from "@/lib/signal";
```

with:

```tsx
import { useSync, useT } from "./AppRuntime";
import { signalStyle } from "@/lib/signal";
import type { Barangay } from "@/lib/advisory";
```

Replace:

```tsx
export function SignalPlacard() {
  const { snapshot } = useSync();
  const t = useT();

  if (!snapshot) return null;

  const { barangay } = snapshot;
  const level = barangay.current_signal_level;
```

with:

```tsx
export function SignalPlacard({ barangay: preview }: { barangay?: Barangay } = {}) {
  const { snapshot } = useSync();
  const t = useT();

  /*
   * `barangay` is for the advisory screen's preview, which draws the placard
   * with values that have not been issued yet. It is the real component rather
   * than a lookalike on purpose: what the official approves is then exactly what
   * every resident will see. Every other caller passes nothing and gets the
   * snapshot, as before.
   */
  const barangay = preview ?? snapshot?.barangay;
  if (!barangay) return null;

  const level = barangay.current_signal_level;
```

The rest of the file is unchanged — it already reads `barangay.storm_name`, `barangay.wind_kph` and `barangay.bulletin_no`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

Run: `npm run check:i18n`
Expected: `Every key the app uses is seeded by a migration.` — `sos.hold_cancel` and `sos.cancelling` are still passed to `t()` as literals.

Run: `npm run build`
Expected: completes, listing the same routes as before (no `/advisory` yet).

- [ ] **Step 5: Commit**

```bash
git add src/components/HoldToConfirm.tsx src/components/HoldToCancel.tsx src/components/SignalPlacard.tsx
git commit -m "refactor: share the hold control, and let the placard preview draft values

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: Strings for the advisory screen (migration 0022)

**Files:**
- Create: `supabase/migrations/0022_advisory_strings.sql`

**Interfaces:**
- Consumes: the `public.translations (message_key, language, text)` table and its `(message_key, language)` unique constraint.
- Produces: 25 keys, each in `en`, `tl` and `ceb`, used by Tasks 9 and 10:
  `off.change_advisory`, `adv.now`, `adv.set`, `adv.new_level`, `adv.storm`, `adv.bulletin`, `adv.bulletin_invalid`, `adv.wind`, `adv.wind_invalid`, `adv.leave_by_required`, `adv.deadline_passed`, `adv.preview`, `adv.hold_issue`, `adv.hold_lift`, `adv.save_details`, `adv.not_sent`, `adv.not_sent_lift`, `adv.refused`, `adv.refused_lift`, `adv.retry`, `adv.history`, `adv.sent`, `adv.history_offline`, `adv.before_history`, `adv.officials_only`.
- Reuses existing keys (do not re-seed): `ui.signal_no`, `ui.no_signal`, `ui.leave_by`, `ui.remaining`, and `sos.cancelling` as the hold control's label while it is being held.

**Refinements to the spec's string table, made to match wording residents already see:**
- `adv.issuing` is **dropped**. While held, the control shows `sos.cancelling` ("Release to stop" / "Bitawan para itigil" / "Buhii aron mohunong") — mid-hold, the useful instruction is how to back out, and it is identical for both controls.
- Hold and button labels are **sentence case**, like `sos.hold_cancel` ("Press and hold to cancel"), using the same verbs: "Pindutin nang matagal para…" / "Pislita og dugay aron…".
- The leave-by message says **leave-before**, because the field label `ui.leave_by` reads "LEAVE BEFORE" / "UMALIS BAGO" / "BIYA SA DILI PA".
- The NOT SENT lead reuses `hazard.pending`'s wording: "HINDI PA NAIPAPADALA" / "WALA PA MAIPADALA".

The Tagalog and Cebuano follow the app's existing vocabulary. Have a native speaker review them before a real barangay uses this build.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_advisory_strings.sql`:

```sql
-- Strings for the official's advisory screen (spec 2026-09-15, §3).
--
-- Worded to match what residents already see, not freshly invented. The hold
-- control uses the SOS control's own verbs ("Press and hold…"), and while it is
-- held it shows `sos.cancelling` ("Release to stop") rather than a new string:
-- the instruction a person needs mid-hold is how to back out, and it is the same
-- for both. The leave-by message says "leave-before" because the field it
-- refers to is labelled with `ui.leave_by`, which reads LEAVE BEFORE.
--
-- The NOT SENT lead reuses the wording of `hazard.pending`, so an unsent change
-- reads the same whether it is a hazard report or the barangay's signal.

insert into public.translations (message_key, language, text) values
  ('off.change_advisory', 'en', 'CHANGE ADVISORY'),
  ('off.change_advisory', 'tl', 'BAGUHIN ANG ABISO'),
  ('off.change_advisory', 'ceb', 'USBA ANG PAHIBALO'),

  ('adv.now', 'en', 'NOW'),
  ('adv.now', 'tl', 'KASALUKUYAN'),
  ('adv.now', 'ceb', 'KARON'),

  ('adv.set', 'en', 'SET'),
  ('adv.set', 'tl', 'ITINAKDA'),
  ('adv.set', 'ceb', 'GITAKDA'),

  ('adv.new_level', 'en', 'NEW LEVEL'),
  ('adv.new_level', 'tl', 'BAGONG ANTAS'),
  ('adv.new_level', 'ceb', 'BAG-ONG LEBEL'),

  ('adv.storm', 'en', 'STORM NAME'),
  ('adv.storm', 'tl', 'PANGALAN NG BAGYO'),
  ('adv.storm', 'ceb', 'NGALAN SA BAGYO'),

  ('adv.bulletin', 'en', 'BULLETIN NO.'),
  ('adv.bulletin', 'tl', 'BULLETIN BLG.'),
  ('adv.bulletin', 'ceb', 'BULLETIN NUM.'),

  ('adv.bulletin_invalid', 'en', 'Bulletin number must be a whole number, 1 or more.'),
  ('adv.bulletin_invalid', 'tl', 'Ang numero ng bulletin ay dapat buong numero, 1 o higit.'),
  ('adv.bulletin_invalid', 'ceb', 'Ang numero sa bulletin kinahanglan tibuok nga numero, 1 o labaw.'),

  ('adv.wind', 'en', 'WIND (KPH)'),
  ('adv.wind', 'tl', 'HANGIN (KPH)'),
  ('adv.wind', 'ceb', 'HANGIN (KPH)'),

  ('adv.wind_invalid', 'en', 'Wind speed must be a whole number from 0 to 500.'),
  ('adv.wind_invalid', 'tl', 'Ang lakas ng hangin ay dapat buong numero mula 0 hanggang 500.'),
  ('adv.wind_invalid', 'ceb', 'Ang kusog sa hangin kinahanglan tibuok nga numero gikan 0 ngadto 500.'),

  ('adv.leave_by_required', 'en', 'A leave-before time is required at Signal 3 and above.'),
  ('adv.leave_by_required', 'tl', 'Kailangan ng oras ng pag-alis sa Signal 3 pataas.'),
  ('adv.leave_by_required', 'ceb', 'Kinahanglan ang oras sa pagbiya sa Signal 3 pataas.'),

  ('adv.deadline_passed', 'en', 'THIS DEADLINE HAS PASSED'),
  ('adv.deadline_passed', 'tl', 'LUMIPAS ANG ORAS NA ITO'),
  ('adv.deadline_passed', 'ceb', 'MILABAY NA KINI NGA ORAS'),

  ('adv.preview', 'en', 'WHAT RESIDENTS WILL SEE'),
  ('adv.preview', 'tl', 'ANG MAKIKITA NG MGA RESIDENTE'),
  ('adv.preview', 'ceb', 'ANG MAKITA SA MGA RESIDENTE'),

  ('adv.hold_issue', 'en', 'Press and hold to issue Signal No. {n}'),
  ('adv.hold_issue', 'tl', 'Pindutin nang matagal para itakda ang Signal No. {n}'),
  ('adv.hold_issue', 'ceb', 'Pislita og dugay aron itakda ang Signal No. {n}'),

  ('adv.hold_lift', 'en', 'Press and hold to lift the signal'),
  ('adv.hold_lift', 'tl', 'Pindutin nang matagal para alisin ang signal'),
  ('adv.hold_lift', 'ceb', 'Pislita og dugay aron kuhaon ang signal'),

  ('adv.save_details', 'en', 'Save details'),
  ('adv.save_details', 'tl', 'I-save ang detalye'),
  ('adv.save_details', 'ceb', 'I-save ang detalye'),

  ('adv.not_sent', 'en', 'NOT SENT YET — residents have not been told Signal {n}. Use the megaphone or radio until this clears.'),
  ('adv.not_sent', 'tl', 'HINDI PA NAIPAPADALA — hindi pa naabisuhan ang mga residente ng Signal {n}. Gumamit ng megaphone o radyo hanggang mawala ito.'),
  ('adv.not_sent', 'ceb', 'WALA PA MAIPADALA — wala pa nahibalo ang mga residente sa Signal {n}. Gamita ang megaphone o radyo hangtod kini mawala.'),

  ('adv.not_sent_lift', 'en', 'NOT SENT YET — residents have not been told the signal was lifted.'),
  ('adv.not_sent_lift', 'tl', 'HINDI PA NAIPAPADALA — hindi pa naabisuhan ang mga residente na inalis ang signal.'),
  ('adv.not_sent_lift', 'ceb', 'WALA PA MAIPADALA — wala pa nahibalo ang mga residente nga gikuha ang signal.'),

  ('adv.refused', 'en', 'REFUSED — Signal {n} was not issued.'),
  ('adv.refused', 'tl', 'TINANGGIHAN — hindi naitakda ang Signal {n}.'),
  ('adv.refused', 'ceb', 'GISALIKWAY — wala natakda ang Signal {n}.'),

  ('adv.refused_lift', 'en', 'REFUSED — the signal was not lifted.'),
  ('adv.refused_lift', 'tl', 'TINANGGIHAN — hindi inalis ang signal.'),
  ('adv.refused_lift', 'ceb', 'GISALIKWAY — wala gikuha ang signal.'),

  ('adv.retry', 'en', 'Retry'),
  ('adv.retry', 'tl', 'Subukang muli'),
  ('adv.retry', 'ceb', 'Sulayi pag-usab'),

  ('adv.history', 'en', 'RECENT CHANGES'),
  ('adv.history', 'tl', 'MGA HULING PAGBABAGO'),
  ('adv.history', 'ceb', 'MGA BAG-OHAY NGA KAUSABAN'),

  ('adv.sent', 'en', 'SENT'),
  ('adv.sent', 'tl', 'NAIPADALA'),
  ('adv.sent', 'ceb', 'NAIPADALA'),

  ('adv.history_offline', 'en', 'Not available offline'),
  ('adv.history_offline', 'tl', 'Hindi available kung offline'),
  ('adv.history_offline', 'ceb', 'Dili available kung offline'),

  ('adv.before_history', 'en', 'set before history was recorded'),
  ('adv.before_history', 'tl', 'itinakda bago itinala ang kasaysayan'),
  ('adv.before_history', 'ceb', 'gitakda sa wala pa girekord ang kasaysayan'),

  ('adv.officials_only', 'en', 'Only an official can change the advisory.'),
  ('adv.officials_only', 'tl', 'Tanging opisyal ang maaaring baguhin ang abiso.'),
  ('adv.officials_only', 'ceb', 'Opisyal ra ang makausab sa pahibalo.')
on conflict (message_key, language) do update set text = excluded.text;
```

- [ ] **Step 2: Check the file is readable by the translation guard**

Run: `npm run check:i18n`
Expected: passes, and the `keys seeded by supabase/migrations/*.sql` count is **25 higher** than before this task. (No new key is *used* in `src/` yet, so nothing can be missing.)

If the count rose by less than 25, a row does not match the guard's pattern `('key', 'en'|'tl'|'ceb'` — look for a missing quote or a key with an uppercase letter.

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `project_id: mpdzehfmxwuxjklgeqrz`, `name: advisory_strings`, and the exact SQL from Step 1.

Expected: `{"success": true}`.

- [ ] **Step 4: Verify every key landed in all three languages (read-only)**

Run with `execute_sql`:

```sql
select
  count(*) as rows,
  count(distinct message_key) as keys,
  count(*) filter (where language = 'en') as en,
  count(*) filter (where language = 'tl') as tl,
  count(*) filter (where language = 'ceb') as ceb
from public.translations
where message_key like 'adv.%' or message_key = 'off.change_advisory';
```

Expected: `rows = 75`, `keys = 25`, `en = 25`, `tl = 25`, `ceb = 25`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0022_advisory_strings.sql
git commit -m "feat(i18n): strings for the advisory screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: Leave-by input conversion (pure)

**Files:**
- Modify: `src/lib/advisoryForm.ts` (append two functions)
- Modify: `scripts/advisory-test.mjs` (import + tests before the final summary)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toLocalInputValue(date: Date): string` — `"YYYY-MM-DDTHH:MM"` in the device's time zone, for `<input type="datetime-local">`
  - `fromLocalInputValue(value: string): Date | null` — the input's value back to a `Date`; `null` when empty, malformed or an impossible date

**Why this is its own task:** `datetime-local` has no time zone and no seconds, and both are classic sources of a quiet wrong answer. One of them is a real trap for this screen: the live deadline carries seconds (`08:14:18.885`). If the page re-parsed the displayed input on every render, the seconds would be dropped, `confirmMode` would see a changed deadline, and simply opening the screen would enable **Save details**. The rule the page follows (Task 10) is: parse **only** in the input's `onChange`, and otherwise keep the `Date` as it came from the database.

- [ ] **Step 1: Write the failing tests**

In `scripts/advisory-test.mjs`, add `fromLocalInputValue,` and `toLocalInputValue,` to the import list from `../src/lib/advisoryForm.ts` (alphabetically: `fromLocalInputValue` after `defaultLeaveBy`, `toLocalInputValue` after `toBarangayPatch`).

Insert immediately before the final `console.log(\`\n${pass} passed, ${fail} failed\n\`);`:

```js
console.log("\nThe leave-by input:");
{
  // Built with the local-time constructor, so these hold in any time zone the
  // test happens to run in.
  const sixPm = new Date(2026, 8, 15, 18, 5);

  check(
    "a date becomes the value a datetime-local input expects",
    toLocalInputValue(sixPm) === "2026-09-15T18:05",
    toLocalInputValue(sixPm),
  );
  check(
    "single digits are padded",
    toLocalInputValue(new Date(2026, 0, 2, 3, 4)) === "2026-01-02T03:04",
    toLocalInputValue(new Date(2026, 0, 2, 3, 4)),
  );
  check(
    "seconds are dropped, because the input cannot show them",
    toLocalInputValue(new Date(2026, 8, 15, 18, 5, 42)) === "2026-09-15T18:05",
  );

  check(
    "the input's value reads back as local time",
    fromLocalInputValue("2026-09-15T18:05")?.getTime() === sixPm.getTime(),
    String(fromLocalInputValue("2026-09-15T18:05")),
  );
  check(
    "a minute-precision date survives the round trip exactly",
    fromLocalInputValue(toLocalInputValue(sixPm))?.getTime() === sixPm.getTime(),
  );
  check(
    "a value with seconds is accepted",
    fromLocalInputValue("2026-09-15T18:05:30")?.getTime() ===
      new Date(2026, 8, 15, 18, 5, 30).getTime(),
  );

  {
    // The trap the page must avoid: re-reading the displayed value would
    // silently change a deadline that has seconds.
    const withSeconds = new Date(2026, 8, 15, 8, 14, 18, 885);
    const reread = fromLocalInputValue(toLocalInputValue(withSeconds));
    check(
      "re-reading a displayed deadline with seconds changes it — so the page must not",
      reread !== null && reread.getTime() !== withSeconds.getTime(),
      "if this ever passes as equal, the page's parse-only-on-change rule can be relaxed",
    );
  }

  for (const value of [
    "",
    "2026-09-15",
    "18:05",
    "2026-09-15 18:05",
    "2026-02-30T10:00",
    "2026-13-01T10:00",
    "2026-09-15T24:00",
    "not a date",
  ]) {
    check(`"${value}" is not a usable leave-by time`, fromLocalInputValue(value) === null);
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/advisory-test.mjs`
Expected: exits non-zero with a `SyntaxError` naming `fromLocalInputValue` (or `toLocalInputValue`) as not exported by `advisoryForm.ts`.

- [ ] **Step 3: Implement**

Append to `src/lib/advisoryForm.ts`:

```ts
/**
 * A `Date` as the value an `<input type="datetime-local">` expects:
 * `"YYYY-MM-DDTHH:MM"`, in the device's own time zone.
 *
 * Not `toISOString().slice(0, 16)`, which is UTC — in Manila that would show
 * the official a leave-by time eight hours earlier than the one residents see.
 *
 * Seconds are dropped because the input cannot show them. That makes the
 * displayed value lossy, so a caller must never parse it back unless the person
 * actually edited it — see `fromLocalInputValue`.
 */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * The input's value back to a `Date`, in the device's time zone. `null` when it
 * is empty, malformed, or names a date that does not exist.
 *
 * Parsed by hand rather than with `new Date(value)`: a string with no offset has
 * been read as local time by some engines and as UTC by others, and a leave-by
 * deadline is not somewhere to discover which one a phone's browser chose.
 *
 * Call this ONLY from the input's change handler. The displayed value has lost
 * its seconds, so re-reading it would turn an untouched deadline into a
 * "changed" one.
 */
export function fromLocalInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const [year, month, day, hour, minute, second] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  ];

  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, second);

  // `Date` quietly rolls impossible dates forward — 30 February becomes
  // 2 March. A deadline must be the one that was typed or nothing.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/advisory-test.mjs`
Expected: every line `PASS`, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/advisoryForm.ts scripts/advisory-test.mjs
git commit -m "feat: convert the leave-by input without losing time zone or seconds

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: The NOT SENT banner, and the way in from the official home

**Files:**
- Create: `src/components/usePendingAdvisory.ts`
- Create: `src/components/AdvisoryBanner.tsx`
- Modify: `src/app/official/page.tsx` (imports; insert after `<SignalPlacard />`)

**Interfaces:**
- Consumes: `pendingAdvisory`, `type PendingAdvisory` (Task 3); `queuedWrites(): Promise<QueuedWrite[]>`, `onQueueChanged(fn): () => void`, `retryBlocked(id): Promise<void>`, `flushQueue()` from `src/lib/offlineQueue.ts`; `clockLabel(iso: string): string` from `src/lib/ledger.ts`; keys `adv.not_sent`, `adv.not_sent_lift`, `adv.refused`, `adv.refused_lift`, `adv.retry`, `adv.set`, `off.change_advisory` (Task 7).
- Produces:
  - `usePendingAdvisory(barangayId: string | null): PendingAdvisory`
  - `AdvisoryBanner({ barangayId }: { barangayId: string | null })` — renders nothing when there is nothing unsent

**Testing note:** the decision logic is `pendingAdvisory`, already covered by Task 3. These are thin React wrappers, verified by type-checking, lint, the translation guard and the build here, and by the offline check in Task 12.

- [ ] **Step 1: Create the hook**

Create `src/components/usePendingAdvisory.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { onQueueChanged, queuedWrites } from "@/lib/offlineQueue";
import { pendingAdvisory, type PendingAdvisory } from "@/lib/pendingAdvisory";

const NONE: PendingAdvisory = { state: "none" };

/**
 * Whether this device holds an advisory change residents have not received.
 *
 * Re-read on every queue change rather than polled, the same signal the sync
 * strip uses — so the banner clears the moment the change is delivered, and
 * turns red the moment the queue gives up on it.
 */
export function usePendingAdvisory(barangayId: string | null): PendingAdvisory {
  const [pending, setPending] = useState<PendingAdvisory>(NONE);

  useEffect(() => {
    if (!barangayId) return;

    let live = true;
    const read = () => {
      void queuedWrites().then((rows) => {
        if (live) setPending(pendingAdvisory(rows, barangayId));
      });
    };

    // Deferred a tick, matching the other screens: every setState here happens
    // after an await, but the lint rule cannot see across that boundary.
    queueMicrotask(read);
    const stop = onQueueChanged(read);

    return () => {
      live = false;
      stop();
    };
  }, [barangayId]);

  return barangayId ? pending : NONE;
}
```

- [ ] **Step 2: Create the banner**

Create `src/components/AdvisoryBanner.tsx`:

```tsx
"use client";

import { useT } from "./AppRuntime";
import { usePendingAdvisory } from "./usePendingAdvisory";
import { flushQueue, retryBlocked } from "@/lib/offlineQueue";
import { clockLabel } from "@/lib/ledger";

/**
 * An advisory change that has not reached residents, said plainly.
 *
 * The placard above this keeps showing the SERVER's level on purpose. An
 * official who changed the signal offline must not look at their own screen,
 * see Signal 4, and believe the barangay has been told. The unsent level lives
 * here instead, next to the instruction that matters while it is unsent: use
 * the megaphone.
 *
 * State colours only — `caution` while queued, `alarm` when refused. Never the
 * signal ramp, which means severity and nothing else.
 */
export function AdvisoryBanner({ barangayId }: { barangayId: string | null }) {
  const t = useT();
  const pending = usePendingAdvisory(barangayId);

  if (pending.state === "none") return null;

  // Level 0 is "the signal was lifted", which reads wrongly as "Signal 0".
  const lifted = pending.level === 0;

  if (pending.state === "queued") {
    return (
      <p
        role="status"
        className="rounded-instrument border-[1.5px] border-caution bg-ink-800 px-3 py-2.5 text-[12.5px] leading-snug font-semibold text-caution"
      >
        {lifted ? t("adv.not_sent_lift") : t("adv.not_sent", { n: pending.level })}
        <span className="mono mt-1 block text-[10px] font-bold tracking-[0.6px] text-paper-3">
          {t("adv.set")} {clockLabel(pending.tappedAt)}
        </span>
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-instrument border-[1.5px] border-alarm bg-ink-800 px-3 py-2.5"
    >
      <p className="text-[12.5px] leading-snug font-semibold text-alarm">
        {lifted ? t("adv.refused_lift") : t("adv.refused", { n: pending.level })}
      </p>

      {/* The queue's own words. An official deciding whether to retry or to
          fix the form needs to know which rule refused it. */}
      {pending.reason && (
        <p className="mono mt-1 text-[10px] leading-relaxed text-paper-3">
          {pending.reason}
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          // `retryBlocked` only clears the flag; without the flush the change
          // would sit until the next 30-second poll.
          void retryBlocked(pending.queueId).then(() => flushQueue());
        }}
        className="tap mono mt-2 rounded-[3px] border-[1.5px] border-hv px-3 text-[10px] font-bold tracking-[0.7px] text-hv"
      >
        {t("adv.retry")}
      </button>
    </div>
  );
}
```

`t("adv.x")` appears as two separate literal calls on each side of the ternary, not `t(lifted ? … : …)` — the translation guard only detects the first form.

- [ ] **Step 3: Add the way in on the official home**

In `src/app/official/page.tsx`, replace:

```tsx
import { SignalPlacard } from "@/components/SignalPlacard";
```

with:

```tsx
import { SignalPlacard } from "@/components/SignalPlacard";
import { AdvisoryBanner } from "@/components/AdvisoryBanner";
```

Then replace:

```tsx
          <SignalPlacard />

          <div className="grid gap-2 @xl:grid-cols-2">
```

with:

```tsx
          <SignalPlacard />

          {/*
            Directly under the placard, because this is what the placard is
            about. The banner first: an official with an unsent change should
            read that before being offered another change.
          */}
          <AdvisoryBanner barangayId={snapshot.barangay.id} />

          <Link
            href="/advisory"
            className="tap mono flex items-center justify-center rounded-instrument bg-hv text-[11px] font-bold tracking-[1px] text-hv-ink"
          >
            {t("off.change_advisory")}
          </Link>

          <div className="grid gap-2 @xl:grid-cols-2">
```

`Link` is already imported in this file.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

Run: `npm run check:i18n`
Expected: `Every key the app uses is seeded by a migration.` — all seven keys this task uses were seeded in Task 7.

Run: `npm run check:writes`
Expected: `write-path check: clean (1 permitted writer)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/usePendingAdvisory.ts src/components/AdvisoryBanner.tsx src/app/official/page.tsx
git commit -m "feat: NOT SENT banner and CHANGE ADVISORY entry on the official home

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 10: The `/advisory` screen

**Files:**
- Modify: `scripts/actors-test.mjs` (the `node:fs` import; a new block before `console.log("\nShape of each tab bar:");`)
- Modify: `src/lib/advisoryAdmin.ts` (append `recentSignalHistory`)
- Create: `src/app/advisory/page.tsx`
- Modify: `src/app/sw.ts` (`SHELL_ROUTES`)

**Interfaces:**
- Consumes:
  - Task 2/4/8: `valuesFromBarangay`, `validate`, `confirmMode`, `toPatchInput`, `defaultLeaveBy`, `leaveByRequired`, `toLocalInputValue`, `fromLocalInputValue`, `type AdvisoryValues`, `type Problem`
  - Task 4: `setAdvisory`
  - Task 6: `HoldToConfirm`, `SignalPlacard({ barangay })`
  - Task 9: `AdvisoryBanner`
  - Existing: `useSync()` → `{ snapshot, online }`; `useT()`; `useMyRole(): UserRole | null`; `Skeleton`, `SkeletonRegion`, `SkeletonLines`, `useSkeletonGate`; `LeaveByStrip({ deadline: Date, signalLevel: number })`; `signalStyle(level).cssVar`; `deviceLabel(uid)`, `clockLabel(iso)` from `@/lib/ledger`
- Produces:
  - `type SignalHistoryRow = { id: string; level: number; set_by: string | null; set_at: string | null; received_at: string }`
  - `recentSignalHistory(barangayId: string): Promise<SignalHistoryRow[] | null>` — `null` when it could not be read
  - the `/advisory` route, precached

- [ ] **Step 1: Assert that every page is precached, not only the tabs**

In `scripts/actors-test.mjs`, replace:

```js
import { existsSync, readFileSync } from "node:fs";
```

with:

```js
import { existsSync, readdirSync, readFileSync } from "node:fs";
```

Then insert immediately **before** `console.log("\nShape of each tab bar:");`:

```js
/*
 * Every page, not only the ones in a tab bar.
 *
 * The checks above only walk each actor's `nav`, so a route reached from a
 * button rather than a tab was invisible to them. /advisory is the first such
 * official route, and it is exactly the kind that fails silently: it works in
 * the office, and then an official opens it with no signal — the one moment a
 * queued signal change matters — and gets the browser's error page.
 */
console.log("\nEvery page survives a lost connection, not only the tabs:");
{
  const pages = [];

  const walk = (dir, route) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `_private` folders are not routes. `(group)` folders add no segment.
        if (entry.name.startsWith("_")) continue;
        const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
        walk(join(dir, entry.name), `${route}${segment}`);
      } else if (entry.name === "page.tsx") {
        pages.push(route === "" ? "/" : route);
      }
    }
  };

  walk(join(ROOT, "src/app"), "");

  check(
    "found the app's pages",
    pages.length > 0,
    "no page.tsx under src/app — the walk itself is broken",
  );

  for (const route of pages.sort()) {
    check(
      `${route} is precached`,
      shellRoutes.has(route),
      `${route} has a page.tsx but is missing from SHELL_ROUTES in sw.ts`,
    );
  }
}
```

- [ ] **Step 2: Run it to confirm today's baseline passes**

Run: `node scripts/actors-test.mjs`
Expected: `0 failed`, including 12 new lines `/checkin is precached` … `/volunteer is precached`. Every existing page is already in `SHELL_ROUTES`; this step proves the walk finds them. The failing case comes in Step 5, when `/advisory` exists.

- [ ] **Step 3: Add the history read**

Append to `src/lib/advisoryAdmin.ts`, and add `import { getSupabase } from "./supabase";` to its imports:

```ts
export type SignalHistoryRow = {
  id: string;
  level: number;
  set_by: string | null;
  set_at: string | null;
  received_at: string;
};

/**
 * The barangay's last ten advisory changes, newest first.
 *
 * `null` means the history could not be READ — offline, most often, since this
 * is not cached. The screen says so instead of rendering an empty list, which
 * would read as "the signal has never been changed".
 *
 * For a non-official, RLS answers with zero rows rather than an error, which is
 * indistinguishable from an empty history. The screen only asks on an official's
 * behalf, so an empty array here genuinely means no changes have been recorded.
 */
export async function recentSignalHistory(
  barangayId: string,
): Promise<SignalHistoryRow[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("signal_history")
    .select("id,level,set_by,set_at,received_at")
    .eq("barangay_id", barangayId)
    .order("received_at", { ascending: false })
    .limit(10);

  if (error) return null;
  return (data ?? []) as SignalHistoryRow[];
}
```

Run: `npm run check:writes`
Expected: `clean` — a `select` is not a write.

- [ ] **Step 4: Create the page**

First read the App Router page guide under `node_modules/next/dist/docs/` (AGENTS.md). The page follows the same shape as the other client pages in `src/app/`: `"use client"`, a default-exported component, no route config.

Two rules from earlier tasks shape the code below:
- The draft is **derived**, not synced into state by an effect: `draft ?? current`. That keeps the `react-hooks/set-state-in-effect` lint rule quiet, and means the form shows the server's values again as soon as the draft is cleared.
- The leave-by input is parsed **only in its `onChange`** (Task 8). The displayed value has lost its seconds; re-reading it would make an untouched deadline look changed.

The "NOW" line shows the level and when it was set, but not who set it. The snapshot's barangay select does not include `signal_set_by`, and widening it is outside this plan. Who changed the signal is shown per change in **Recent changes**, which reads `set_by` from `signal_history`.

Create `src/app/advisory/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSync, useT } from "@/components/AppRuntime";
import { useMyRole } from "@/components/useMyRole";
import { AdvisoryBanner } from "@/components/AdvisoryBanner";
import { HoldToConfirm } from "@/components/HoldToConfirm";
import { LeaveByStrip } from "@/components/LeaveByStrip";
import { SignalPlacard } from "@/components/SignalPlacard";
import {
  Skeleton,
  SkeletonLines,
  SkeletonRegion,
  useSkeletonGate,
} from "@/components/Skeleton";
import {
  confirmMode,
  defaultLeaveBy,
  fromLocalInputValue,
  leaveByRequired,
  toLocalInputValue,
  toPatchInput,
  validate,
  valuesFromBarangay,
  type AdvisoryValues,
  type Problem,
} from "@/lib/advisoryForm";
import {
  recentSignalHistory,
  setAdvisory,
  type SignalHistoryRow,
} from "@/lib/advisoryAdmin";
import { clockLabel, deviceLabel } from "@/lib/ledger";
import { signalStyle } from "@/lib/signal";

const LEVELS = [0, 1, 2, 3, 4, 5] as const;

const INPUT =
  "tap w-full rounded-instrument border-[1.5px] border-line-soft bg-ink-800 px-3 text-[13.5px] text-paper placeholder:text-paper-3 focus:border-hv focus:outline-none";

/**
 * The official changes the advisory (PRD §4; spec 2026-09-15).
 *
 * Every resident's placard is drawn from what is confirmed here, so the screen
 * is built around not getting it wrong: a preview drawn with the real
 * components, a hold for every level change, and a deadline that must be in the
 * future. Saving goes through the offline queue, and the banner at the top says
 * plainly when a change has not reached anyone yet.
 */
export default function AdvisoryPage() {
  const { snapshot, loading } = useSync();
  const t = useT();
  const role = useMyRole();

  /** Null until the official edits something; the form then shows `current`. */
  const [draft, setDraft] = useState<AdvisoryValues | null>(null);

  /*
   * A clock, so a deadline that passes while the screen is open is caught
   * before it is issued. Thirty seconds is fine-grained enough for a deadline
   * measured in hours.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  /** `undefined` = not read yet; `null` = could not be read. */
  const [history, setHistory] = useState<SignalHistoryRow[] | null | undefined>(
    undefined,
  );

  const barangay = snapshot?.barangay ?? null;
  const barangayId = barangay?.id ?? null;
  const isOfficial = role === "official";

  // Re-read when the snapshot changes: that is how a change which has just
  // landed — pushed by the realtime subscription — shows up in the list.
  useEffect(() => {
    if (!barangayId || !isOfficial) return;
    let live = true;
    queueMicrotask(() => {
      void recentSignalHistory(barangayId).then((rows) => {
        if (live) setHistory(rows);
      });
    });
    return () => {
      live = false;
    };
  }, [barangayId, isOfficial, snapshot]);

  const waitingForRole = useSkeletonGate(role !== null);
  const waitingForSnapshot = useSkeletonGate(!loading);

  const header = (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <Link href="/official" aria-label="Back" className="shrink-0">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </Link>
      <h1 className="flex-1 font-display text-base font-extrabold tracking-[0.4px]">
        {t("off.change_advisory")}
      </h1>
    </div>
  );

  const placeholder = (
    <SkeletonRegion>
      <Skeleton className="h-[132px] rounded-instrument" />
      <Skeleton className="h-[220px] rounded-instrument" />
    </SkeletonRegion>
  );

  /*
   * Not an official — or not known to be one yet. An unverified role never gets
   * the control; after the placeholder's time is up this states the rule rather
   * than claiming anything about the person holding the phone.
   */
  if (!isOfficial) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col gap-3 p-3.5">
          {role === null && waitingForRole ? (
            placeholder
          ) : (
            <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
              {t("adv.officials_only")}
            </p>
          )}
        </main>
      </>
    );
  }

  if (!barangay) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col gap-3 p-3.5">
          {waitingForSnapshot ? (
            placeholder
          ) : (
            <p className="mono mt-8 text-center text-[11px] leading-relaxed tracking-[0.6px] text-paper-3">
              {t("ui.no_cache")}
            </p>
          )}
        </main>
      </>
    );
  }

  const current = valuesFromBarangay(barangay);
  const values = draft ?? current;
  const problems = validate(values, now);
  const mode = confirmMode(current, values, now);

  const update = (patch: Partial<AdvisoryValues>) =>
    setDraft({ ...values, ...patch });

  const chooseLevel = (level: number) =>
    update({
      level,
      evacuateBy: defaultLeaveBy(values.level, level, values.evacuateBy, now),
    });

  const confirm = () => {
    void setAdvisory({ barangayId: barangay.id, ...toPatchInput(values) });
    // Back to the server's values. Until the change lands those are the OLD
    // ones, which is the truth; the banner says what is on its way.
    setDraft(null);
  };

  // Written as literal calls so scripts/check-translations.mjs can see each key.
  const problemText = (problem: Problem) =>
    problem === "leave_by_missing"
      ? t("adv.leave_by_required")
      : problem === "leave_by_past"
        ? t("adv.deadline_passed")
        : problem === "bulletin_invalid"
          ? t("adv.bulletin_invalid")
          : t("adv.wind_invalid");

  // `toPatchInput` refuses an invalid number, so the preview waits for valid ones.
  const numbersValid = !problems.some(
    (p) => p === "bulletin_invalid" || p === "wind_invalid",
  );
  const preview = numbersValid ? toPatchInput(values) : null;

  return (
    <>
      {header}

      <main className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col gap-4 p-3.5">
        <AdvisoryBanner barangayId={barangay.id} />

        {/* What residents are reading right now — the server's truth. */}
        <p className="mono text-[11px] tracking-[0.6px] text-paper-2">
          <span className="lbl mr-2">{t("adv.now")}</span>
          {barangay.current_signal_level === 0
            ? t("ui.no_signal")
            : t("ui.signal_no", { n: barangay.current_signal_level })}
          {barangay.signal_set_at && (
            <>
              {" · "}
              {t("adv.set")} {clockLabel(barangay.signal_set_at)}
            </>
          )}
        </p>

        <section>
          <p className="lbl mb-2">{t("adv.new_level")}</p>
          <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label={t("adv.new_level")}>
            {LEVELS.map((level) => {
              const selected = values.level === level;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={level === 0 ? t("ui.no_signal") : t("ui.signal_no", { n: level })}
                  onClick={() => chooseLevel(level)}
                  className={`tap flex flex-col items-center justify-center gap-1 rounded-instrument border-[1.5px] font-display text-[18px] font-extrabold ${
                    selected
                      ? "border-hv bg-hv text-hv-ink"
                      : "border-line-soft bg-ink-800 text-paper"
                  }`}
                >
                  {level}
                  {/* Severity shown as information beside the number. The
                      button itself stays neutral: the ramp is never a control. */}
                  <span
                    aria-hidden
                    className="h-[3px] w-5 rounded-full"
                    style={{ background: signalStyle(level).cssVar }}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="lbl">{t("adv.storm")}</span>
            <input
              className={INPUT}
              value={values.stormName}
              onChange={(event) => update({ stormName: event.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="lbl">{t("adv.bulletin")}</span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={values.bulletinNo}
                onChange={(event) => update({ bulletinNo: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="lbl">{t("adv.wind")}</span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={values.windKph}
                onChange={(event) => update({ windKph: event.target.value })}
              />
            </label>
          </div>

          {leaveByRequired(values.level) && (
            <label className="grid gap-1.5">
              <span className="lbl">{t("ui.leave_by")}</span>
              <input
                className={INPUT}
                type="datetime-local"
                value={values.evacuateBy ? toLocalInputValue(values.evacuateBy) : ""}
                // Parsed here and nowhere else — see Task 8.
                onChange={(event) =>
                  update({ evacuateBy: fromLocalInputValue(event.target.value) })
                }
              />
            </label>
          )}

          {problems.length > 0 && (
            <ul className="grid gap-1" role="alert">
              {problems.map((problem) => (
                <li key={problem} className="mono text-[10.5px] font-bold tracking-[0.5px] text-alarm">
                  {problemText(problem)}
                </li>
              ))}
            </ul>
          )}
        </section>

        {preview && (
          <section className="grid gap-2">
            <p className="lbl">{t("adv.preview")}</p>
            <SignalPlacard
              barangay={{
                ...barangay,
                current_signal_level: preview.level,
                storm_name: preview.stormName,
                bulletin_no: preview.bulletinNo,
                wind_kph: preview.windKph,
                evacuate_by: preview.evacuateBy?.toISOString() ?? null,
              }}
            />
            {leaveByRequired(preview.level) && preview.evacuateBy && (
              <LeaveByStrip deadline={preview.evacuateBy} signalLevel={preview.level} />
            )}
          </section>
        )}

        {mode === "hold" ? (
          <HoldToConfirm
            label={
              values.level === 0
                ? t("adv.hold_lift")
                : t("adv.hold_issue", { n: values.level })
            }
            holdingLabel={t("sos.cancelling")}
            tone="accent"
            onConfirm={confirm}
          />
        ) : (
          <button
            type="button"
            disabled={mode === "disabled"}
            onClick={confirm}
            className="tap rounded-instrument bg-hv py-3 font-display text-[14px] font-extrabold tracking-[0.3px] text-hv-ink disabled:opacity-35"
          >
            {t("adv.save_details")}
          </button>
        )}

        <section className="grid gap-1.5">
          <p className="lbl">{t("adv.history")}</p>
          {history === undefined ? (
            <SkeletonLines rows={2} />
          ) : history === null ? (
            <p className="mono text-[11px] text-paper-3">{t("adv.history_offline")}</p>
          ) : history.length === 0 ? (
            <p className="mono text-[11px] text-paper-3">
              {barangay.current_signal_level} · {t("adv.before_history")}
            </p>
          ) : (
            <ul className="grid gap-1">
              {history.map((row) => (
                <li
                  key={row.id}
                  className="mono flex flex-wrap items-baseline gap-x-2.5 text-[11px] text-paper-2"
                >
                  <span className="text-[13px] font-bold text-paper">{row.level}</span>
                  <span>{row.set_at ? clockLabel(row.set_at) : "—"}</span>
                  <span>{deviceLabel(row.set_by)}</span>
                  <span className="text-paper-3">
                    {t("adv.sent")} {clockLabel(row.received_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 5: Run the precache test to see it fail**

Run: `node scripts/actors-test.mjs`
Expected: exits non-zero with
`FAIL  /advisory is precached  — /advisory has a page.tsx but is missing from SHELL_ROUTES in sw.ts`.

- [ ] **Step 6: Precache the route**

In `src/app/sw.ts`, replace:

```ts
const SHELL_ROUTES = ["/", "/coverage", "/sos", "/responder", "/map", "/report", "/headcount", "/checkin", "/readiness", "/volunteer", "/official", "/profile"];
```

with:

```ts
const SHELL_ROUTES = ["/", "/coverage", "/sos", "/responder", "/map", "/report", "/headcount", "/checkin", "/readiness", "/volunteer", "/official", "/profile", "/advisory"];
```

Run: `node scripts/actors-test.mjs`
Expected: `0 failed`, including `/advisory is precached`.

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run lint`
Expected: no errors.

Run: `npm run check:i18n`
Expected: `Every key the app uses is seeded by a migration.`

Run: `npm run check:writes`
Expected: `write-path check: clean (1 permitted writer)`.

Run: `npm run check:advisory`
Expected: `0 failed`.

Run: `npm run build`
Expected: completes, and the route list includes `○ /advisory`.

- [ ] **Step 8: Commit**

```bash
git add scripts/actors-test.mjs src/lib/advisoryAdmin.ts src/app/advisory/page.tsx src/app/sw.ts
git commit -m "feat: the official's advisory screen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 11: Live database checks that change nothing

**Files:**
- Modify: `scripts/rls-test.mjs` (three insertion points, below)

**Interfaces:**
- Consumes: in `rls-test.mjs` — `rest(path, { jwt, method, body })` returning `{ status, body }` (it sends `Prefer: return=representation`, so a PATCH answers with the updated rows); `rows(r)` (array length, or `-1`); `check(name, ok, detail)`; `jwt` (a fresh anonymous resident); and, inside the `promote.ok` branch, `promoteJwt` (a device just promoted to official). From Task 1: `signal_history`, `leave_by_at_evacuation`.
- Produces: 6 automated checks, plus up to 2 conditional ones.

**How every probe stays non-mutating.** This is the live barangay every resident reads, and `signal_history` is append-only by design — a row a test wrote by mistake could never be removed through the API. So each write probe sends a body that a CHECK constraint would reject **anyway**: `level: 9` (outside 0–5), or `current_signal_level: 5` with no `evacuate_by`. Postgres evaluates RLS before constraint checks, so the outcomes separate cleanly:
- refused by RLS (`403`, or `200` with zero rows for an update) → **PASS**
- rejected with `23514` → RLS let the write through and only the constraint stopped it → **LEAK**, reported as a failure

Either way nothing lands. If a first run reports a `23514` LEAK, cross-check with the read-only policy query in Task 12 Step 1 before changing anything: if that query shows no insert/update/delete policies, the ordering assumption is wrong for that probe, not the database.

**The delete check is not a REST probe.** No constraint can stop a DELETE, so a leaky policy would really erase a history row. It is verified instead by the read-only `pg_policies` query in Task 12, which confirms that no insert, update or delete policy exists at all.

- [ ] **Step 1: Add the resident's checks**

In `scripts/rls-test.mjs`, insert immediately **before** the comment block that begins:

```js
/* ---------------------------------------------------------------------------
 * The demo self-promotion path (migration 0017)
```

this block:

```js
/* ---------------------------------------------------------------------------
 * The advisory and its history (migration 0021)
 *
 * Every probe here changes nothing whether it passes or fails. This is the live
 * barangay every resident reads, and signal_history is append-only — a stray
 * row written by a test could never be cleaned up through the API.
 *
 * So each write sends a body a CHECK constraint would reject anyway. Postgres
 * checks RLS first: refused by RLS is the pass; rejected by the constraint
 * (23514) means RLS let the write through — the leak, caught before it landed.
 * ------------------------------------------------------------------------ */

console.log("\nThe advisory, as a resident (migration 0021):");

const barangayId = (await rest("barangays?select=id&limit=1", { jwt })).body?.[0]?.id;

// Signal 5 with no deadline violates leave_by_at_evacuation whatever state the
// live row is in, so even a leaking policy could not change the advisory.
const residentUpdate = await rest(`barangays?id=eq.${barangayId}`, {
  jwt,
  method: "PATCH",
  body: { current_signal_level: 5, evacuate_by: null },
});
check(
  "CANNOT change the barangay's advisory",
  residentUpdate.status === 200 && rows(residentUpdate) === 0,
  residentUpdate.body?.code === "23514"
    ? "LEAK: RLS let a resident's update through — only the leave-by constraint stopped it"
    : `status ${residentUpdate.status}, ${rows(residentUpdate)} rows`,
);

const residentInsert = await rest("signal_history", {
  jwt,
  method: "POST",
  body: { barangay_id: barangayId, level: 9 },
});
check(
  "CANNOT write to signal_history",
  residentInsert.status === 401 || residentInsert.status === 403,
  residentInsert.body?.code === "23514"
    ? "LEAK: RLS allowed a resident's insert — only the level constraint stopped it"
    : `status ${residentInsert.status}`,
);
```

- [ ] **Step 2: Add the official's checks**

Inside the `else if (promote.ok) {` branch, insert immediately **before** the line:

```js
  const demote = await fetch(`${URL_}/rest/v1/rpc/set_demo_role`, {
```

this block:

```js
  console.log("\nThe advisory, as an official (migration 0021):");

  const historyCount = async () =>
    rows(await rest("signal_history?select=id", { jwt: promoteJwt }));

  const historyBefore = await historyCount();
  check(
    "an official can read signal_history",
    historyBefore >= 0,
    "the read errored",
  );

  // The resident's refused change, repeated here where the history can be
  // counted: a change that did not happen must leave no record that it did.
  await rest(`barangays?id=eq.${barangayId}`, {
    jwt,
    method: "PATCH",
    body: { current_signal_level: 5, evacuate_by: null },
  });
  check(
    "a refused change writes no history row",
    (await historyCount()) === historyBefore,
  );

  // Only meaningful when there is something to hide. Against an empty table a
  // resident sees zero rows whether RLS works or not.
  if (historyBefore > 0) {
    check(
      "a resident sees none of the history an official can",
      rows(await rest("signal_history?select=id", { jwt })) === 0,
      "LEAK: a resident can read who changed the signal",
    );
  } else {
    console.log("  SKIPPED  a resident reading history — no history rows yet");
  }

  const officialInsert = await rest("signal_history", {
    jwt: promoteJwt,
    method: "POST",
    body: { barangay_id: barangayId, level: 9 },
  });
  check(
    "an official CANNOT write to signal_history directly",
    officialInsert.status === 401 || officialInsert.status === 403,
    officialInsert.body?.code === "23514"
      ? "LEAK: RLS allowed an official's insert — only the level constraint stopped it"
      : `status ${officialInsert.status}`,
  );

  // An update needs a real row to aim at: against nothing, zero rows comes back
  // whether a policy refused it or not.
  const newest = (
    await rest("signal_history?select=id,level&order=received_at.desc&limit=1", {
      jwt: promoteJwt,
    })
  ).body?.[0];

  if (newest) {
    const edit = await rest(`signal_history?id=eq.${newest.id}`, {
      jwt: promoteJwt,
      method: "PATCH",
      body: { level: 9 },
    });
    const reread = (
      await rest(`signal_history?select=level&id=eq.${newest.id}`, { jwt: promoteJwt })
    ).body?.[0];
    check(
      "an official CANNOT edit a history row",
      rows(edit) === 0 && reread?.level === newest.level,
      edit.body?.code === "23514"
        ? "LEAK: RLS allowed an official's edit — only the level constraint stopped it"
        : `status ${edit.status}, level now ${reread?.level}`,
    );
  } else {
    console.log("  SKIPPED  editing a history row — no history rows yet");
  }

  // Rejected whatever state the live row is in, so it cannot change the advisory.
  const noDeadline = await rest(`barangays?id=eq.${barangayId}`, {
    jwt: promoteJwt,
    method: "PATCH",
    body: { current_signal_level: 5, evacuate_by: null },
  });
  check(
    "Signal 3+ without a leave-by time is rejected by the database",
    noDeadline.status === 400 && noDeadline.body?.code === "23514",
    `status ${noDeadline.status}, code ${noDeadline.body?.code}`,
  );
```

- [ ] **Step 3: Report the official checks as skipped when nobody can be promoted**

In the same file, replace:

```js
  console.log("  CLOSED  set_demo_role is not installed — roles are granted by officials only.");
```

with:

```js
  console.log("  CLOSED  set_demo_role is not installed — roles are granted by officials only.");
  console.log("  SKIPPED the official's advisory checks — they need an official account.");
```

And replace:

```js
  console.log(`  UNKNOWN set_demo_role answered ${promote.status}.`);
```

with:

```js
  console.log(`  UNKNOWN set_demo_role answered ${promote.status}.`);
  console.log("  SKIPPED the official's advisory checks — they need an official account.");
```

Skipped, not failed: once `set_demo_role` is dropped for a real deployment, `verify` must not turn red for doing the right thing.

- [ ] **Step 4: Run the suite**

Run: `node scripts/rls-test.mjs`

Expected, against the live database while `signal_history` is still empty:
- every check `PASS`, ending **`28 passed, 0 failed`** (22 before this task, plus 2 resident and 4 official checks)
- `SKIPPED  a resident reading history — no history rows yet`
- `SKIPPED  editing a history row — no history rows yet`
- the demotion check still `PASS`

Once a real change has been made (Task 12), a re-run shows **`30 passed, 0 failed`** with no SKIPPED advisory lines.

If a check reports **LEAK**, stop. The database is wrong, not the test — do not edit the probe to make it pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/rls-test.mjs
git commit -m "test: non-mutating live checks for the advisory and its history

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 12: Full verification and the manual checks

**Files:** none changed. This task produces evidence, not code.

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: confirmation that the append-only guarantee, the trigger, live delivery and the offline path all hold on real devices.

**Before Step 3:** the happy path issues a **real** change to the live advisory that every resident reads. It is the feature's first legitimate use, not test data — agree the values with the team first. Re-issuing Signal 3 with a correct wind speed and a leave-by time in the future is a good choice: the live row's deadline passed on 2026-09-05, so this also fixes what residents see today.

- [ ] **Step 1: Confirm history cannot be written, edited or deleted (read-only)**

This replaces a REST delete probe, which could not be made non-mutating (no constraint stops a DELETE).

Run with the Supabase MCP `execute_sql` tool:

```sql
select cmd, count(*) as policies
from pg_policies
where schemaname = 'public' and tablename = 'signal_history'
group by cmd
order by cmd;
```

Expected: exactly **one** row — `cmd = SELECT`, `policies = 1`.

Any row for `INSERT`, `UPDATE`, `DELETE` or `ALL` means a client can alter history. Stop and report it; do not continue to Step 3.

- [ ] **Step 2: Run the full gate**

Run: `npm run verify`

Expected:
- every suite ends `0 failed`, including `check:advisory` and `check:actors`
- the build's route list includes `○ /advisory`
- `rls-test` ends `28 passed, 0 failed`, with the two `SKIPPED … no history rows yet` lines

- [ ] **Step 3: The happy path, by hand**

1. Open the app. While `set_demo_role` is installed, use the **DEMO** switch → **OFFICIAL**.
2. On the official home, confirm the **CHANGE ADVISORY** button sits under the placard.
3. Open it. Confirm the form shows today's values and **Save details** is disabled — nothing changed yet, so nothing is offered.
4. Enter the agreed values, including a wind speed. Confirm the preview placard and leave-by strip show them.
5. If the level changed, confirm the control reads **Press and hold to issue Signal No. N**, that a short press does nothing, and that holding ~2 seconds issues it.

Then run with `execute_sql`:

```sql
select
  h.level,
  h.wind_kph,
  h.bulletin_no,
  h.evacuate_by,
  h.set_by is not null as has_setter,
  h.set_by = b.signal_set_by as setter_matches,
  h.set_at <= h.received_at as tapped_before_received,
  (select count(*) from public.signal_history) as history_rows
from public.signal_history h
join public.barangays b on b.id = h.barangay_id
order by h.received_at desc
limit 1;
```

Expected: the values you entered, `has_setter = true`, `setter_matches = true`, `tapped_before_received = true`, `history_rows = 1`.

`history_rows = 1` for one change is the point: the trigger wrote exactly one row. `has_setter = true` confirms the trigger fired for a non-owner update without an `EXECUTE` grant.

- [ ] **Step 4: Live update on a second device, by hand**

1. On a second device or browser profile, open the app as a resident on the home screen. Leave it open.
2. On the official device, save a detail change (for example, the bulletin number).
3. On the second device, without reloading: the placard updates within about 5 seconds.
4. Watch the moment it changes. It must go straight to the new values. A brief flash of older values means `AppRuntime` is calling `load()` instead of `refreshAdvisory()` — see Task 5.

- [ ] **Step 5: The offline path, by hand**

1. On the official device, go offline — airplane mode, or DevTools → Network → **Offline**. (Not a script that overrides `window.fetch`: supabase-js captures `fetch` when its client is created, so an override made later is bypassed.)
2. On `/advisory`, change a detail and save.
3. Confirm the amber **NOT SENT YET** banner appears on `/advisory` and on `/official`, and that both placards still show the **old** values.
4. Reconnect. Confirm the banner clears on its own, and the second device from Step 4 updates.
5. Run `select count(*) from public.signal_history;` — it has risen by exactly one.

- [ ] **Step 6: Re-run the live checks now that history exists**

Run: `node scripts/rls-test.mjs`
Expected: `30 passed, 0 failed`, and no `SKIPPED … no history rows yet` lines — the resident-read and edit-a-row checks now have a real row to aim at.

- [ ] **Step 7: Report**

No commit — nothing changed. Report the results of Steps 1–6, including the exact output of Steps 1, 3 and 6. If any step did not match its expected result, say which and what was seen instead.
