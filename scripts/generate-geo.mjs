/**
 * Barangay geography, laid on the real street network.
 *
 * `generate-synthetic-geo.mjs` invented a 4x2 grid of 300 m blocks because Q4
 * (a real pilot barangay) was open and no tile source had streets for a place
 * that does not exist. That was the right call while the map drew its own
 * basemap. It stopped being the right call the moment the map started drawing
 * OpenStreetMap underneath: an evacuation route that runs straight through
 * buildings, ignoring every road on the map it is painted on, is worse than no
 * route at all — it is an instruction, and it would be a wrong one.
 *
 * So the roads are now real. This script reads an OpenStreetMap extract of
 * Sta. Cruz, Laguna, builds a walking graph from it, and routes each Purok to
 * its evacuation centre along actual streets by shortest path. The barangay
 * itself stays fictional — the Purok names, the centres and the hazards are
 * still invented, and must not be presented as real — but everything they sit
 * on, and every metre the app quotes, now comes from surveyed geometry.
 *
 * Emits:
 *   public/geo/streets.json                   — offline base map, precached
 *   supabase/migrations/0014_real_routes.sql  — routes, boundaries, positions
 *
 * 0008 is left exactly as it was. It has been applied, and a migration that has
 * run is a record of what happened, not a draft.
 *
 * Run:  node scripts/generate-geo.mjs
 *       node scripts/generate-geo.mjs --fetch   (refresh the OSM extract)
 *
 * Road data (c) OpenStreetMap contributors, ODbL. The app carries the required
 * attribution on both map screens.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTRACT = join(ROOT, "scripts", "osm", "santa-cruz-roads.json");

/* The area the barangay occupies, plus a margin so routes near the edge are
   not clipped into dead ends by the download boundary. */
const BBOX = [14.2755, 121.4085, 14.284, 121.423];
const OVERPASS = "https://overpass-api.de/api/interpreter";

/* ---------------------------------------------------------------------------
 * The OSM extract
 *
 * Cached in the repo rather than fetched on every run. Overpass is a shared
 * public service, the generator is deterministic only if its input is fixed,
 * and a build that reaches the internet is a build that fails on a bad
 * connection — which is a poor property for the offline-first app.
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
      g: way.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]),
    }));

  writeFileSync(
    EXTRACT,
    JSON.stringify({
      note: "OpenStreetMap extract, ODbL. Refresh with: node scripts/generate-geo.mjs --fetch",
      bbox: BBOX,
      fetched: new Date().toISOString().slice(0, 10),
      ways,
    }),
  );
  console.log(`fetched ${ways.length} ways -> ./scripts/osm/santa-cruz-roads.json`);
}

if (process.argv.includes("--fetch")) await fetchExtract();

const extract = JSON.parse(readFileSync(EXTRACT, "utf8"));

/* ---------------------------------------------------------------------------
 * Geometry helpers — flat-earth, which over 1.5 km is accurate to centimetres
 * and far below any GPS fix this app will ever see.
 * ------------------------------------------------------------------------ */

const ORIGIN = { lat: 14.277, lng: 121.41 };
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const dLat = (m) => m / M_PER_DEG_LAT;
const dLng = (m) => m / M_PER_DEG_LNG;

/** Grid position (metres east, metres north of ORIGIN) to [lng, lat]. */
const pt = (east, north) => [
  +(ORIGIN.lng + dLng(east)).toFixed(6),
  +(ORIGIN.lat + dLat(north)).toFixed(6),
];

const metres = (a, b) => {
  const dx = (a[0] - b[0]) * M_PER_DEG_LNG;
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
};

const lineLength = (line) =>
  line.slice(1).reduce((sum, point, i) => sum + metres(line[i], point), 0);

/* ---------------------------------------------------------------------------
 * The walking graph
 *
 * Every highway in the extract is walkable here. That is true of this place:
 * the widest road in the barangay is a two-lane secondary with a footway on
 * both sides, and residents walk all of them. On a network with a motorway
 * through it this filter would have to grow teeth.
 * ------------------------------------------------------------------------ */

const coord = new Map(); // node id -> [lng, lat]
const adj = new Map(); // node id -> [{ to, m, way }]

const link = (a, b, way) => {
  const m = metres(coord.get(a), coord.get(b));
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push({ to: b, m, way });
};

