/**
 * #5 Callaguip, Batac City, Ilocos Norte — geography from OpenStreetMap.
 *
 * Replaces the fictional "San Isidro, Sta. Cruz, Laguna" the app was built on
 * (scripts/generate-geo.mjs). What is real here, and where it came from:
 *
 *   - The barangay's point: OSM node 8883724672, "Callaguip", official name
 *     "Barangay 5 Callaguip", PSGC 0102805012.
 *   - Its outline: traced along the real streets that bound it, matching the
 *     outline the barangay sees on Google Maps — Manila North Road on the west,
 *     Washington and Taft Streets on the east, Smith, Oeste and Otis Streets on
 *     the south. Google's own boundary is not copied (its licence does not allow
 *     it); this follows OSM street geometry, so it is an approximation of the
 *     official line, and is labelled as such in the handoff.
 *   - The areas residents choose from: the six streets the barangay named —
 *     Asuncion, Oeste, Otis, Rigonan, Smith and Taft — until it supplies a Purok
 *     list.
 *   - The one evacuation centre: the barangay hall, which OSM maps as
 *     "5 Callaguip Community Center" on Asuncion Street, operated by Barangay 5
 *     Callaguip (way 1189277453). Officials can move it on the map.
 *   - Routes: shortest walking paths along OSM streets, computed by
 *     src/lib/walkRoute.ts — the same code the app uses when a centre is moved.
 *
 * Emits:
 *   public/geo/streets.json                            — offline base map
 *   supabase/migrations/0027_callaguip_geography.sql   — archive, clear, insert
 *
 * Run:  node scripts/generate-callaguip.mjs           (uses the cached extract)
 *       node scripts/generate-callaguip.mjs --fetch   (refresh it from Overpass)
 *
 * Road data (c) OpenStreetMap contributors, ODbL. The app carries the required
 * attribution on both map screens.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWalkGraph, metres, pointInRing, walkRoute } from "../src/lib/walkRoute.ts";
import { metresToLine } from "../src/lib/geo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTRACT = join(ROOT, "scripts", "osm", "batac-callaguip-roads.json");

/* Callaguip and a margin, so routes near the edge are not cut into dead ends. */
const BBOX = [18.05, 120.55, 18.072, 120.572];
const OVERPASS = "https://overpass-api.de/api/interpreter";

const BARANGAY = {
  name: "#5 Callaguip",
  municipality: "Batac City",
  province: "Ilocos Norte",
  point: [120.5615882, 18.0634855], // OSM node 8883724672
  population: 832,
  populationSource: "PhilAtlas",
};

const HALL = {
  name: "#5 Callaguip Barangay Hall",
  point: [120.5617101, 18.0634659], // OSM way 1189277453, its centre
  area: "Asuncion Street", // its address in OSM
};

/* Known points used to check the outline is in the right place. */
const NALUPTA_HALL = [120.5636312, 18.0627136]; // the neighbouring barangay's hall

const AREAS = [
  "Asuncion Street",
  "Oeste Street",
  "Otis Street",
  "Rigonan Street",
  "Smith Street",
  "Taft Street",
];

/* The instruction each signal level gives — the same keys the app has always
   used, so no new wording is needed. */
const ACTION_BY_SIGNAL = {
  1: "action.stay_alert",
  2: "action.prepare",
  3: "action.evacuate_now",
  4: "action.evacuate_immediately",
  5: "action.stay_inside",
};

/* ---------------------------------------------------------------------------
 * The OSM extract — cached in the repo, so a build never needs the network
 * ------------------------------------------------------------------------ */

