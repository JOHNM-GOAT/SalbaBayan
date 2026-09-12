/**
 * The evacuation routes must agree with the map they are drawn on.
 *
 * Three separate files have to describe the same barangay, and nothing in the
 * type system connects them: the routes live in a migration, the offline base
 * map lives in `public/geo/streets.json`, and the hazards that demonstrate the
 * blocked-path warning live in a third set of rows. They are all generated
 * together by `scripts/generate-geo.mjs`, so they agree today. They will stop
 * agreeing the first time someone regenerates one and not the others, and the
 * failure is invisible: the map still draws a confident orange line, it just
 * runs through buildings, and the distance beside it is not a distance anyone
 * could walk.
 *
 * That is the failure this file exists to make loud. It is the same argument as
 * `check-translations.mjs`: "remember to also regenerate the other one" is a
 * convention that holds until the day someone is in a hurry.
 *
 * Run:  node scripts/check-routes.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCKED_RADIUS_M, metresBetween, metresToLine } from "../src/lib/geo.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MIGRATION = join(ROOT, "supabase/migrations/0014_real_routes.sql");

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
 * generator writes it. The guard against that becoming untrue is below: an
 * empty parse is a FAILURE, not a silent pass. A guard that quietly finds
 * nothing to check is worse than no guard, because it reports success.
 * ------------------------------------------------------------------------ */

const routes = new Map();
for (const m of sql.matchAll(
  /route_geojson = '(\{[^']*?\})'::jsonb, route = '([^']*(?:''[^']*)*)'.*?name = '(Purok \d)'/g,
)) {
  routes.set(m[3], { line: JSON.parse(m[1]).coordinates, label: m[2] });
}

const centres = new Map();
for (const m of sql.matchAll(
  /evac_centers set lat = ([-\d.]+), lng = ([-\d.]+) where name = '([^']+)'/g,
)) {
  centres.set(m[3], [Number(m[2]), Number(m[1])]);
}

const hazards = new Map();
for (const m of sql.matchAll(
  /hazard_reports set lat = ([-\d.]+), lng = ([-\d.]+)\s*\n?\s*where description = '([^']*(?:''[^']*)*)'/g,
)) {
  hazards.set(m[3].replace(/''/g, "'"), [Number(m[2]), Number(m[1])]);
}

check("the migration parses into routes", routes.size === 8, `${routes.size} of 8`);
check("the migration parses into centres", centres.size === 3, `${centres.size} of 3`);
check("the migration parses into hazards", hazards.size === 2, `${hazards.size} of 2`);
check("the offline base map has roads", roads.length > 50, `${roads.length}`);

if (routes.size === 0 || roads.length === 0) {
  console.log("\n  Nothing to check. Refusing to report success.\n");
  process.exitCode = 1;
} else {
  /* -------------------------------------------------------------------------
   * Every route runs along a road that is actually on the map
   * ---------------------------------------------------------------------- */

  console.log("\nRoutes lie on the offline base map:");

  /* One metre. These are the same surveyed coordinates on both sides, so the
     true answer is zero; the tolerance only absorbs the 6-decimal rounding the
     generator writes, which is about 11 cm at this latitude. */
  const ON_ROAD_M = 1;

  let worst = 0;
  let worstPurok = null;
  let checked = 0;

  for (const [name, { line }] of routes) {
    for (const point of line) {
      let nearest = Infinity;
      for (const road of roads) nearest = Math.min(nearest, metresToLine(point, road));
      checked += 1;
      if (nearest > worst) {
        worst = nearest;
        worstPurok = name;
      }
    }
  }

  check(
    `all ${checked} route vertices sit on a mapped road`,
    worst <= ON_ROAD_M,
    `worst ${worst.toFixed(1)}m, on ${worstPurok}`,
  );

  /* -------------------------------------------------------------------------
   * Every route actually arrives
   * ---------------------------------------------------------------------- */

  console.log("\nRoutes arrive where the protocol says they do:");

  for (const [name, { line, label }] of routes) {
    const destination = label.split("→")[1]?.split("·")[0]?.trim();
    const centre = centres.get(destination);
    const end = line[line.length - 1];

    check(
      `${name} ends at ${destination}`,
      Boolean(centre) && metresBetween(end, centre) < 1,
      centre ? `${metresBetween(end, centre).toFixed(0)}m short` : "unknown centre",
    );
  }

  /* -------------------------------------------------------------------------
   * The blocked-path demonstration still demonstrates something
   *
   * 0008 placed one hazard ON a route on purpose, because a feature that can
   * only be shown by hand-editing the database is a feature nobody checks. When
   * the routes moved onto real streets that hazard was left behind, and FR-2.8
   * would have stopped firing anywhere in the app with nothing to show for it.
   * ---------------------------------------------------------------------- */

  console.log("\nThe blocked-path warning has something to detect (FR-2.8):");

  const blocking = hazards.get("Baha sa Mabini St. — hanggang tuhod");
  const clear = hazards.get("Nabuwal na puno sa Luna St.");

  const nearestRoute = (point) => {
    let best = Infinity;
    let where = null;
    for (const [name, { line }] of routes) {
      const d = metresToLine(point, line);
      if (d < best) {
        best = d;
        where = name;
      }
    }
    return { best, where };
  };

  const onRoute = blocking ? nearestRoute(blocking) : null;
  check(
    "the flooding hazard blocks at least one route",
    Boolean(onRoute) && onRoute.best <= BLOCKED_RADIUS_M,
    onRoute ? `${onRoute.best.toFixed(0)}m from the nearest route` : "hazard not found",
  );

  const offRoute = clear ? nearestRoute(clear) : null;
  check(
    "the fallen-tree hazard blocks none of them",
    Boolean(offRoute) && offRoute.best > BLOCKED_RADIUS_M,
    offRoute ? `${offRoute.best.toFixed(0)}m from ${offRoute.where}` : "hazard not found",
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
// Set the code and let Node exit on its own; calling process.exit() here races
// the native TypeScript-stripping loader and trips a libuv assertion on Windows.
process.exitCode = fail === 0 ? 0 : 1;