for (const way of extract.ways) {
  way.d.forEach((id, i) => coord.set(id, way.g[i]));
  for (let i = 1; i < way.d.length; i++) {
    const a = way.d[i - 1];
    const b = way.d[i];
    if (a === b) continue;
    // Both directions: this is a pedestrian graph, and oneway is a rule for
    // vehicles. A resident told to walk the long way round a one-way street
    // during a storm surge would rightly ignore the app.
    link(a, b, way);
    link(b, a, way);
  }
}

/*
 * Route only within the largest connected component.
 *
 * Extracts clipped to a bounding box always contain orphans — a driveway whose
 * junction fell outside, a footpath drawn as its own island. Snapping a Purok
 * onto one of those produces no path at all, and the failure would show up as a
 * missing route rather than as an error.
 */
const component = (() => {
  const seen = new Set();
  let best = new Set();
  for (const start of coord.keys()) {
    if (seen.has(start)) continue;
    const group = new Set([start]);
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const node = queue.pop();
      for (const edge of adj.get(node) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        group.add(edge.to);
        queue.push(edge.to);
      }
    }
    if (group.size > best.size) best = group;
  }
  return best;
})();

const nearestNode = (point) => {
  let best = null;
  let bestDistance = Infinity;
  for (const id of component) {
    const d = metres(point, coord.get(id));
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
};

/** Shortest walking path between two graph nodes, as node ids. */
function shortestPath(from, to) {
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();

  // A linear scan for the next node. The graph is ~1200 nodes and this runs
  // eight times at build; a heap would be faster and harder to read.
  for (;;) {
    let node = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        node = id;
      }
    }
    if (node === null || node === to) break;
    done.add(node);

    for (const edge of adj.get(node) ?? []) {
      const through = best + edge.m;
      if (through < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, through);
        prev.set(edge.to, { from: node, way: edge.way });
      }
    }
  }

  if (!dist.has(to)) throw new Error(`no walking path between ${from} and ${to}`);

  const nodes = [to];
  const ways = [];
  for (let at = to; prev.has(at); ) {
    const step = prev.get(at);
    ways.unshift(step.way);
    at = step.from;
    nodes.unshift(at);
  }
  return { nodes, ways };
}

/* ---------------------------------------------------------------------------
 * The barangay — still invented, now anchored
 *
 * The 4x2 layout of 300 m Puroks is kept exactly as 0008 laid it out, because
 * the names are referenced across the database and the app. What changes is
 * that each one is now pinned to the roads that actually run through it.
 * ------------------------------------------------------------------------ */

const BLOCK = 300;
const COLS = 4;
const ROWS = 2;
const HEIGHT = ROWS * BLOCK;

const puroks = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const number = row === 0 ? col + 1 : COLS + col + 1;
    const north = row === 0 ? HEIGHT - BLOCK : 0;
    const east = col * BLOCK;
    puroks.push({
      name: `Purok ${number}`,
      east,
      north,
      centroid: pt(east + BLOCK / 2, north + BLOCK / 2),
      cell: [east, north, east + BLOCK, north + BLOCK],
    });
  }
}

const centres = {
  "Barangay Gym": pt(BLOCK * 2, HEIGHT),
  "San Roque Chapel": pt(BLOCK, 0),
  "San Isidro Elementary School": pt(BLOCK * 3 + BLOCK / 2, 0),
};

const ASSIGNMENT = {
  "Purok 1": "Barangay Gym",
  "Purok 2": "Barangay Gym",
  "Purok 3": "Barangay Gym",
  "Purok 4": "Barangay Gym",
  "Purok 5": "San Roque Chapel",
  "Purok 6": "San Roque Chapel",
  "Purok 7": "San Isidro Elementary School",
  "Purok 8": "San Isidro Elementary School",
};

/*
 * Centres move onto the network.
 *
 * A destination a few metres off the nearest street is a destination the router
 * cannot reach and the resident cannot see the last leg of. Snapping keeps them
 * exactly as fictional as they were and makes them arrivable.
 */
const centreNode = {};
const centrePoint = {};
for (const [name, position] of Object.entries(centres)) {
  const node = nearestNode(position);
  centreNode[name] = node;
  centrePoint[name] = coord.get(node);
}

