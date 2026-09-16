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
  toBarangayPatch,
  toPatchInput,
  validate,
  valuesFromBarangay,
} from "../src/lib/advisoryForm.ts";
import { pendingAdvisory } from "../src/lib/pendingAdvisory.ts";

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
      JSON.stringify([
        "bulletin_no",
        "current_signal_level",
        "evacuate_by",
        "signal_set_at",
        "storm_name",
        "wind_kph",
      ]),
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

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
