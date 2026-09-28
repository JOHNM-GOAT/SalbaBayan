/**
 * Nilombot, Mapandan, Pangasinan — geography from OpenStreetMap.
 *
 * Replaces #5 Callaguip, Batac City (scripts/generate-callaguip.mjs). What is
 * real here, and where each piece came from:
 *
 *   - The barangay's outline: OSM relation 13315002 — `boundary=administrative`,
 *     `admin_level=10`, `border_type=barangay`, PSGC ref 0105528012. This is the
 *     OFFICIAL line as mapped, not a trace along streets, which is what
 *     Callaguip had to settle for. Five ways, stitched into one closed ring of
 *     35 points.
 *   - Its point: OSM node 4369884571, "Nilombot", place=village, admin_level=10.
 *   - Population 4,411, from the same relation (`population:date` 2020-05-01,
 *     the PSA census).
 *   - The areas residents choose from: the named streets with geometry inside
 *     the outline — Pandan Avenue and the flower-named grid — until the
 *     barangay supplies its own Purok list. Streets in the extract that fall
 *     OUTSIDE the boundary (Santa Barbara-Mangaldan Road, Pico Avenue, Cacao,
 *     Rosal, Golden Shower, Apayas, Lawin) belong to neighbouring barangays and
 *     are deliberately not offered.
 *   - The one evacuation centre: Nilombot Elementary School (OSM way
 *     790262129), which is the building a Philippine barangay normally
 *     evacuates to. OSM maps NO barangay hall inside Nilombot, so none is
 *     invented here — officials can add one on the map.
 *   - Routes: shortest walking paths along OSM streets, computed by
 *     src/lib/walkRoute.ts — the same code the app uses when a centre moves.
 *
 * The extract comes from api.openstreetmap.org rather than Overpass: every
 * Overpass mirror was timing out when this was built, and `/api/0.6/map.json`
 * serves the same data for a bbox this size. Way geometry is resolved from node
 * refs here instead of by the server.
 *
 * Emits:
 *   public/geo/streets.json                          — offline base map
 *   supabase/migrations/0063_nilombot_geography.sql  — archive, clear, insert
 *
 * Run:  node scripts/generate-nilombot.mjs           (uses the cached extract)
 *       node scripts/generate-nilombot.mjs --fetch   (refresh it from OSM)
 *
 * Road and boundary data (c) OpenStreetMap contributors, ODbL. The app carries
 * the required attribution on every map screen.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWalkGraph, metres, pointInRing, walkRoute } from "../src/lib/walkRoute.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROADS = join(ROOT, "scripts", "osm", "nilombot-roads.json");
const BOUNDARY = join(ROOT, "scripts", "osm", "nilombot-boundary.json");

/* Nilombot and roughly 900 m of margin, so routes near the edge are not cut
   into dead ends by the extract itself. */
const BBOX = [16.0079, 120.4112, 16.0426, 120.4478]; // s, w, n, e

const BARANGAY = {
  name: "Nilombot",
  municipality: "Mapandan",
  province: "Pangasinan",
  point: [120.4286234, 16.0253207], // OSM node 4369884571
  population: 4411,
  populationSource: "PSA 2020 census, via OSM relation 13315002",
  psgc: "0105528012",
};

const CENTRE = {
  name: "Nilombot Elementary School",
  point: [120.4362941, 16.0281798], // OSM way 790262129, its centre
  osm: "way/790262129",
};

/* Known points used to check the outline landed in the right place. Both are
   named streets in the extract that belong to neighbouring barangays. */