/* ---------------------------------------------------------------------------
 * Boundaries — the convex hull of the roads inside each cell
 *
 * A rectangle drawn over a real street layout reads as a rectangle drawn over a
 * real street layout. Hulling the roads that actually fall inside the cell
 * produces an edge that follows the settlement instead of cutting across it,
 * which is what a Purok boundary does in practice.
 * ------------------------------------------------------------------------ */

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...half(sorted), ...half([...sorted].reverse())];
}

/** Shoelace area in square metres, for judging whether a hull is a shape. */
function polygonArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * M_PER_DEG_LNG * (b[1] * M_PER_DEG_LAT) -
      b[0] * M_PER_DEG_LNG * (a[1] * M_PER_DEG_LAT);
  }
  return Math.abs(sum / 2);
}

const inCell = (point, [x0, y0, x1, y1]) => {
  const east = (point[0] - ORIGIN.lng) * M_PER_DEG_LNG;
  const north = (point[1] - ORIGIN.lat) * M_PER_DEG_LAT;
  return east >= x0 && east <= x1 && north >= y0 && north <= y1;
};

for (const purok of puroks) {
  const inside = [];
  for (const way of extract.ways) {
    for (const point of way.g) if (inCell(point, purok.cell)) inside.push(point);
  }

  /*
   * A cell with too little road in it keeps its rectangle.
   *
   * The point count alone is not a sufficient test, which Purok 4 proved: its
   * corner of the barangay has one mapped road running along a single edge, so
   * there were plenty of vertices and their hull was a 5%-of-cell splinter that
   * rendered as a spike across the map. Measuring the area is the honest check
   * — below a quarter of the cell the roads do not describe the settlement, and
   * the rectangle at least admits to being an approximation instead of drawing
   * a confident wrong shape.
   */
  const hull = inside.length >= 8 ? convexHull(inside) : null;
  const CELL_AREA = BLOCK * BLOCK;
  const usable = hull && hull.length >= 4 && polygonArea(hull) >= CELL_AREA * 0.25;

  const ring = (usable ? hull : null) ?? [
    pt(purok.cell[0], purok.cell[1]),
    pt(purok.cell[2], purok.cell[1]),
    pt(purok.cell[2], purok.cell[3]),
    pt(purok.cell[0], purok.cell[3]),
  ];
  purok.boundary = {
    type: "Polygon",
    coordinates: [[...ring, ring[0]].map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)])],
  };
  purok.roadPoints = inside.length;
}

/* ---------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------ */

const SUFFIX = /\b(Street|Avenue|Road|Boulevard|Drive|Highway)\b/g;
const SHORT = { Street: "St.", Avenue: "Ave.", Road: "Rd.", Boulevard: "Blvd.", Drive: "Dr.", Highway: "Hwy." };

for (const purok of puroks) {
  const destination = ASSIGNMENT[purok.name];
  const start = nearestNode(purok.centroid);
  const { nodes, ways } = shortestPath(start, centreNode[destination]);

  const line = nodes.map((id) => coord.get(id));
  purok.route = { type: "LineString", coordinates: line };
  purok.metres = Math.round(lineLength(line));

  /*
   * The streets walked, in order, without repeats. The route description is
   * read by an official checking the protocol and by a resident who cannot see
   * the map, and "left at Mabini" is the form both of them already use.
   */
  const named = [];
  for (const way of ways) {
    if (!way.n) continue;
    const label = way.n.replace(SUFFIX, (m) => SHORT[m]);
    if (named[named.length - 1] !== label) named.push(label);
  }
  purok.via = named.slice(0, 3);
}

/* ---------------------------------------------------------------------------
 * Hazards
 *
 * 0008 put one hazard ON a route so the blocked-path warning (FR-2.8) has
 * something real to detect — a feature only demonstrable by hand-editing the
 * database is a feature nobody checks. The routes have moved, so the hazard has
 * to move with them or that warning silently stops firing.
 * ------------------------------------------------------------------------ */

const purok3 = puroks.find((p) => p.name === "Purok 3");
const onRoute = purok3.route.coordinates[Math.floor(purok3.route.coordinates.length / 2)];

/* And one that is genuinely NOT on any route, so "blocked" staying quiet is
   also being tested. 40 m clears BLOCKED_RADIUS_M with room to spare. */
