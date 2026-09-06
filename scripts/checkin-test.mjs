/**
 * Check-in token handling (PRD §7.9 AC).
 *
 * "With the camera unavailable, a manual token-entry fallback produces the
 * same check-in result."
 *
 * The architecture makes that true rather than the test doing so: the scanner
 * emits a raw string and the text box emits a raw string, and both go through
 * `normaliseToken` into one lookup. What is worth testing is the normalisation
 * itself, because that is the only place the two inputs can differ — a camera
 * reads exactly what is printed, a person types what they can see at 2am in a
 * hall, and those must land on the same record.
 *
 * Equally important is what must NOT be normalised away. Forgiving too much
 * turns a typo into somebody else's check-in, and on this screen that means
 * the wrong person is recorded as safe.
 *
 * Run:  node scripts/checkin-test.mjs
 */

import { normaliseToken, isPriority, TAG_ORDER, STATUSES } from "../src/lib/token.ts";

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

console.log("\nCheck-in tokens — SalbaBayan\n");

/* What a camera would emit for the seeded card. */
const SCANNED = "SB-0142";

console.log("Manual entry must resolve to the scanned token:");
for (const typed of [
  "SB-0142",
  "sb-0142",
  "  SB-0142  ",
  "sb 0142",
  "sb0142",
  "SB_0142",
  "SB-0142\n",
]) {
  check(
    `typed ${JSON.stringify(typed)} matches the scan`,
    normaliseToken(typed) === normaliseToken(SCANNED),
    `${JSON.stringify(normaliseToken(typed))} vs ${JSON.stringify(normaliseToken(SCANNED))}`,
  );
}

console.log("\nBut a genuinely different token must NOT be coerced:");
/*
 * These are the dangerous cases. Each is one keystroke from a real card in the
 * fixture set, and normalising any of them into a match would file a check-in
 * against the wrong resident — recording someone as safe who has not arrived.
 */
for (const wrong of ["SB-0143", "SB-014", "SB-01422", "SB0142X"]) {
  check(
    `${wrong} stays distinct from ${SCANNED}`,
    normaliseToken(wrong) !== normaliseToken(SCANNED),
  );
}

check(
  "an empty entry does not match a real token",
  normaliseToken("") !== normaliseToken(SCANNED),
);

console.log("\nPriority flagging:");
check(
  "any vulnerability tag means priority",
  isPriority({ vulnerability_tags: ["elderly"] }),
);
check(
  "multiple tags still means priority, not double",
  isPriority({ vulnerability_tags: ["elderly", "medical"] }),
);
check(
  "no tags means no priority",
  !isPriority({ vulnerability_tags: [] }),
);
/*
 * A resident row whose tags are missing entirely must not throw on a screen a
 * volunteer is using to triage arrivals.
 */
check(
  "a missing tags array is handled, not crashed on",
  isPriority({}) === false,
);

console.log("\nContract:");
check(
  "the three loggable statuses match the schema constraint",
  STATUSES.join(",") === "checked_in,evacuated,needs_help",
  STATUSES.join(","),
);
check(
  "tags are ordered most urgent first",
  TAG_ORDER.join(",") === "medical,elderly,infant",
  TAG_ORDER.join(","),
);

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code rather than calling process.exit(), which races the native
// TypeScript-stripping loader on Windows and trips a libuv assertion.
process.exitCode = fail === 0 ? 0 : 1;