const OUTSIDE = [
  { name: "Pico Avenue", point: [120.4225, 16.0105] },
  { name: "Lawin Street", point: [120.4436, 16.0398] },
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
  const url =
    "https://api.openstreetmap.org/api/0.6/map.json?bbox=" +
    [BBOX[1], BBOX[0], BBOX[3], BBOX[2]].join(",");

  const response = await fetch(url, {
    headers: { "User-Agent": "SalbaBayan/0.1 (barangay evacuation PWA)" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`OSM API ${response.status}`);

  const body = await response.json();

  const nodes = new Map();
  for (const e of body.elements) {
    if (e.type === "node") nodes.set(e.id, [+e.lon.toFixed(7), +e.lat.toFixed(7)]);
  }

  const ways = [];
  for (const e of body.elements) {
    if (e.type !== "way" || !e.tags?.highway) continue;
    const g = (e.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean);
    if (g.length < 2) continue;
    ways.push({ i: e.id, h: e.tags.highway, n: e.tags.name ?? undefined, g });
  }

  writeFileSync(
    ROADS,
    JSON.stringify({
      note: "OpenStreetMap extract, ODbL. api.openstreetmap.org /api/0.6/map.json",
      bbox: BBOX,
      fetched: new Date().toISOString().slice(0, 10),
      ways,
    }),
  );
  console.log(`fetched ${ways.length} ways -> ./scripts/osm/nilombot-roads.json`);
}

if (process.argv.includes("--fetch") || !existsSync(ROADS)) await fetchExtract();

const extract = JSON.parse(readFileSync(ROADS, "utf8"));
const boundary = JSON.parse(readFileSync(BOUNDARY, "utf8"));

function must(ok, message) {
  if (!ok) throw new Error(message);
}

/* ---------------------------------------------------------------------------
 * The outline — the official boundary relation, checked before it is trusted
 * ------------------------------------------------------------------------ */

const ring = boundary.ring;
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

must(Array.isArray(ring) && ring.length > 3, "the boundary ring is missing or too short");
must(same(ring[0], ring[ring.length - 1]), "the boundary ring does not close");
must(pointInRing(BARANGAY.point, ring), "the Nilombot marker is outside the outline");
must(pointInRing(CENTRE.point, ring), `${CENTRE.name} is outside the outline`);
for (const { name, point } of OUTSIDE) {
  must(!pointInRing(point, ring), `${name} reads as inside the outline; it is another barangay`);
}

const outline = { type: "Polygon", coordinates: [ring] };

/** Shoelace area, for the report. */
const areaM2 = (() => {
  const kx = 111_320 * Math.cos((BARANGAY.point[1] * Math.PI) / 180);
  const ky = 110_574;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky);
  }
  return Math.abs(sum / 2);
})();

/* ---------------------------------------------------------------------------
 * public/geo/streets.json — the offline base map, and the routing network
 * ------------------------------------------------------------------------ */

// Pandan Avenue is the secondary road through Nilombot; the Santa
// Barbara-Mangaldan Road is the primary one just outside it.
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
 * The areas — one per named street with geometry inside the boundary
 * ------------------------------------------------------------------------ */

/*
 * A street belongs to Nilombot when it has a point STRICTLY inside the
 * boundary. Nothing is accepted for running near the line.
 *
 * Callaguip used a 3 m tolerance, and there it was right: its outline had to be
 * traced along the streets that bounded it, so those streets sat exactly on
 * their own boundary and would have excluded themselves. Nilombot's outline is
 * the administrative line, and the same tolerance did real damage — Rosal
 * Street shares a single node with it and lies entirely on the far side, so it
 * was offered to residents as one of their own areas when it belongs to the
 * next barangay. Somebody on Rosal Street would have been given a route from a
 * barangay they do not live in.
 *
 * The data leaves no doubt about the threshold: every street here has either
 * none of its points inside or at least three. There is no borderline case to
 * agonise over.
 */
const inside = (p) => pointInRing(p, ring);

/* Streets that must NOT come out as areas, checked after the list is built.
   Each was wrongly included at some point, or is close enough that it could
   be: Rosal touches the boundary at one node, and the Santa Barbara-Mangaldan
   Road runs 6 m outside it for its whole length. */
const NOT_OURS = ["Rosal Street", "Santa Barbara-Mangaldan Road", "Pico Avenue", "Lawin Street"];

/* Discovered from the data rather than listed by hand. Callaguip named its six
   streets because the barangay did; here the boundary decides, which is the
   more trustworthy of the two and the reason the outline is checked above. */
const names = [...new Set(extract.ways.filter((w) => w.n).map((w) => w.n))].sort();

