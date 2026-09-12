/**
 * Who may mark a hazard fixed (FR-7.2).
 *
 * This is a rule about authority during an emergency, which makes it exactly
 * the kind of thing that must not be verified by clicking around: the failure
 * is silent in both directions. Too permissive and a passer-by clears a
 * downed-power-line warning they know nothing about, and the barangay stops
 * avoiding a live cable. Too strict and a volunteer standing at the cleared
 * road cannot say so, and everyone keeps walking the long way.
 *
 * The database is what actually enforces this — `resolve_hazards` in
 * supabase/migrations/0003. These tests cover the client-side mirror, whose job
 * is to decide whether the app OFFERS the action. Both have to agree, so the
 * cases below are written from the policy, not from the UI.
 *
 * Run:  node scripts/hazard-permission-test.mjs
 */

import { canResolveHazard, isStaff } from "../src/lib/hazardPermission.ts";

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

console.log("\nWho may mark a hazard fixed — SalbaBayan\n");

const RESIDENT = "uid-resident";
const OTHER_RESIDENT = "uid-other-resident";
const VOLUNTEER = "uid-volunteer";

const byResident = { reported_by: RESIDENT };
const byVolunteer = { reported_by: VOLUNTEER };
const byNobody = { reported_by: null };

console.log("Staff:");
check("volunteer counts as staff", isStaff("volunteer"));
check("official counts as staff", isStaff("official"));
check("resident does not", !isStaff("resident"));
check("an unresolved role does not", !isStaff(null));

console.log("\nA resident's own report:");
check(
  "the resident who filed it may fix it",
  canResolveHazard(byResident, RESIDENT, "resident"),
);
check(
  "a volunteer may fix it",
  canResolveHazard(byResident, VOLUNTEER, "volunteer"),
);
check(
  "an official may fix it",
  canResolveHazard(byResident, VOLUNTEER, "official"),
);
check(
  "a DIFFERENT resident may not",
  !canResolveHazard(byResident, OTHER_RESIDENT, "resident"),
);

console.log("\nA volunteer's report — volunteers only:");
check(
  "the volunteer who filed it may fix it",
  canResolveHazard(byVolunteer, VOLUNTEER, "volunteer"),
);
check(
  "another volunteer may fix it",
  canResolveHazard(byVolunteer, "uid-other-volunteer", "volunteer"),
);
check(
  "a resident may NOT fix a volunteer's report",
  !canResolveHazard(byVolunteer, RESIDENT, "resident"),
);

/*
 * The two ways a client can hold no answer yet, which must never be mistaken
 * for authority. `role` is null until `getMyRole()` resolves, and `uid` is null
 * until the anonymous session exists — both happen on every cold load.
 */
console.log("\nUnknown is not permission:");
check(
  "an unresolved role still lets you fix your OWN report",
  canResolveHazard(byResident, RESIDENT, null),
  "the uid match does not depend on knowing the role",
);
check(
  "...but it grants nothing on someone else's report",
  !canResolveHazard(byResident, OTHER_RESIDENT, null),
);
check(
  "no session yet means no",
  !canResolveHazard(byResident, null, "resident"),
);

/*
 * A row whose reporter is null — possible for seeded fixture rows, which is
 * exactly the case that would break a naive `hazard.reported_by === uid` when
 * uid is also null. Two unknowns must not compare equal into a permission.
 */
console.log("\nA report with no reporter:");
check(
  "null reporter and null uid do not match into permission",
  !canResolveHazard(byNobody, null, "resident"),
);
check(
  "null reporter grants a resident nothing",
  !canResolveHazard(byNobody, RESIDENT, "resident"),
);
check(
  "but staff can still clear it",
  canResolveHazard(byNobody, VOLUNTEER, "volunteer"),
);

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code and let Node exit on its own; calling process.exit() here races
// the native TypeScript-stripping loader and trips a libuv assertion on Windows.
process.exitCode = fail === 0 ? 0 : 1;
