/**
 * When the write queue is allowed to give up on a row (PRD §7.3, FR-3.2).
 *
 * This is the branch with the worst downside in the application. A `blocked`
 * row is stepped over and never retried automatically again, and on a
 * resident's phone the row at the head of the queue is usually their SOS. So
 * these cases are written from the failure they exist to prevent rather than
 * from the code: the queue must give up on a row Postgres keeps refusing, and
 * must NOT give up on one it has simply been unable to reach.
 *
 * That second half is the regression this file locks down. Transport failures
 * used to count against the ceiling, and a flush only runs when
 * `navigator.onLine` is true — which the browser reports for a captive portal
 * and for a saturated tower, both named in offlineQueue.ts as the expected
 * mid-storm condition. Twenty polls at 30 seconds is ten minutes, after which a
 * distress call was silently set aside.
 *
 * Run:  node scripts/queue-policy-test.mjs
 */

import {
  failureVerdict,
  isPermanent,
  mergeUpdatePayload,
  isTransportFailure,
  MAX_ATTEMPTS,
} from "../src/lib/queuePolicy.ts";

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

console.log("\nWrite-queue give-up rule — SalbaBayan\n");

/* -- A dead connection is not the row's fault -------------------------------
 *
 * supabase-js reports a failed fetch as an error object with no SQLSTATE,
 * because no statement ever ran.
 */
console.log("A failure that never reached Postgres:");

for (const code of [undefined, ""]) {
  const label = code === undefined ? "no code" : "an empty code";
  check(
    `${label} is recognised as a transport failure`,
    isTransportFailure(code),
  );

  const verdict = failureVerdict(code, 0);
  check(
    `${label} does not block the row`,
    verdict.blocked === false,
    "a distress call was set aside because the tower was busy",
  );
  check(
    `${label} does not count against the ceiling`,
    verdict.attempts === 0,
    `attempts became ${verdict.attempts}`,
  );
}

// The case that actually happened: an "online" device that can reach nothing,
// polling every 30s for hours. Every one of those is a transport failure.
let attempts = 0;
for (let i = 0; i < MAX_ATTEMPTS * 5; i += 1) {
  const verdict = failureVerdict(undefined, attempts);
  attempts = verdict.attempts;
  if (verdict.blocked) break;
}
check(
  `an SOS survives ${MAX_ATTEMPTS * 5} failed flushes behind a dead connection`,
  attempts === 0,
  `attempts reached ${attempts} — the row would be blocked and never retried`,
);

/* -- A row Postgres will never accept --------------------------------------- */
console.log("\nA row the server refuses on its own terms:");

for (const code of ["23502", "23503", "23514", "22P02", "PGRST204"]) {
  check(`${code} is permanent`, isPermanent(code));
  check(
    `${code} blocks the row on the first refusal`,
    failureVerdict(code, 0).blocked,
    "a poison row would hold up every write behind it",
  );
}

/* -- Refusals that are NOT permanent ---------------------------------------- */
console.log("\nA refusal that may stop being one:");

// 42501 is RLS. It looks permanent and is not: a row queued before the
// anonymous session existed carries no owner, and succeeds once it has one.
check("42501 (RLS) is not permanent", !isPermanent("42501"));
check("42501 does not block on the first refusal", !failureVerdict("42501", 0).blocked);

// PGRST301 is an expired JWT. A refresh fixes it.
check("PGRST301 (expired JWT) is not permanent", !isPermanent("PGRST301"));

/* -- The ceiling still exists ----------------------------------------------- */
console.log("\nThe ceiling, for refusals that keep coming:");

check(
  "a server refusal increments the count",
  failureVerdict("42501", 3).attempts === 4,
);
check(
  `the row is not blocked at ${MAX_ATTEMPTS - 2} refusals`,
  !failureVerdict("42501", MAX_ATTEMPTS - 2).blocked,
);
check(
  `the row IS blocked on the ${MAX_ATTEMPTS}th refusal`,
  failureVerdict("42501", MAX_ATTEMPTS - 1).blocked,
  "an unforeseen poison row could hold up the queue forever",
);

// And the ceiling counts refusals only, so a row that spent two days behind a
// dead connection and is then refused once starts from one, not from hundreds.
let mixed = 0;
for (let i = 0; i < 500; i += 1) mixed = failureVerdict(undefined, mixed).attempts;
const afterOutage = failureVerdict("42501", mixed);
check(
  "a row refused once after a long outage is at attempt 1, not blocked",
  afterOutage.attempts === 1 && !afterOutage.blocked,
  `attempts ${afterOutage.attempts}, blocked ${afterOutage.blocked}`,
);

/* -- Two updates to one row --------------------------------------------------
 *
 * The barangay row takes two kinds of update — the advisory, and the household
 * count — and both share the row's single queue slot. Replacing the waiting
 * update meant an official who issued Signal 4 offline and then entered the
 * household count lost the signal change without a trace.
 */
console.log("\nA second update to the same row:");
{
  const ID = "0561cfa1";
  const waitingAdvisory = {
    payload: { id: ID, current_signal_level: 4, signal_set_at: "2026-09-19T06:00:00Z" },
  };

  const merged = mergeUpdatePayload(waitingAdvisory, { expected_households: 210 }, ID);
  check(
    "keeps the signal change already waiting",
    merged.current_signal_level === 4 && merged.signal_set_at === "2026-09-19T06:00:00Z",
    JSON.stringify(merged),
  );
  check("and adds the household count", merged.expected_households === 210);
  check("the row id stays the target", merged.id === ID);

  const later = mergeUpdatePayload(waitingAdvisory, { current_signal_level: 5 }, ID);
  check(
    "a newer value for the same field wins",
    later.current_signal_level === 5,
    JSON.stringify(later),
  );

  const fresh = mergeUpdatePayload(undefined, { expected_households: 210 }, ID);
  check(
    "with nothing waiting, it is just the new change",
    JSON.stringify(fresh) === JSON.stringify({ expected_households: 210, id: ID }),
    JSON.stringify(fresh),
  );

  const refused = mergeUpdatePayload(
    { ...waitingAdvisory, blocked: true },
    { expected_households: 210 },
    ID,
  );
  check(
    "a refused change is not folded into a new attempt",
    !("current_signal_level" in refused) && refused.expected_households === 210,
    JSON.stringify(refused),
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
