/**
 * When the rescue alarm sounds (src/lib/rescueArrivals.ts).
 *
 * The two ways this fails are both silent in review: an alarm on every read,
 * which teaches a volunteer to ignore it, and no alarm at all, which is the
 * feature not existing. So the cases below walk one device through a shift.
 *
 * Run:  node scripts/rescue-arrivals-test.mjs
 */

import { freshArrivals, newArrivalState } from "../src/lib/rescueArrivals.ts";

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

const call = (id, by = "someone") => ({ id, requested_by: by });

console.log("\nThe rescue alarm — SalbaBayan\n");

console.log("Opening the app:");
{
  const state = newArrivalState();
  const first = freshArrivals([call("a"), call("b"), call("c")], state, "me");
  check("a queue that was already waiting does not sound", first.length === 0, `got ${first.length}`);
  check("but it is remembered", state.known.size === 3);

  const again = freshArrivals([call("a"), call("b"), call("c")], state, "me");
  check("re-reading the same queue does not sound", again.length === 0, `got ${again.length}`);
}

console.log("\nA call arrives:");
{
  const state = newArrivalState();
  freshArrivals([call("a")], state, "me");

  const arrived = freshArrivals([call("a"), call("b")], state, "me");
  check("the new one sounds", arrived.length === 1 && arrived[0].id === "b", JSON.stringify(arrived));

  const settled = freshArrivals([call("a"), call("b")], state, "me");
  check("and does not sound a second time", settled.length === 0, `got ${settled.length}`);

  /* An acknowledgement removes nothing and adds nothing; the queue is re-read
     on every realtime event, and most of them are not arrivals. */
  const acked = freshArrivals([call("b")], state, "me");
  check("a request leaving the queue does not sound", acked.length === 0, `got ${acked.length}`);
}

console.log("\nWhose call it is:");
{
  const state = newArrivalState();
  freshArrivals([], state, "me");

  const own = freshArrivals([call("x", "me")], state, "me");
  check("this device's own SOS does not sound the hall's alarm", own.length === 0, JSON.stringify(own));

  const other = freshArrivals([call("x", "me"), call("y", "them")], state, "me");
  check("somebody else's does", other.length === 1 && other[0].id === "y", JSON.stringify(other));

  /* Before the session is known, `mine` is null. Nothing legitimately has a
     null requester — the insert policy refuses it — so nothing is suppressed. */
  const unknownSelf = newArrivalState();
  freshArrivals([], unknownSelf, null);
  const anyone = freshArrivals([call("z", "them")], unknownSelf, null);
  check("an unknown session still hears the alarm", anyone.length === 1, JSON.stringify(anyone));
}

console.log("\nSeveral at once:");
{
  const state = newArrivalState();
  freshArrivals([], state, "me");
  const storm = freshArrivals([call("p"), call("q"), call("r")], state, "me");
  /* The caller plays ONE alarm however many came back — three calls in the same
     second is a worse emergency, not three alarms over each other. */
  check("all three are reported together", storm.length === 3, `got ${storm.length}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
