/**
 * Folding the write queue into the hazard feed (FR-7.2, FR-7.3).
 *
 * The first test here is the bug a user reported in one sentence: "it shows
 * unresolved even when I resolved it already". The feed filtered queued UPDATEs
 * out of its merge, so marking a report fixed was invisible to the very screen
 * the volunteer tapped it on until the write reached the server. Online that is
 * a flicker; offline the report sits there contradicting them indefinitely.
 *
 * The mirror-image mistake is tested too, because `rescueMerge.ts` shipped it:
 * a queued update must not be turned into a row of its own either. One of these
 * failures brings a cancelled SOS back from the dead; the other leaves a fixed
 * road marked blocked. Both come from treating "a queued write" as one thing.
 *
 * Run:  node scripts/hazard-merge-test.mjs
 */

import {
  mergeHazards,
  queuedInserts,
  queuedPatches,
} from "../src/lib/hazardMerge.ts";

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

console.log("\nHazard feed vs the write queue — SalbaBayan\n");

const serverRow = (id, status = "open", ts = "2026-09-10T00:00:00.000Z") => ({
  id,
  status,
  ts,
  category: "blocked_road",
});

const insertRow = (id, at = 1000) => ({
  id,
  table: "hazard_reports",
  op: "insert",
  payload: { id, category: "flooding", status: "open", ts: "2026-09-11T00:00:00.000Z" },
  createdAt: at,
});

const resolveRow = (id, at = 2000, blocked = false) => ({
  id: `${id}:update`,
  table: "hazard_reports",
  op: "update",
  payload: { id, status: "resolved" },
  createdAt: at,
  blocked,
});

const build = (p, id, ts) => ({
  id,
  status: p.status ?? "open",
  ts,
  category: p.category ?? "other",
  pending: true,
});

const openOf = (rows) => rows.filter((r) => r.status === "open");
const resolvedOf = (rows) => rows.filter((r) => r.status === "resolved");

/* -------------------------------------------------------------------------
 * The reported bug
 * ---------------------------------------------------------------------- */

console.log("A resolve that has not reached the server yet:");

const queue = [resolveRow("h1")];
const merged = mergeHazards(
  [serverRow("h1")],
  queuedInserts(queue, build),
  queuedPatches(queue),
);

check(
  "leaves the unresolved list",
  openOf(merged).length === 0,
  `still ${openOf(merged).length} open`,
);
check("appears under resolved", resolvedOf(merged).length === 1);
check(
  "and is marked as not yet sent",
  merged[0]?.pending === true,
  "a local intention must not look like a fact others can see",
);
check(
  "without duplicating the row",
  merged.length === 1,
  `${merged.length} rows`,
);

/* -------------------------------------------------------------------------
 * The mirror-image mistake rescueMerge shipped
 * ---------------------------------------------------------------------- */

console.log("\nA queued update is never a row of its own:");

const orphan = [resolveRow("not-in-this-feed")];
const orphanMerged = mergeHazards([serverRow("h1")], queuedInserts(orphan, build), queuedPatches(orphan));
check(
  "a patch for a report this device cannot see is dropped",
  orphanMerged.length === 1 && orphanMerged[0].id === "h1",
  `${orphanMerged.length} rows: ${orphanMerged.map((r) => r.id).join(", ")}`,
);
check(
  "and does not invent a resolved report",
  resolvedOf(orphanMerged).length === 0,
);

/* -------------------------------------------------------------------------
 * Safety direction
 * ---------------------------------------------------------------------- */

console.log("\nA write the server refused is not an intention to honour:");

const blocked = [resolveRow("h1", 2000, true)];
const blockedMerged = mergeHazards([serverRow("h1")], queuedInserts(blocked, build), queuedPatches(blocked));
check(
  "a blocked resolve leaves the report unresolved",
  openOf(blockedMerged).length === 1,
  "showing a road as clear on a write RLS threw away is the one unsafe direction",
);
check("and does not mark it pending", !blockedMerged[0].pending);

/* -------------------------------------------------------------------------
 * Offline reporting, and resolving what you just reported
 * ---------------------------------------------------------------------- */

console.log("\nOffline, with no server rows at all:");

const offline = [insertRow("h2")];
const offlineMerged = mergeHazards([], queuedInserts(offline, build), queuedPatches(offline));
check(
  "a report filed offline is visible",
  offlineMerged.length === 1 && offlineMerged[0].status === "open",
);

const both = [insertRow("h2", 1000), resolveRow("h2", 3000)];
const bothMerged = mergeHazards([], queuedInserts(both, build), queuedPatches(both));
check(
  "resolving it offline moves it, rather than duplicating it",
  bothMerged.length === 1 && bothMerged[0].status === "resolved",
  `${bothMerged.length} rows, status ${bothMerged[0]?.status}`,
);

/* -------------------------------------------------------------------------
 * Ordering
 * ---------------------------------------------------------------------- */

console.log("\nOrdering:");

const late = [resolveRow("h1", 5000)];
const server = [serverRow("h1", "open", "2026-09-10T00:00:00.000Z")];
check(
  "an un-flushed local update outranks the server row it targets",
  mergeHazards(server, [], queuedPatches(late))[0].status === "resolved",
);

const twice = [
  { ...resolveRow("h1", 1000), payload: { id: "h1", status: "open" } },
  resolveRow("h1", 9000),
];
check(
  "the later patch wins",
  mergeHazards(server, [], queuedPatches(twice))[0].status === "resolved",
);

const ordered = mergeHazards(
  [serverRow("a", "open", "2026-09-01T00:00:00.000Z"), serverRow("b", "open", "2026-09-09T00:00:00.000Z")],
  [],
  new Map(),
);
check("newest first", ordered[0].id === "b");

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code and let Node exit on its own; calling process.exit() here races
// the native TypeScript-stripping loader and trips a libuv assertion on Windows.
process.exitCode = fail === 0 ? 0 : 1;
