/**
 * Readiness aggregation (PRD §5.2 F4, FR-4.1/4.2/4.3).
 *
 * The failure this guards against is specific and was real: two of the five
 * checks read RLS-scoped tables, and a viewer who is not permitted to read
 * them gets a count of 0 rather than an error. Rendered naively that paints a
 * fully configured barangay red — "0 volunteers, 0 residents" — on the phone
 * of every resident who opens the screen. A readiness dashboard that cries
 * wolf before a storm is worse than no dashboard, so "I am not allowed to
 * look" must never be reported as "it has not been done".
 *
 * Imported straight from TypeScript; Node strips the types, so this exercises
 * the shipping source rather than a copy.
 *
 * Run:  node scripts/readiness-test.mjs
 */

import {
  assignedVolunteerCount,
  buildReadiness,
  overallStatus,
  readyCount,
} from "../src/lib/readiness.ts";

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

/** A fully configured barangay, seen by an official who may read everything. */
const configured = {
  purokCount: 8,
  protocolCells: 40,
  referencedKeys: ["action.a", "headline.a"],
  fullyTranslatedKeys: ["action.a", "headline.a"],
  volunteerCount: 4,
  volunteerCountKnown: true,
  residentCount: 48,
  residentCountKnown: true,
  expectedHouseholds: 48,
  centresWithCoordinates: 3,
  centreCount: 3,
};

const by = (checks, id) => checks.find((c) => c.id === id);

console.log("\nReadiness aggregation — SalbaBayan\n");

console.log("A configured barangay, seen by an official:");
{
  const checks = buildReadiness(configured);
  check("every check is ready", readyCount(checks) === checks.length);
  check("overall reads ready", overallStatus(checks) === "ready");
}

console.log("\nPermission is not a verdict:");
{
  /*
   * The exact shape of the bug: a resident's session. RLS returns zero rows
   * for both roster tables, so the counts arrive as 0 from a barangay that is
   * in fact fully staffed and fully registered.
   */
  const resident = {
    ...configured,
    volunteerCount: 0,
    volunteerCountKnown: false,
    residentCount: 0,
    residentCountKnown: false,
  };
  const checks = buildReadiness(resident);

  check(
    "a hidden volunteer roster is unknown, not missing",
    by(checks, "volunteers").status === "unknown",
    `got ${by(checks, "volunteers").status}`,
  );
  check(
    "a hidden resident roster is unknown, not missing",
    by(checks, "residents").status === "unknown",
    `got ${by(checks, "residents").status}`,
  );
  check(
    "the volunteer unknown explains itself",
    by(checks, "volunteers").detail === "not-permitted",
  );
  check(
    "the resident unknown explains itself",
    by(checks, "residents").detail === "not-permitted",
  );
  check(
    "nothing the viewer CAN see is disturbed",
    by(checks, "protocols").status === "ready" &&
      by(checks, "centres").status === "ready",
  );
  check(
    "an unknown never reads as ready overall",
    overallStatus(checks) === "partial",
    `got ${overallStatus(checks)}`,
  );

  /*
   * A volunteer sits between the two: staff, so the resident roster is
   * readable, but `read_own_role` still returns only their own row.
   */
  const volunteer = {
    ...configured,
    volunteerCount: 1,
    volunteerCountKnown: false,
    residentCountKnown: true,
  };
  const vchecks = buildReadiness(volunteer);
  check(
    "a volunteer's own row is not mistaken for the roster",
    by(vchecks, "volunteers").status === "unknown",
    `got ${by(vchecks, "volunteers").status}`,
  );
  check(
    "a volunteer still gets a real resident count",
    by(vchecks, "residents").status === "ready",
  );
}

