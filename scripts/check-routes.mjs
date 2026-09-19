/**
 * The evacuation routes must agree with the map they are drawn on.
 *
 * The routes live in a migration, the offline base map in
 * `public/geo/streets.json`, and nothing in the type system connects them. They
 * are generated together — now by `scripts/generate-callaguip.mjs` — so they
 * agree today. They stop agreeing the first time someone regenerates one and not
 * the other, and the failure is invisible: the map still draws a confident line,
 * it just runs through buildings, and the distance beside it is not a distance
 * anyone could walk. This file makes that loud.
 *
 * It used to check the fictional San Isidro (migration 0014). The app moved to
 * #5 Callaguip, Batac City, in 0027, and this checks what is actually live.
 *
 * Not checked any more: the blocked-path demonstration. San Isidro carried two
 * invented hazards placed to exercise it; clearing the test records removed
 * them, and Callaguip deliberately has no invented hazards. `hazardsOnRoute`
 * itself is covered by scripts/geo-test.mjs.
 *
 * Run:  node scripts/check-routes.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lineLength, metresBetween, metresToLine } from "../src/lib/geo.ts";
import { pointInRing } from "../src/lib/walkRoute.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MIGRATION = join(ROOT, "supabase/migrations/0027_callaguip_geography.sql");

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

console.log("\nRoutes against the map they are drawn on — SalbaBayan\n");

const sql = readFileSync(MIGRATION, "utf8");
const streets = JSON.parse(readFileSync(join(ROOT, "public/geo/streets.json"), "utf8"));
const roads = streets.features.map((f) => f.geometry.coordinates);

/* ---------------------------------------------------------------------------
 * Parse
 *
 * Reading generated SQL with a regular expression is only safe because the
 * generator writes it. An empty parse is a FAILURE, not a silent pass: a guard
 * that quietly finds nothing to check reports success.
 * ------------------------------------------------------------------------ */

const unquote = (s) => s.replace(/''/g, "'");

const routes = new Map();
for (const m of sql.matchAll(
  /select p\.id, s\.level, '((?:[^']|'')*)', '(\{[^']*\})'::jsonb, s\.action_key, c\.id[\s\S]*?where p\.name = '((?:[^']|'')*)' and c\.name = '((?:[^']|'')*)'/g,
)) {
  routes.set(unquote(m[3]), {
    label: unquote(m[1]),
    line: JSON.parse(m[2]).coordinates,
    centre: unquote(m[4]),
  });
}

const centres = new Map();
for (const m of sql.matchAll(
  /select p\.id, '((?:[^']|'')*)', (?:null|\d+), ([-\d.]+), ([-\d.]+)\s*\nfrom public\.puroks p/g,
)) {
  centres.set(unquote(m[1]), [Number(m[3]), Number(m[2])]);
}

const outlineMatch = sql.match(/boundary_geojson = '(\{[^']*\})'::jsonb/);
const ring = outlineMatch ? JSON.parse(outlineMatch[1]).coordinates[0] : null;

check("the migration parses into routes", routes.size === 6, `${routes.size} of 6`);
check("the migration parses into a centre", centres.size === 1, `${centres.size} of 1`);
check("the migration parses into an outline", Array.isArray(ring) && ring.length > 3);
check("the offline base map has roads", roads.length > 50, `${roads.length}`);

if (routes.size === 0 || roads.length === 0 || !ring) {
  console.log("\n  Nothing to check. Refusing to report success.\n");
  process.exitCode = 1;
} else {
  /* -------------------------------------------------------------------------
   * Every route runs along a road that is actually on the map
   * ---------------------------------------------------------------------- */

  console.log("\nRoutes lie on the offline base map:");

  // The same surveyed coordinates on both sides, so the true answer is zero;
  // one metre absorbs rounding.
  const ON_ROAD_M = 1;

  let worst = 0;
  let worstArea = null;
  let checked = 0;
  for (const [name, { line }] of routes) {
    for (const point of line) {
      let nearest = Infinity;
      for (const road of roads) nearest = Math.min(nearest, metresToLine(point, road));
      checked += 1;
      if (nearest > worst) {
        worst = nearest;
        worstArea = name;
      }
    }
  }
  check(
    `all ${checked} route vertices sit on a mapped road`,
    worst <= ON_ROAD_M,
    `worst ${worst.toFixed(1)}m, on ${worstArea}`,
  );

  /* -------------------------------------------------------------------------
   * Every route starts in the barangay and arrives at the centre
   * ---------------------------------------------------------------------- */

  console.log("\nRoutes start in #5 Callaguip and arrive at the centre:");

  const ON_EDGE_M = 3; // a street along the outline is part of the barangay
  // The centre is the building, not a point on the street; the route ends at
  // the street point nearest it.
  const ARRIVAL_M = 30;

  for (const [name, { line, label, centre }] of routes) {
    const start = line[0];
    check(
      `${name} starts inside the barangay`,
      pointInRing(start, ring) || metresToLine(start, ring) <= ON_EDGE_M,
      `${metresToLine(start, ring).toFixed(0)}m outside`,
    );

    const at = centres.get(centre);
    const end = line[line.length - 1];
    check(
      `${name} arrives at ${centre}`,
      Boolean(at) && metresBetween(end, at) <= ARRIVAL_M,
      at ? `ends ${metresBetween(end, at).toFixed(0)}m from it` : "unknown centre",
    );

    const stated = Number(label.match(/· (\d+) m/)?.[1]);
    const actual = lineLength(line);
    check(
      `${name}'s stated distance is its real length`,
      Number.isFinite(stated) && Math.abs(stated - actual) <= 2,
      `says ${stated} m, measures ${actual.toFixed(0)} m`,
    );
  }

  for (const [name, point] of centres) {
    check(`${name} is inside the barangay`, pointInRing(point, ring));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code and let Node exit on its own; calling process.exit() here races
// the native TypeScript-stripping loader and trips a libuv assertion on Windows.
process.exitCode = fail === 0 ? 0 : 1;