const everyRoutePoint = puroks.flatMap((p) => p.route.coordinates);
const offRoute = (() => {
  for (const id of component) {
    const point = coord.get(id);
    if (!inCell(point, [0, 0, COLS * BLOCK, HEIGHT])) continue;
    const clear = everyRoutePoint.every((r) => metres(point, r) > 60);
    if (clear) return point;
  }
  throw new Error("nowhere off-route inside the barangay");
})();

/* ---------------------------------------------------------------------------
 * public/geo/streets.json — the offline base map
 * ------------------------------------------------------------------------ */

const MAIN = new Set(["primary", "secondary", "tertiary"]);

const streets = {
  type: "FeatureCollection",
  features: extract.ways.map((way) => ({
    type: "Feature",
    properties: {
      kind: MAIN.has(way.h) ? "main" : way.h === "service" || way.h === "footway" ? "path" : "minor",
      name: way.n,
    },
    geometry: { type: "LineString", coordinates: way.g },
  })),
};

writeFileSync(join(ROOT, "public", "geo", "streets.json"), JSON.stringify(streets));

/* ---------------------------------------------------------------------------
 * SQL
 * ------------------------------------------------------------------------ */

const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sql = [];

sql.push(`-- Real street geometry for Barangay San Isidro.
--
-- GENERATED by scripts/generate-geo.mjs — edit that, not this file.
--
-- Supersedes the geometry in 0008. That migration laid the barangay out as a
-- 4x2 grid of invented 300 m blocks, which was correct while the map drew its
-- own base. Now that the resident map draws OpenStreetMap underneath (see
-- src/lib/basemap.ts), an invented route reads as an instruction to walk
-- through buildings, and the distance printed beside it is not a distance
-- anyone could walk.
--
-- So every route here is a shortest path along surveyed roads, the evacuation
-- centres sit on the network they are reached along, and each Purok boundary is
-- the hull of the streets actually inside it.
--
-- What has NOT changed: the barangay is still fictional. Purok names, centre
-- names and hazards are invented and must never be presented as real. Only the
-- ground they sit on is now true.
--
-- Road geometry (c) OpenStreetMap contributors, ODbL.

`);

for (const [name, point] of Object.entries(centrePoint)) {
  sql.push(
    `update public.evac_centers set lat = ${point[1]}, lng = ${point[0]} where name = ${q(name)};`,
  );
}
sql.push("");

for (const purok of puroks) {
  sql.push(
    `update public.puroks set boundary_geojson = '${JSON.stringify(purok.boundary)}'::jsonb where name = ${q(purok.name)};`,
  );
}
sql.push("");

for (const purok of puroks) {
  const via = purok.via.length ? ` · ${purok.via.join(" → ")}` : "";
  const description = `${purok.name} → ${ASSIGNMENT[purok.name]} · ${purok.metres} m${via}`;
  sql.push(
    `update public.protocols p set route_geojson = '${JSON.stringify(purok.route)}'::jsonb, route = ${q(description)} from public.puroks pk where pk.id = p.purok_id and pk.name = ${q(purok.name)};`,
  );
}
sql.push("");

sql.push(`-- The hazards move with the routes they were placed against.
update public.hazard_reports set lat = ${onRoute[1]}, lng = ${onRoute[0]}
  where description = 'Baha sa Mabini St. — hanggang tuhod';
update public.hazard_reports set lat = ${offRoute[1]}, lng = ${offRoute[0]}
  where description = 'Nabuwal na puno sa Luna St.';`);

writeFileSync(
  join(ROOT, "supabase", "migrations", "0014_real_routes.sql"),
  sql.join("\n") + "\n",
);

/* ---------------------------------------------------------------------------
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nGeography from real roads — Barangay San Isidro\n`);
console.log(`  extract     ${extract.ways.length} ways, ${coord.size} nodes (${extract.fetched})`);
console.log(`  graph       ${component.size} nodes in the largest connected component`);
console.log(`  streets     ${streets.features.length} features -> ./public/geo/streets.json\n`);

for (const purok of puroks) {
  const via = purok.via.length ? purok.via.join(" → ") : "(unnamed roads)";
  console.log(
    `  ${purok.name.padEnd(8)} ${String(purok.metres).padStart(5)} m  ${String(purok.route.coordinates.length).padStart(3)} pts  ${via}`,
  );
}
console.log(`\n  0014        8 routes, 8 boundaries, 3 centres, 2 hazards\n`);
