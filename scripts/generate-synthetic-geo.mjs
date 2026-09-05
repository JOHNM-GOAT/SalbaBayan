/**
 * Generate the synthetic geography for Barangay San Isidro.
 *
 * Q4 (a real pilot barangay with real Purok boundaries) is still open, and the
 * team chose to proceed on synthetic geography rather than block Phase 4. This
 * script is that geography — generated rather than hand-typed, so it is
 * reproducible, reviewable as a diff, and trivially replaceable when real
 * coordinates arrive: swap ORIGIN and the layout, re-run, re-apply.
 *
 * It is anchored on plausible real coordinates near Sta. Cruz, Laguna so that
 * distances, zoom levels and GPS behaviour are realistic. It is NOT a real
 * barangay and must not be presented as one.
 *
 * Emits:
 *   public/geo/streets.json                       — the base map, precached
 *   supabase/migrations/0008_synthetic_geography.sql — boundaries, routes, coords
 *
 * Run:  node scripts/generate-synthetic-geo.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** South-west corner of the barangay. */
const ORIGIN = { lat: 14.277, lng: 121.41 };

/**
 * Metres to degrees at this latitude. Good enough over ~1km — the error from
 * treating the area as flat is centimetres, far below GPS accuracy.
 */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const dLat = (m) => m / M_PER_DEG_LAT;
const dLng = (m) => m / M_PER_DEG_LNG;

/** Grid position (metres east, metres north) to [lng, lat]. */
const pt = (east, north) => [
  +(ORIGIN.lng + dLng(east)).toFixed(6),
  +(ORIGIN.lat + dLat(north)).toFixed(6),
];

/* ---------------------------------------------------------------------------
 * Layout: 4 x 2 blocks of 300m. Puroks 1-4 north, 5-8 south.
 * ------------------------------------------------------------------------ */

const BLOCK = 300;
const COLS = 4;
const ROWS = 2;
const WIDTH = COLS * BLOCK;
const HEIGHT = ROWS * BLOCK;

const puroks = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    // Purok 1-4 across the north row, 5-8 across the south.
    const number = row === 0 ? col + 1 : COLS + col + 1;
    const north = row === 0 ? HEIGHT - BLOCK : 0;
    const east = col * BLOCK;
    puroks.push({
      name: `Purok ${number}`,
      east,
      north,
      centroid: [east + BLOCK / 2, north + BLOCK / 2],
      polygon: [
        pt(east, north),
        pt(east + BLOCK, north),
        pt(east + BLOCK, north + BLOCK),
        pt(east, north + BLOCK),
        pt(east, north),
      ],
    });
  }
}

/** Evacuation centres, positioned on the street grid they are reached along. */
const centres = {
  "Barangay Gym": [BLOCK * 2, HEIGHT],
  "San Roque Chapel": [BLOCK, 0],
  "San Isidro Elementary School": [BLOCK * 3 + BLOCK / 2, 0],
};

/* ---------------------------------------------------------------------------
 * Streets — a grid, so routes can follow them instead of cutting through
 * blocks. Rendered as the base map; there is no tile source for a barangay
 * that does not exist.
 * ------------------------------------------------------------------------ */

const NAMES = ["Rizal St.", "Mabini St.", "Bonifacio St.", "Luna St.", "Del Pilar St."];

const streets = { type: "FeatureCollection", features: [] };

// North-south streets every 150m.
for (let i = 0, east = 0; east <= WIDTH; east += BLOCK / 2, i++) {
  streets.features.push({
    type: "Feature",
    properties: {
      name: NAMES[i % NAMES.length],
      kind: east % BLOCK === 0 ? "main" : "minor",
    },
    geometry: { type: "LineString", coordinates: [pt(east, 0), pt(east, HEIGHT)] },
  });
}

// East-west streets every 150m.
for (let i = 0, north = 0; north <= HEIGHT; north += BLOCK / 2, i++) {
  streets.features.push({
    type: "Feature",
    properties: {
      name: NAMES[(i + 2) % NAMES.length],
      kind: north % BLOCK === 0 ? "main" : "minor",
    },
    geometry: { type: "LineString", coordinates: [pt(0, north), pt(WIDTH, north)] },
  });
}

// Blocks, drawn as filled ground so the grid reads as a settlement rather than
// as floating lines. Matches the approved evacuation-map artboard.
for (const purok of puroks) {
  for (let sub = 0; sub < 4; sub++) {
    const ox = purok.east + (sub % 2) * (BLOCK / 2) + 22;
    const oy = purok.north + Math.floor(sub / 2) * (BLOCK / 2) + 22;
    const size = BLOCK / 2 - 44;
    streets.features.push({
      type: "Feature",
      properties: { kind: "block" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [pt(ox, oy), pt(ox + size, oy), pt(ox + size, oy + size), pt(ox, oy + size), pt(ox, oy)],
        ],
      },
    });
  }
}

mkdirSync(join(ROOT, "public", "geo"), { recursive: true });
writeFileSync(
  join(ROOT, "public", "geo", "streets.json"),
  JSON.stringify(streets),
);

