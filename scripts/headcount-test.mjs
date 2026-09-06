/**
 * Headcount ledger logic (PRD §7.8, FR-8.1/8.2).
 *
 * The arithmetic behind a number a rescue decision is made from. It is worth
 * testing separately from the concurrency gate because these are the failures
 * that produce a *plausible* wrong answer rather than an error — a count that
 * is simply too low reads exactly like a count that is right.
 *
 * Imported straight from TypeScript; Node strips the types, so this exercises
 * the shipping source rather than a copy.
 *
 * Run:  node scripts/headcount-test.mjs
 */

import { capacityState, totalFrom, deviceLabel } from "../src/lib/ledger.ts";

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

const entry = (delta) => ({ id: crypto.randomUUID(), delta });

console.log("\nHeadcount ledger — SalbaBayan\n");

console.log("Sum over the ledger:");
check("empty ledger is zero, not blank", totalFrom([]) === 0);
check(
  "positives and negatives net correctly",
  totalFrom([entry(1), entry(4), entry(-1), entry(2)]) === 6,
  `got ${totalFrom([entry(1), entry(4), entry(-1), entry(2)])}`,
);
check(
  "a correction fully cancels its mistake",
  totalFrom([entry(5), entry(-5)]) === 0,
);
/*
 * The ledger can legitimately go negative if corrections outrun entries — a
 * volunteer fixing a double count at shift change. It must not clamp silently:
 * a negative total is visible evidence of a reconciliation error, and hiding it
 * would leave the real count wrong with nothing to notice.
 */
check(
  "over-correction is allowed to show negative rather than clamping",
  totalFrom([entry(2), entry(-5)]) === -3,
  `got ${totalFrom([entry(2), entry(-5)])}`,
);

console.log("\nCapacity state (FR-8.2):");
check("empty centre is ok", capacityState(0, 150) === "ok");
check("half full is ok", capacityState(75, 150) === "ok");
/*
 * The warning has to arrive before the doors close. A family already walking
 * to a centre that fills while they are en route has to turn around in the
 * rain, so "filling" starts at 75%, not at 99%.
 */
// 75% of 150 is 112.5, so 113 is the first count at or above the threshold
// and 112 is the last one below it. An earlier version of this test asserted
// 112 and failed for its own arithmetic rather than the code's.
check(
  "warns at 75%, not at the last moment",
  capacityState(113, 150) === "filling",
  `113/150 -> ${capacityState(113, 150)}`,
);
check("the count just below the threshold is still ok", capacityState(112, 150) === "ok");
check("exactly at capacity is full", capacityState(150, 150) === "full");
check("over capacity is full, not filling", capacityState(163, 150) === "full");
/*
 * An unconfigured capacity must not read as "full" — that would tell a
 * volunteer to turn people away from a centre with room, on the strength of a
 * missing field.
 */
check(
  "capacity of zero reads ok, never full",
  capacityState(20, 0) === "ok",
  `got ${capacityState(20, 0)}`,
);

console.log("\nRecorder label:");
check(
  "a uid becomes a short readable code",
  deviceLabel("4cd758f8-3b33-4f22-b37b-0222226d726b") === "D-4CD7",
  deviceLabel("4cd758f8-3b33-4f22-b37b-0222226d726b"),
);
check("a missing recorder does not render as 'null'", deviceLabel(null) === "—");

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code and let Node exit on its own. Calling process.exit() here
// races the native TypeScript-stripping loader as it tears down and trips a
// libuv assertion on Windows, which fails the run after the tests passed.
process.exitCode = fail === 0 ? 0 : 1;
