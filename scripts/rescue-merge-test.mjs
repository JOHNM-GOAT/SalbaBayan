/**
 * Rescue queue merge (PRD §7.4, FR-4.5).
 *
 * The bug this pins down was reported from a real device: holding "bitawan
 * para itigil" cancelled the SOS and the SOS immediately came back, timer
 * restarting from zero, over and over.
 *
 * Cause: cancelling enqueues an UPDATE, and the merge turned every queued row
 * for the table into a request with `status: "pending"` hard coded and `ts`
 * set to the moment it was queued — under the synthetic `<uuid>:update` key,
 * which id-based de-duplication could not collapse. So the cancel became a
 * brand-new pending request dated now. Offline, where the queue cannot drain,
 * it never stopped.
 *
 * Run:  node scripts/rescue-merge-test.mjs
 */

import {
  mergeRequests,
  queuedInserts,
  queuedPatches,
} from "../src/lib/rescueMerge.ts";

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

const REQ = "11111111-1111-1111-1111-111111111111";
const TAP = "2026-09-06T15:00:00.000Z";

const build = (p, id, ts) => ({
  id,
  status: "pending",
  ts,
  purok_id: p.purok_id ?? null,
});

/** What `enqueueUpdate` actually writes: the target id lives in the payload. */
const updateRow = (targetId, patch, at) => ({
  id: `${targetId}:update`,
  table: "rescue_requests",
  op: "update",
  payload: { ...patch, id: targetId },
  createdAt: at,
});

const insertRow = (id, payload, at) => ({
  id,
  table: "rescue_requests",
  op: "insert",
  payload,
  createdAt: at,
});

console.log("\nRescue queue merge — SalbaBayan\n");

console.log("A cancelled SOS does not come back:");
{
  const server = [{ id: REQ, status: "pending", ts: TAP }];
  const rows = [updateRow(REQ, { status: "cancelled" }, Date.now())];

  const merged = mergeRequests(
    server,
    queuedInserts(rows, build),
    queuedPatches(rows),
  );

  check("the queued cancel does not become its own request", merged.length === 1, `got ${merged.length}`);
  check(
    "no request carries the synthetic :update key",
    merged.every((r) => !r.id.endsWith(":update")),
    JSON.stringify(merged.map((r) => r.id)),
  );
  check(
    "the queued cancel wins over the server's stale pending",
    merged[0].status === "cancelled",
    `got ${merged[0].status}`,
  );
  check(
    "the original tap time is preserved, not reset to now",
    merged[0].ts === TAP,
    `got ${merged[0].ts}`,
  );
}

console.log("\nAn offline request is still visible and correctly timed:");
{
  const rows = [insertRow(REQ, { ts: TAP, purok_id: "p3" }, Date.now())];
  const merged = mergeRequests([], queuedInserts(rows, build), queuedPatches(rows));

  check("a queued insert shows as a request", merged.length === 1);
  check("it is pending", merged[0].status === "pending");
  check(
    "its timer runs from the tap, not from the queue write",
    merged[0].ts === TAP,
    `got ${merged[0].ts}`,
  );
}

console.log("\nCancelling an SOS that never reached the server:");
{
  // Both the insert and the cancel are queued — the offline case end to end.
  const rows = [
    insertRow(REQ, { ts: TAP }, 1),
    updateRow(REQ, { status: "cancelled" }, 2),
  ];
  const merged = mergeRequests([], queuedInserts(rows, build), queuedPatches(rows));

  check("still exactly one request", merged.length === 1, `got ${merged.length}`);
  check("and it reads as cancelled", merged[0].status === "cancelled", `got ${merged[0].status}`);
}

console.log("\nServer authority is preserved where it belongs:");
{
  const server = [
    { id: REQ, status: "acknowledged", ts: TAP, acknowledged_by: "vol-1" },
  ];
  const rows = [insertRow(REQ, { ts: TAP }, 1)];
  const merged = mergeRequests(server, queuedInserts(rows, build), queuedPatches(rows));

  check(
    "a landed row beats the local copy, which cannot know the responder",
    merged[0].status === "acknowledged" && merged[0].acknowledged_by === "vol-1",
  );
}

console.log("\nOrdering and edge cases:");
{
  const rows = [
    updateRow(REQ, { status: "acknowledged" }, 1),
    updateRow(REQ, { status: "cancelled" }, 2),
  ];
  const merged = mergeRequests(
    [{ id: REQ, status: "pending", ts: TAP }],
    [],
    queuedPatches(rows),
  );
  check(
    "the later queued patch wins",
    merged[0].status === "cancelled",
    `got ${merged[0].status}`,
  );

  const orphan = queuedPatches([updateRow("gone", { status: "cancelled" }, 1)]);
  const dropped = mergeRequests([], [], orphan);
  check(
    "a patch for an unknown request is dropped, never materialised",
    dropped.length === 0,
    `got ${dropped.length}`,
  );

  const blocked = [
    { ...insertRow(REQ, { ts: TAP }, 1), blocked: true },
  ];
  check(
    "a blocked row is not shown as an active request",
    queuedInserts(blocked, build).length === 0,
  );

  const otherTable = [
    { id: "x", table: "water_reports", op: "insert", payload: {}, createdAt: 1 },
  ];
  check(
    "another table's queued write is ignored",
    queuedInserts(otherTable, build).length === 0,
  );

  const legacy = [
    { id: REQ, table: "rescue_requests", payload: { ts: TAP }, createdAt: 1 },
  ];
  check(
    "a row queued before `op` existed is treated as an insert",
    queuedInserts(legacy, build).length === 1,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
