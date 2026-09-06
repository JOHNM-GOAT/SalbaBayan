/**
 * Actor navigation (PRD §4).
 *
 * The failure this guards against is a dead tab: a nav entry pointing at a
 * route that does not exist, or at one the Service Worker never precached. A
 * volunteer taps SCAN during a storm, with no signal, and gets the browser's
 * error page instead of the scanner. Nothing in the type system catches that
 * — the href is just a string — so it is checked against the filesystem and
 * against the precache list here.
 *
 * Run:  node scripts/actors-test.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTORS, activeHref, actorById } from "../src/lib/actors.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

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

/** The routes the Service Worker precaches, read from the source of truth. */
const swSource = readFileSync(join(ROOT, "src/app/sw.ts"), "utf8");
const shellRoutes = new Set(
  (swSource.match(/const SHELL_ROUTES = \[([^\]]*)\]/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean),
);

console.log("\nActor navigation — SalbaBayan\n");

console.log("Every tab goes somewhere real:");
for (const actor of ACTORS) {
  for (const item of actor.nav) {
    const dir =
      item.href === "/"
        ? join(ROOT, "src/app/page.tsx")
        : join(ROOT, "src/app", item.href, "page.tsx");
    check(
      `${actor.id}: ${item.href} has a page`,
      existsSync(dir),
      `no page.tsx at ${item.href}`,
    );
  }
}

console.log("\nEvery tab survives a lost connection:");
for (const actor of ACTORS) {
  for (const item of actor.nav) {
    check(
      `${actor.id}: ${item.href} is precached`,
      shellRoutes.has(item.href),
      `${item.href} is missing from SHELL_ROUTES in sw.ts`,
    );
  }
}

console.log("\nShape of each tab bar:");
for (const actor of ACTORS) {
  check(`${actor.id}: five tabs`, actor.nav.length === 5, `got ${actor.nav.length}`);

  const raised = actor.nav.filter((i) => i.raised);
  check(`${actor.id}: exactly one raised control`, raised.length === 1, `got ${raised.length}`);

  check(
    `${actor.id}: the raised control is the middle one`,
    actor.nav[2]?.raised === true,
  );

  check(
    `${actor.id}: home tab matches the actor's home route`,
    actor.nav[0].href === actor.home,
    `${actor.nav[0].href} vs ${actor.home}`,
  );

  const hrefs = new Set(actor.nav.map((i) => i.href));
  check(`${actor.id}: no duplicate destinations`, hrefs.size === actor.nav.length);
}

console.log("\nAlarm red is reserved for raising an actual alarm:");
{
  const alarmed = ACTORS.flatMap((a) =>
    a.nav.filter((i) => i.alarm).map((i) => `${a.id}:${i.href}`),
  );
  check(
    "only the resident's SOS is alarm-coloured",
    alarmed.length === 1 && alarmed[0] === "resident:/sos",
    `got ${JSON.stringify(alarmed)}`,
  );
}

console.log("\nActive tab resolution:");
{
  const resident = actorById("resident");
  check("home matches exactly", activeHref(resident, "/") === "/");
  check(
    "a non-home route does not fall through to home",
    activeHref(resident, "/map") === "/map",
    `got ${activeHref(resident, "/map")}`,
  );
  check(
    "a nested route highlights its parent tab",
    activeHref(resident, "/map/detail") === "/map",
    `got ${activeHref(resident, "/map/detail")}`,
  );
  check(
    "a route not in this tab bar highlights nothing",
    activeHref(resident, "/coverage") === null,
    `got ${activeHref(resident, "/coverage")}`,
  );
  check(
    "a route that merely starts with a tab's name does not match",
    activeHref(resident, "/mapping") === null,
    `got ${activeHref(resident, "/mapping")}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
