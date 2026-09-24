/**
 * Reading PAGASA's bulletin, checked against fixtures.
 *
 * This guards the part that can be guarded: given a page, does the parser pull
 * the right numbers out of it, and does an ambiguous area list stop the signal
 * from being filled in. It cannot guard the part that actually breaks — PAGASA
 * changing their page — so the parser is built to return nulls rather than
 * guesses, and these checks pin that behaviour down too.
 *
 * One fixture is real (the no-cyclone page, saved 24 September 2026). The
 * active one is synthetic and says so at the top of the file; there was no
 * storm in the area of responsibility to save.
 *
 * Run:  node scripts/pagasa-test.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchArea, parseBulletin, signalHere } from "../src/lib/pagasa.ts";
import { bulletinToAdvisory, differsFromAdvisory } from "../src/lib/advisoryForm.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const fixture = (name) => readFileSync(join(ROOT, "scripts/fixtures", name), "utf8");

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

const is = (name, actual, expected) =>
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

console.log("\nPAGASA bulletin — SalbaBayan\n");

/* ---------------------------------------------------------------------------
 * No cyclone — the real page
 * ------------------------------------------------------------------------ */

console.log("The real page, with no cyclone in the area of responsibility:");
const quiet = parseBulletin(fixture("pagasa-none.html"));
is("read as 'none', not as a storm and not as a failure", quiet.state, "none");

/* ---------------------------------------------------------------------------
 * A bulletin
 * ------------------------------------------------------------------------ */

console.log("\nA bulletin (synthetic fixture):");
const reading = parseBulletin(fixture("pagasa-active.html"));
is("read as active", reading.state, "active");

const bulletin = reading.state === "active" ? reading.bulletin : null;
is("the local name", bulletin?.stormName, "AGHON");
is("the international name", bulletin?.internationalName, "MAN-YI");
is("the category, not the shorter one inside it", bulletin?.category, "Typhoon");
is("the bulletin number", bulletin?.bulletinNo, 12);
is("maximum sustained winds", bulletin?.windKph, 150);
is("gusts", bulletin?.gustKph, 185);
check(
  "the issue time, as printed",
  bulletin?.issuedAt?.startsWith("5:00 PM, 25 September 2026"),
  bulletin?.issuedAt,
);
is("all three wind signals", bulletin?.signals.length, 3);
is("highest signal first", bulletin?.signals[0].level, 3);

/* ---------------------------------------------------------------------------
 * Which signal covers this barangay
 * ------------------------------------------------------------------------ */

console.log("\n#5 Callaguip, Batac City, Ilocos Norte:");
const here = signalHere(bulletin, { province: "Ilocos Norte", municipality: "Batac City" });

/*
 * Signal 3 names "the northern portion of Ilocos Norte" — the province, but not
 * this end of it. Signal 2 names "the rest of Ilocos Norte", which is where
 * Batac is. Taking the highest number containing the words "Ilocos Norte" would
 * put this barangay one signal too high for a storm hitting Pagudpud.
 */
is("the signal is 2, not the 3 listed for the north", here?.level, 2);
is("and it is a certain match", here?.match, "province");

is(
  "a partial area is recognised as partial",
  matchArea(
    "Luzon: the northern portion of Ilocos Norte (Pagudpud, Burgos, Bangui)",
    { province: "Ilocos Norte", municipality: "Batac City" },
  ),
  "partial",
);

is(
  "a partial area that names the municipality is a match",
  matchArea(
    "Luzon: the western portion of Ilocos Norte (Batac City, Paoay, Currimao)",
    { province: "Ilocos Norte", municipality: "Batac City" },
  ),
  "municipality",
);

is(
  "another province is not this one",
  matchArea("Luzon: Ilocos Sur, La Union, Pangasinan", {
    province: "Ilocos Norte",
    municipality: "Batac City",
  }),
  "no",
);

/* A bulletin that lists only the far end of the province: nothing certain. */
const northOnly = parseBulletin(
  fixture("pagasa-active.html").replace(
    "Luzon: the rest of Ilocos Norte, Ilocos Sur, Abra, Apayao, and the",
    "Luzon: Ilocos Sur, Abra, Apayao, and the",
  ),
);
const doubtful = signalHere(
  northOnly.state === "active" ? northOnly.bulletin : null,
  { province: "Ilocos Norte", municipality: "Batac City" },
);
is("a doubtful match is reported as partial", doubtful?.match, "partial");

/* ---------------------------------------------------------------------------
 * Filling in the advisory form
 * ------------------------------------------------------------------------ */

console.log("\nFilling in the advisory form:");
const CURRENT = { level: 0, stormName: "", bulletinNo: "", windKph: "", evacuateBy: null };
const NOW = Date.UTC(2026, 8, 25, 9, 0, 0);

/* What the card hands the form: the level, and whether the bulletin plainly
   says it applies here. */
const asSignal = (found) =>
  found ? { level: found.level, certain: found.match === "province" || found.match === "municipality" } : null;

const filled = bulletinToAdvisory(bulletin, asSignal(here), CURRENT, NOW);
is("the level comes from the certain match", filled.level, 2);
is("the storm name", filled.stormName, "AGHON");
is("the bulletin number, as text for the form", filled.bulletinNo, "12");
is("the wind speed", filled.windKph, "150");
is("no evacuation deadline below level 3", filled.evacuateBy, null);

const doubtfulFill = bulletinToAdvisory(bulletin, asSignal(doubtful), CURRENT, NOW);
is(
  "a partial match leaves the level alone — an official decides that",
  doubtfulFill.level,
  CURRENT.level,
);
is("but the storm name is still filled in", doubtfulFill.stormName, "AGHON");

const highFill = bulletinToAdvisory(
  bulletin,
  { level: 4, certain: true },
  CURRENT,
  NOW,
);
check(
  "crossing into evacuation sets a deadline the form will demand",
  highFill.level === 4 && highFill.evacuateBy instanceof Date,
  JSON.stringify(highFill.evacuateBy),
);

const applied = { level: 2, stormName: "AGHON", bulletinNo: "12", windKph: "150", evacuateBy: null };
is(
  "an applied bulletin offers nothing more to apply",
  differsFromAdvisory(bulletin, asSignal(here), applied),
  false,
);
is(
  "a new bulletin number does",
  differsFromAdvisory(bulletin, asSignal(here), { ...applied, bulletinNo: "11" }),
  true,
);

/* ---------------------------------------------------------------------------
 * Pages that are not bulletins
 * ------------------------------------------------------------------------ */

console.log("\nPages this parser must refuse to read as a storm:");
is(
  "an error page is unreadable, not a cyclone",
  parseBulletin("<html><body><h1>503 Service Unavailable</h1></body></html>").state,
  "unreadable",
);
is(
  "an empty page too",
  parseBulletin("").state,
  "unreadable",
);

/* A bulletin whose intensity paragraph has been reworded: the fields that can
   still be read are read, and the rest are null rather than zero. */
const reworded = parseBulletin(
  fixture("pagasa-active.html").replace(/Maximum sustained winds of 150 km\/h/, "Winds of 150 kph"),
);
is(
  "an unreadable wind speed is null, never 0",
  reworded.state === "active" ? reworded.bulletin.windKph : "not active",
  null,
);
is(
  "and the rest of the bulletin still reads",
  reworded.state === "active" ? reworded.bulletin.bulletinNo : null,
  12,
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