async function fetchExtract() {
  const query = `[out:json][timeout:90];
(way["highway"](${BBOX.join(",")}););
out body geom;`;

  const response = await fetch(OVERPASS, {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass answers 406 without one.
      "User-Agent": "SalbaBayan/0.1 (barangay evacuation PWA)",
    },
  });
  if (!response.ok) throw new Error(`Overpass ${response.status}`);

  const body = await response.json();
  const ways = body.elements
    .filter((way) => way.geometry && way.nodes)
    .map((way) => ({
      i: way.id,
      h: way.tags.highway,
      n: way.tags.name ?? undefined,
      d: way.nodes,
      g: way.geometry.map((p) => [+p.lon.toFixed(7), +p.lat.toFixed(7)]),
    }));

  writeFileSync(
    EXTRACT,
    JSON.stringify({
      note: "OpenStreetMap extract, ODbL. Refresh with: node scripts/generate-callaguip.mjs --fetch",
      bbox: BBOX,
      fetched: new Date().toISOString().slice(0, 10),
      ways,
    }),
  );
  console.log(`fetched ${ways.length} ways -> ./scripts/osm/batac-callaguip-roads.json`);
}

if (process.argv.includes("--fetch") || !existsSync(EXTRACT)) await fetchExtract();

const extract = JSON.parse(readFileSync(EXTRACT, "utf8"));

function must(ok, message) {
  if (!ok) throw new Error(message);
}

/* ---------------------------------------------------------------------------
 * public/geo/streets.json — the offline base map, and the routing network
 * ------------------------------------------------------------------------ */

// Manila North Road is a trunk road; it is the main road here, not a minor one.
const MAIN = new Set(["trunk", "primary", "secondary", "tertiary"]);
const PATH = new Set(["service", "footway", "path", "pedestrian", "track"]);

const streets = {
  type: "FeatureCollection",
  features: extract.ways.map((way) => ({
    type: "Feature",
    properties: {
      kind: MAIN.has(way.h) ? "main" : PATH.has(way.h) ? "path" : "minor",
      name: way.n,
    },
    geometry: { type: "LineString", coordinates: way.g },
  })),
};

writeFileSync(join(ROOT, "public", "geo", "streets.json"), JSON.stringify(streets));

/* ---------------------------------------------------------------------------
 * The outline — traced along the streets that bound Callaguip
 * ------------------------------------------------------------------------ */

const coord = new Map(); // node id -> [lng, lat]
for (const way of extract.ways) way.d.forEach((id, i) => coord.set(id, way.g[i]));

const waysNamed = (name) => extract.ways.filter((way) => way.n === name);
const nodesOf = (name) => new Set(waysNamed(name).flatMap((way) => way.d));

/** The one node two streets share. Anything else means the map has changed. */
function junction(a, b) {
  const other = nodesOf(b);
  const shared = [...nodesOf(a)].filter((id) => other.has(id));
  must(shared.length === 1, `${a} x ${b}: expected one junction, found ${shared.length}`);
  return shared[0];
}

/** Node ids along one named street, from one of its nodes to another. */
function along(name, from, to) {
  const adj = new Map();
  for (const way of waysNamed(name)) {
    for (let i = 1; i < way.d.length; i++) {
      const [a, b] = [way.d[i - 1], way.d[i]];
      (adj.get(a) ?? adj.set(a, []).get(a)).push(b);
      (adj.get(b) ?? adj.set(b, []).get(b)).push(a);
    }
  }
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    if (node === to) break;
    for (const next of adj.get(node) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, node);
      queue.push(next);
    }
  }
  must(prev.has(to), `no path along ${name} between ${from} and ${to}`);
  const path = [];
  for (let at = to; at !== null; at = prev.get(at)) path.unshift(at);
  return path;
}

const J = {
  highwaySmith: junction("Manila North Road", "Smith Street"),
  highwayWashington: junction("Manila North Road", "Washington Street"),
  washingtonTaft: junction("Washington Street", "Taft Street"),
  taftOtis: junction("Taft Street", "Otis Street"),
  otisOeste: junction("Otis Street", "Oeste Street"),
  oesteSmith: junction("Oeste Street", "Smith Street"),
};

const legs = [
  along("Manila North Road", J.highwaySmith, J.highwayWashington),
  along("Washington Street", J.highwayWashington, J.washingtonTaft),
  along("Taft Street", J.washingtonTaft, J.taftOtis),
  along("Otis Street", J.taftOtis, J.otisOeste),
  along("Oeste Street", J.otisOeste, J.oesteSmith),
  along("Smith Street", J.oesteSmith, J.highwaySmith),
];