/* ---------------------------------------------------------------------------
 * Routes — L-shaped, along the grid, from Purok centroid to assigned centre.
 * ------------------------------------------------------------------------ */

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

function routeFor(purok) {
  const [cx, cy] = purok.centroid;
  const [tx, ty] = centres[ASSIGNMENT[purok.name]];
  // Snap the start to the nearest north-south street, then travel along it,
  // then turn. Two legs, which is what the next-turn card describes.
  const lane = Math.round(cx / (BLOCK / 2)) * (BLOCK / 2);
  const points = [pt(cx, cy), pt(lane, cy), pt(lane, ty), pt(tx, ty)];

  // Drop repeated points. When a centroid already sits on its lane, or the
  // centre sits on the turn, the naive path produces zero-length segments —
  // harmless to render but they break bearing calculations for the next-turn
  // card, which divides by segment length.
  return {
    type: "LineString",
    coordinates: points.filter(
      (p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1],
    ),
  };
}

const metres = (a, b) => {
  const dx = (a[0] - b[0]) * M_PER_DEG_LNG;
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
};

const routeLength = (line) =>
  line.coordinates.slice(1).reduce(
    (sum, point, i) => sum + metres(line.coordinates[i], point),
    0,
  );

/* ---------------------------------------------------------------------------
 * SQL
 * ------------------------------------------------------------------------ */

const sql = [];
sql.push(`-- Synthetic geography for Barangay San Isidro.
--
-- GENERATED by scripts/generate-synthetic-geo.mjs — edit that, not this file.
--
-- Q4 (a real pilot barangay) is still open and the team chose to proceed on
-- synthetic geography rather than block Phase 4. It is anchored on plausible
-- coordinates near Sta. Cruz, Laguna so distances, zoom and GPS behave
-- realistically, but it is NOT a real barangay and must not be shown as one.
--
-- The geometry lives here rather than in the client because PRD §10 says
-- boundaries and routes are entered by officials during protocol setup. Putting
-- it in the database also means it rides along in the advisory snapshot the app
-- already caches, so the map works offline with no separate fetch or cache.

-- Coordinates for evacuation centres and hazard reports.
--
-- Both were missing them entirely, which made the whole Phase 4 view
-- impossible: a centre with no position cannot be a destination, and a hazard
-- with no position cannot be tested against a route, so "path blocked" could
-- never be computed. Nullable on hazards for the same reason as on
-- rescue_requests — a report must never be blocked on a GPS fix.
alter table public.evac_centers
  add column if not exists lat double precision,
  add column if not exists lng double precision;

alter table public.hazard_reports
  add column if not exists lat double precision,
  add column if not exists lng double precision;
`);

for (const [name, [east, north]] of Object.entries(centres)) {
  const [lng, lat] = pt(east, north);
  sql.push(
    `update public.evac_centers set lat = ${lat}, lng = ${lng} where name = '${name.replace(/'/g, "''")}';`,
  );
}
sql.push("");

for (const purok of puroks) {
  const boundary = {
    type: "Polygon",
    coordinates: [purok.polygon],
  };
  sql.push(
    `update public.puroks set boundary_geojson = '${JSON.stringify(boundary)}'::jsonb where name = '${purok.name}';`,
  );
}
sql.push("");

for (const purok of puroks) {
  const line = routeFor(purok);
  const length = Math.round(routeLength(line));
  sql.push(
    `update public.protocols p set route_geojson = '${JSON.stringify(line)}'::jsonb, route = '${purok.name} → ${ASSIGNMENT[purok.name]} · ${length} m' from public.puroks pk where pk.id = p.purok_id and pk.name = '${purok.name}';`,
  );
}

/*
 * Two open hazards placed ON a route on purpose, so the "path blocked" warning
 * has something real to detect. A feature that can only be demonstrated by
 * hand-editing the database is a feature nobody will check.
 */
const hazardOnRoute = pt(BLOCK * 2, HEIGHT - BLOCK / 2);
const hazardElsewhere = pt(BLOCK * 3 + 40, BLOCK + 60);
sql.push(`
insert into public.hazard_reports (id, purok_id, category, description, status, lat, lng)
select gen_random_uuid(), pk.id, 'flooding', 'Baha sa Mabini St. — hanggang tuhod', 'open', ${hazardOnRoute[1]}, ${hazardOnRoute[0]}
from public.puroks pk where pk.name = 'Purok 3';

insert into public.hazard_reports (id, purok_id, category, description, status, lat, lng)
select gen_random_uuid(), pk.id, 'fallen_tree', 'Nabuwal na puno sa Luna St.', 'open', ${hazardElsewhere[1]}, ${hazardElsewhere[0]}
from public.puroks pk where pk.name = 'Purok 4';`);

writeFileSync(
  join(ROOT, "supabase", "migrations", "0008_synthetic_geography.sql"),
  sql.join("\n") + "\n",
);

console.log(`streets.json      ${streets.features.length} features`);
console.log(`0008 migration    ${puroks.length} boundaries, ${puroks.length} routes, 3 centres`);
console.log(`extent            ${WIDTH}m x ${HEIGHT}m around ${ORIGIN.lat}, ${ORIGIN.lng}`);