const areas = [];
for (const name of names) {
  const points = extract.ways
    .filter((w) => w.n === name)
    .flatMap((w) => w.g)
    .filter(inside);
  if (points.length === 0) continue; // a neighbouring barangay's street

  /*
   * Start at the end of the street's stretch FARTHEST from the centre, so the
   * route runs the length of the street and everybody living on it is standing
   * on the line they will walk. (Starting at the middle covers one side only,
   * and on the centre's own street it collapses to a zero-length route.)
   */
  const start = points.reduce((best, p) =>
    metres(p, CENTRE.point) > metres(best, CENTRE.point) ? p : best,
  );
  areas.push({ name, start, inside: points.length });
}

must(areas.length > 0, "no named street falls inside Nilombot");
for (const name of NOT_OURS) {
  must(
    !areas.some((a) => a.name === name),
    name + " is being offered as an area of Nilombot; it belongs to a neighbour",
  );
}

/* ---------------------------------------------------------------------------
 * Routes — every area to the evacuation centre, along real streets
 * ------------------------------------------------------------------------ */

const graph = buildWalkGraph(streets);

/*
 * The last leg is a walk from the street to the door.
 *
 * `walkRoute` runs between nodes of the street network, so it stops at the
 * street point nearest the destination. For Callaguip that was almost exactly
 * the hall, which stands on Asuncion Street; Nilombot Elementary School sits
 * 40 m back from Santan Street behind its gate, and a stored route that
 * stopped at the kerb would draw a line ending in the middle of nowhere while
 * the live map — which appends this same leg in `rankCentres` — drew one
 * ending at the school. The offline fallback has to match what the app draws,
 * or the two disagree exactly when the network is gone.
 *
 * Mirrors lib/centres.ts: append the destination when the route stops more
 * than 3 m from it, and count those metres.
 */
const DOOR_M = 3;
/* Far enough and this is not a door walk any more, it is a missing street. */
const MAX_DOOR_M = 120;

for (const area of areas) {
  const route = walkRoute(graph, area.start, CENTRE.point);
  must(route !== null, `no walking route from ${area.name} to ${CENTRE.name}`);
  must(
    route.line.length >= 2,
    `${area.name}: the route is a single point — its start is the centre itself`,
  );

  const line = [...route.line];
  const kerb = line[line.length - 1];
  const walkIn = metres(kerb, CENTRE.point);
  must(
    walkIn <= MAX_DOOR_M,
    `${area.name}: the route stops ${Math.round(walkIn)} m from ${CENTRE.name} — too far to be the walk from the street`,
  );
  if (walkIn > DOOR_M) line.push(CENTRE.point);

  area.route = {
    line,
    via: route.via,
    metres: Math.round(route.metres + (walkIn > DOOR_M ? walkIn : 0)),
  };
  area.walkIn = Math.round(walkIn);
}