// Each leg starts where the last ended; drop the repeated joint.
const ringIds = legs.flatMap((leg, i) => (i === 0 ? leg : leg.slice(1)));
must(ringIds[0] === ringIds[ringIds.length - 1], "the outline does not close");
const ring = ringIds.map((id) => coord.get(id));

const outline = { type: "Polygon", coordinates: [ring] };

must(pointInRing(BARANGAY.point, ring), "the Callaguip marker is outside the outline");
must(pointInRing(HALL.point, ring), "the barangay hall is outside the outline");
must(!pointInRing(NALUPTA_HALL, ring), "Nalupta's barangay hall is inside the outline");

/** Shoelace area, for the report. */
const areaM2 = (() => {
  const latRad = (BARANGAY.point[1] * Math.PI) / 180;
  const kx = 111_320 * Math.cos(latRad);
  const ky = 110_574;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky);
  }
  return Math.abs(sum / 2);
})();

/* ---------------------------------------------------------------------------
 * The areas — one per named street, starting on that street inside Callaguip
 * ------------------------------------------------------------------------ */

const ON_EDGE_M = 3; // a street along the outline is part of the barangay

const areas = AREAS.map((name) => {
  const candidates = [...nodesOf(name)]
    .map((id) => coord.get(id))
    .filter((p) => pointInRing(p, ring) || metresToLine(p, ring) <= ON_EDGE_M);
  must(candidates.length > 0, `${name} has no point inside Callaguip`);

  /*
   * Start at the end of the street's stretch FARTHEST from the hall.
   *
   * The first version started at the middle of each stretch, and for Asuncion
   * Street — which the hall stands on — the middle was the hall itself: a
   * zero-metre route of one point, which is not a line the map can draw. It was
   * also the wrong idea for every other street: a route from the middle covers
   * the residents on one side of it. A route from the far end runs the length
   * of the street towards the hall, so everyone living on it is standing on the
   * route they will walk.
   */
  const start = candidates.reduce((best, p) =>
    metres(p, HALL.point) > metres(best, HALL.point) ? p : best,
  );
  return { name, start, inside: candidates.length };
});

/* ---------------------------------------------------------------------------
 * Routes — every area to the barangay hall, along real streets
 * ------------------------------------------------------------------------ */

const graph = buildWalkGraph(streets);

for (const area of areas) {
  const route = walkRoute(graph, area.start, HALL.point);
  must(route !== null, `no walking route from ${area.name} to the barangay hall`);
  must(
    route.line.length >= 2,
    `${area.name}: the route is a single point — its start is the hall itself`,
  );
  area.route = route;
}

/* ---------------------------------------------------------------------------
 * SQL — archive, clear, and write Callaguip, in one transaction
 * ------------------------------------------------------------------------ */

const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const json = (value) => `'${JSON.stringify(value)}'::jsonb`;

/* Cleared in an order the foreign keys accept. */
const CLEARED = [
  "checkins",
  "headcounts",
  "residents",
  "hazard_reports",
  "water_reports",
  "rescue_requests",
  "signal_history",
  "protocols",
  "evac_centers",
  "puroks",
];
const STAMP = "20260919";

const sql = [];

sql.push(`-- #5 Callaguip, Batac City, Ilocos Norte — the geography.
--
-- GENERATED by scripts/generate-callaguip.mjs — edit that, not this file.
--
-- Replaces the fictional San Isidro, Sta. Cruz, Laguna. Everything below runs
-- in one transaction, so the app never sees a barangay without areas.
--
-- 1. The old test records are copied into the "archive" schema, which the
--    app's API does not expose, and then cleared. Kept, not destroyed: if any
--    of it is wanted back, it is one INSERT ... SELECT away.
--    Not cleared: user_roles (the real official and volunteer), translations,
--    documents.
--    Not reachable from SQL: 4 hazard photos in the "hazard-photos" storage
--    bucket. Supabase only deletes storage objects through its Storage API,
--    so they are left for the dashboard. They are private and orphaned.
--
-- 2. The barangay becomes #5 Callaguip, at OSM node 8883724672, with an outline
--    traced along the streets that bound it and the population the barangay
--    gave (832, PhilAtlas). The household count is left unset for staff to
--    enter.
--
-- 3. Six areas named after its streets, one evacuation centre at the barangay
--    hall, and a walking route from every area to the hall for signals 1 to 5.
--
-- Road geometry (c) OpenStreetMap contributors, ODbL.
`);

