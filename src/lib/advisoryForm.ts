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