/* ---------------------------------------------------------------------------
 * SQL — archive, clear, and write Nilombot, in one transaction
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
const STAMP = "20260928";

const sql = [];

sql.push(`-- Nilombot, Mapandan, Pangasinan — the geography.
--
-- GENERATED by scripts/generate-nilombot.mjs — edit that, not this file.
--
-- Replaces #5 Callaguip, Batac City, Ilocos Norte (migration 0027). Everything
-- below runs in one transaction, so the app never sees a barangay without
-- areas.
--
-- 1. The Callaguip records are copied into the "archive" schema, which the
--    app's API does not expose, and then cleared. Kept, not destroyed: if any
--    of it is wanted back, it is one INSERT ... SELECT away.
--    Not cleared: user_roles, translations, documents, push_subscriptions —
--    those belong to devices and people, not to a place.
--    Not reachable from SQL: any photo in the "hazard-photos" storage bucket.
--    Supabase only deletes storage objects through its Storage API.
--
-- 2. The barangay becomes Nilombot, at OSM node 4369884571, with the OFFICIAL
--    outline from OSM relation 13315002 (admin_level=10, border_type=barangay,
--    PSGC ${BARANGAY.psgc}) and the population that relation records.
--
--    This is a real improvement on what Callaguip had: its outline was traced
--    along the streets that appeared to bound it, because no boundary relation
--    existed. Nilombot's is the mapped administrative line.
--
-- 3. The areas are the ${areas.length} named streets with geometry inside that outline.
--    A Purok list from the barangay should replace them; street names are what
--    the map can prove today.
--
-- 4. One evacuation centre, ${CENTRE.name} (OSM ${CENTRE.osm}).
--    OSM maps no barangay hall inside Nilombot, so none is invented here.
--    Officials can add and move centres on the map.
--
-- 5. Every area gets the five signal protocols, each with the walking route to
--    the centre along real streets.
--
-- Outline area: ${(areaM2 / 10_000).toFixed(1)} hectares. Population ${BARANGAY.population} (${BARANGAY.populationSource}).
--
-- Road and boundary data (c) OpenStreetMap contributors, ODbL.

begin;

create schema if not exists archive;`);

for (const table of CLEARED) {
  sql.push(`create table if not exists archive.${table}_${STAMP} as table public.${table};
delete from public.${table};`);
}

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
    population_source = ${q(BARANGAY.populationSource)};`);

sql.push(`insert into public.puroks (barangay_id, name, lat, lng)
select b.id, v.name, v.lat, v.lng
from public.barangays b,
  (values
${areas.map((a) => `    (${q(a.name)}, ${a.start[1]}, ${a.start[0]})`).join(",\n")}
  ) as v(name, lat, lng);`);

/* The centre is placed in the area whose route is shortest — the street it
   actually stands on, as far as the street network can tell. */
const home = areas.reduce((best, a) => (a.route.metres < best.route.metres ? a : best));

sql.push(`insert into public.evac_centers (purok_id, name, capacity, lat, lng)
select p.id, ${q(CENTRE.name)}, null, ${CENTRE.point[1]}, ${CENTRE.point[0]}
from public.puroks p
where p.name = ${q(home.name)};`);

for (const area of areas) {
  const line = area.route.line;
  const text = `${area.name} → ${CENTRE.name} · ${area.route.metres} m · ${area.route.via.join(", ")}`;
  sql.push(`insert into public.protocols (purok_id, signal_level, route, route_geojson, action_key, evac_center_id)
select p.id, s.level, ${q(text)}, ${json({ type: "LineString", coordinates: line })}, s.action_key, c.id
from public.puroks p
cross join public.evac_centers c
cross join (values
${Object.entries(ACTION_BY_SIGNAL)
  .map(([level, key]) => `    (${level}, ${q(key)})`)
  .join(",\n")}
  ) as s(level, action_key)
where p.name = ${q(area.name)} and c.name = ${q(CENTRE.name)};`);
}

sql.push("commit;");

const out = join(ROOT, "supabase", "migrations", "0063_nilombot_geography.sql");
writeFileSync(out, sql.join("\n\n") + "\n");

/* ---------------------------------------------------------------------------
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nNilombot, Mapandan, Pangasinan`);
console.log(`  outline    ${ring.length} points, ${(areaM2 / 10_000).toFixed(1)} ha (OSM relation 13315002)`);
console.log(`  population ${BARANGAY.population} (${BARANGAY.populationSource})`);
console.log(`  streets    ${extract.ways.length} ways in the extract`);
console.log(`  network    ${graph.nodes.length} nodes, ${graph.nodes.filter((id) => {
  const [lng, lat] = id.split(",").map(Number);
  return pointInRing([lng, lat], ring);
}).length} of them inside the barangay`);
console.log(`  centre     ${CENTRE.name} (${CENTRE.osm}), on ${home.name}`);
console.log(`\n  areas and their walking routes:`);
for (const area of areas) {
  console.log(
    `    ${area.name.padEnd(18)} ${String(area.route.metres).padStart(5)} m  via ${area.route.via.join(", ")}  (last ${area.walkIn} m from the street to the gate)`,
  );
}
console.log(`\nwrote public/geo/streets.json`);
console.log(`wrote supabase/migrations/0063_nilombot_geography.sql`);