sql.push(`create schema if not exists archive;
revoke all on schema archive from public;
`);

for (const table of ["barangays", ...CLEARED]) {
  sql.push(`create table archive.${table}_${STAMP} as table public.${table};`);
}
sql.push("");

for (const table of CLEARED) sql.push(`delete from public.${table};`);
sql.push("");

sql.push(`update public.barangays
set name = ${q(BARANGAY.name)},
    municipality = ${q(BARANGAY.municipality)},
    province = ${q(BARANGAY.province)},
    current_signal_level = 0,
    storm_name = null,
    bulletin_no = null,
    wind_kph = null,
    evacuate_by = null,
    signal_set_at = null,
    signal_set_by = null,
    expected_households = null,
    lat = ${BARANGAY.point[1]},
    lng = ${BARANGAY.point[0]},
    boundary_geojson = ${json(outline)},
    population = ${BARANGAY.population},
    population_source = ${q(BARANGAY.populationSource)};
`);

sql.push(`insert into public.puroks (barangay_id, name, lat, lng)
select b.id, v.name, v.lat, v.lng
from public.barangays b,
  (values
${areas.map((a) => `    (${q(a.name)}, ${a.start[1]}, ${a.start[0]})`).join(",\n")}
  ) as v(name, lat, lng);
`);

sql.push(`insert into public.evac_centers (purok_id, name, capacity, lat, lng)
select p.id, ${q(HALL.name)}, null, ${HALL.point[1]}, ${HALL.point[0]}
from public.puroks p
where p.name = ${q(HALL.area)};
`);

for (const area of areas) {
  const via = area.route.via.length ? ` · ${area.route.via.join(" → ")}` : "";
  const description = `${area.name} → ${HALL.name} · ${area.route.metres} m${via}`;
  const line = {
    type: "LineString",
    coordinates: area.route.line.map((p) => [+p[0].toFixed(7), +p[1].toFixed(7)]),
  };
  sql.push(`insert into public.protocols (purok_id, signal_level, route, route_geojson, action_key, evac_center_id)
select p.id, s.level, ${q(description)}, ${json(line)}, s.action_key, c.id
from public.puroks p
cross join public.evac_centers c
cross join (values
${Object.entries(ACTION_BY_SIGNAL).map(([level, key]) => `    (${level}, ${q(key)})`).join(",\n")}
  ) as s(level, action_key)
where p.name = ${q(area.name)} and c.name = ${q(HALL.name)};
`);
}

writeFileSync(
  join(ROOT, "supabase", "migrations", "0027_callaguip_geography.sql"),
  sql.join("\n") + "\n",
);

/* ---------------------------------------------------------------------------
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nGeography from real roads — ${BARANGAY.name}, ${BARANGAY.municipality}\n`);
console.log(`  extract   ${extract.ways.length} ways (${extract.fetched})`);
console.log(`  graph     ${graph.nodes.length} nodes in the largest connected component`);
console.log(`  streets   ${streets.features.length} features -> ./public/geo/streets.json`);
console.log(`  outline   ${ring.length - 1} points, about ${(areaM2 / 10_000).toFixed(1)} hectares`);
console.log(`  checks    marker inside, hall inside, Nalupta's hall outside\n`);
for (const area of areas) {
  console.log(
    `  ${area.name.padEnd(16)} ${String(area.route.metres).padStart(5)} m  ${String(area.route.line.length).padStart(3)} pts  from ${area.start[1].toFixed(5)},${area.start[0].toFixed(5)}  via ${area.route.via.join(" → ") || "(unnamed)"}`,
  );
}
console.log(`\n  0027      archive + clear ${CLEARED.length} tables, 6 areas, 1 centre, 30 protocols\n`);
