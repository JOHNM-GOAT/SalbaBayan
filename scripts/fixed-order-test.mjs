/**
 * The order of the FIXED tab (src/lib/fixedOrder.ts).
 *
 * A list in the wrong order looks exactly like a list in the right order, so
 * this is checked rather than eyeballed. The official reading that tab will
 * believe whatever is at the top is the most recent thing the barangay
 * finished; if that is false, it is false silently.
 *
 * Run:  node scripts/fixed-order-test.mjs
 */

import { byMostRecentlyCleared, clearedAt } from "../src/lib/fixedOrder.ts";

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

const LOADED = "2026-09-25T14:00:00.000Z";

console.log("\nThe FIXED tab — SalbaBayan\n");

console.log("When a hazard was cleared:");
{
  check(
    "the stamped time wins",
    clearedAt(
      { ts: "2026-09-20T01:00:00Z", resolved_at: "2026-09-25T09:00:00Z", pending: false },
      LOADED,
    ) === "2026-09-25T09:00:00Z",
  );

  check(
    "a resolve still in the queue counts as now",
    clearedAt({ ts: "2026-09-20T01:00:00Z", resolved_at: null, pending: true }, LOADED) === LOADED,
    "otherwise the official's own tap is buried under older clearings",
  );

  check(
    "a row cleared before the column existed falls back to its report time",
    clearedAt({ ts: "2026-09-20T01:00:00Z", resolved_at: null, pending: false }, LOADED) ===
      "2026-09-20T01:00:00Z",
    "nothing knows when; inventing a time would be worse than saying little",
  );

  check(
    "a stamped time is used even while the row is still pending",
    clearedAt(
      { ts: "2026-09-20T01:00:00Z", resolved_at: "2026-09-25T09:00:00Z", pending: true },
      LOADED,
    ) === "2026-09-25T09:00:00Z",
    "the server has answered; a later queued edit does not unanswer it",
  );
}

console.log("\nSorting both kinds together:");
{
  /*
   * The case the whole change exists for: a tree REPORTED days before a puddle
   * but cleared after it. Sorted by report time the tree sinks; sorted by when
   * each was dealt with, it rises.
   */
  const tree = { ts: "2026-09-21T02:00:00Z", doneAt: "2026-09-25T11:00:00Z" };
  const puddle = { ts: "2026-09-25T08:00:00Z", doneAt: "2026-09-25T09:00:00Z" };

  const order = [puddle, tree].sort(byMostRecentlyCleared);
  check("the thing finished most recently is first", order[0] === tree, JSON.stringify(order));

  const byReport = [puddle, tree].sort((a, b) => b.ts.localeCompare(a.ts));
  check(
    "which is NOT the order report time would have given",
    byReport[0] === puddle,
    "if this ever agrees, the test case stopped testing anything",
  );

  /* A row with no resolution time at all still sorts, by the only time it has. */
  const old = { ts: "2026-09-19T05:00:00Z" };
  const all = [old, puddle, tree].sort(byMostRecentlyCleared);
  check(
    "a row with no clearing time sorts by its report time",
    all[0] === tree && all[2] === old,
    JSON.stringify(all),
  );

  check(
    "two rows cleared at the same moment keep a stable order",
    [
      { ts: "2026-09-01T00:00:00Z", doneAt: LOADED },
      { ts: "2026-09-02T00:00:00Z", doneAt: LOADED },
    ].sort(byMostRecentlyCleared)[0].ts === "2026-09-01T00:00:00Z",
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