console.log("\nGaps an official must still see:");
{
  const gaps = buildReadiness({
    ...configured,
    protocolCells: 33,
    fullyTranslatedKeys: ["action.a"],
    volunteerCount: 0,
    residentCount: 0,
  });
  check(
    "an empty roster the viewer CAN read is missing, not unknown",
    by(gaps, "volunteers").status === "missing",
    `got ${by(gaps, "volunteers").status}`,
  );
  check(
    "zero registered residents against a baseline is missing",
    by(gaps, "residents").status === "missing",
  );
  check("a partly filled protocol grid is partial", by(gaps, "protocols").status === "partial");
  check("a partly translated set is partial", by(gaps, "translations").status === "partial");
  check("one missing check makes the whole barangay missing", overallStatus(gaps) === "missing");

  check(
    "a single assigned volunteer is partial — one person is a single point of failure",
    by(buildReadiness({ ...configured, volunteerCount: 1 }), "volunteers").status === "partial",
  );
}

console.log("\nAbsent data is admitted, never guessed:");
{
  const noBaseline = buildReadiness({ ...configured, expectedHouseholds: null });
  check(
    "no household baseline means unknown",
    by(noBaseline, "residents").status === "unknown",
  );
  check(
    "and says why",
    by(noBaseline, "residents").detail === "no-baseline",
  );

  const noCentres = buildReadiness({
    ...configured,
    centresWithCoordinates: 0,
    centreCount: 0,
  });
  check(
    "a barangay with no centres at all is unknown, not 0/0 ready",
    by(noCentres, "centres").status === "unknown",
    `got ${by(noCentres, "centres").status}`,
  );
}

/*
 * Who counts as an assigned volunteer.
 *
 * This check read 20 of 2 — ready — against a barangay with one volunteer an
 * official had actually assigned. It counted every row in user_roles, and the
 * demo switch writes one per device: officials, devices that switched back to
 * resident (a demotion updates the role, it does not delete the row), and
 * devices that promoted THEMSELVES. The check whose job is to warn "you have
 * too few volunteers" could not go red. These cases pin down what it counts.
 */
console.log("\nWho counts as an assigned volunteer:");
{
  const OFFICIAL = "11111111-0000-0000-0000-000000000000";
  const row = (user_id, role, granted_by) => ({ user_id, role, granted_by });

  check(
    "a volunteer assigned by an official counts",
    assignedVolunteerCount([row("v1", "volunteer", OFFICIAL)]) === 1,
  );
  check(
    "an official is not a volunteer",
    assignedVolunteerCount([row(OFFICIAL, "official", "someone")]) === 0,
  );
  check(
    "a device that switched back to resident does not count",
    assignedVolunteerCount([row("r1", "resident", "r1")]) === 0,
    "a demotion leaves a row behind with role 'resident'",
  );
  check(
    "a device that made ITSELF a volunteer does not count",
    assignedVolunteerCount([row("v2", "volunteer", "v2")]) === 0,
    "self-granted through the demo switch — nobody assigned it",
  );
  check(
    "a volunteer granted outside the app (no granted_by) still counts",
    assignedVolunteerCount([row("v3", "volunteer", null)]) === 1,
    "a role inserted with SQL has no recorded granter, but was assigned",
  );
  check("an empty roster is zero", assignedVolunteerCount([]) === 0);

  // The live database on 2026-09-18, row for row.
  const live = [
    ...Array.from({ length: 12 }, (_, i) => row(`r${i}`, "resident", `r${i}`)),
    ...Array.from({ length: 3 }, (_, i) => row(`sv${i}`, "volunteer", `sv${i}`)),
    // The one real volunteer was inserted with SQL, so nobody is recorded as
    // having granted it. Excluding null granters would drop it and read 0.
    row("assigned", "volunteer", null),
    ...Array.from({ length: 3 }, (_, i) => row(`so${i}`, "official", `so${i}`)),
    row(OFFICIAL, "official", "seed"),
  ];
  const count = assignedVolunteerCount(live);
  check(
    "today's roster reads 1, not 20",
    count === 1,
    `got ${count}`,
  );
  check(
    "which is partial, not ready",
    by(buildReadiness({ ...configured, volunteerCount: count }), "volunteers").status ===
      "partial",
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
