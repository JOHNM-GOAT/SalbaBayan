/**
 * Building footprints for Nilombot — the offline base map's missing half.
 *
 * WHY THIS EXISTS, and why it is not OpenStreetMap:
 *
 * The app's online base map (OpenFreeMap Liberty) draws buildings from OSM, and
 * that is why #5 Callaguip looked full: Batac City's centre is densely mapped
 * by the OSM community. Nilombot has THIRTEEN buildings in OSM, twelve of them
 * the elementary school's own blocks. Nothing was removed when the barangay
 * moved; there was simply nothing there to draw.
 *
 * WHY NOT GOOGLE MAPS:
 *
 * Google Maps' footprints cannot be copied into this app at any zoom, in any
 * form. Their terms forbid deriving data from the service, and this repository
 * is public and carries an open licence — tracing them would put the barangay
 * in the wrong, not just us.
 *
 * WHAT THIS USES INSTEAD:
 *
 * Microsoft's Global ML Building Footprints, published under the Open Data
 * Commons Open Database License (ODbL) — the same licence as the OSM data the
 * app already carries and attributes. The footprints are machine-extracted from
 * satellite imagery, which is how they exist for a barangay no volunteer has
 * mapped by hand.
 *
 * They are ACCURATE ENOUGH FOR WHAT THIS MAP IS FOR — recognising your own
 * street at night — and not a survey. A footprint may be a few metres out, may
 * merge two roofs under one polygon, and will miss anything built or removed
 * since the imagery. Nothing in the app routes, measures or decides anything
 * from them: they are drawn underneath, and the streets, the boundary and the
 * route are all unchanged.
 *
 * The source tile covers about 80 km of Luzon and is 40 MB compressed, so it is
 * streamed and filtered rather than kept. Only the output is committed.
 *
 * Emits:  public/geo/buildings.json
 * Run:    node scripts/generate-buildings.mjs
 *
 * Building data (c) Microsoft, ODbL. Attributed on every map screen.
 */

import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * The quadkey (zoom 9) covering Nilombot, and its file in Microsoft's index.
 * To move the barangay again: fetch
 * https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv
 * and take the row whose QuadKey matches the new point.
 */
const QUADKEY = "132303011";
const SOURCE =
  "https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/" +
  "global-buildings.geojsonl/RegionName=Philippines/quadkey=132303011/" +
  "part-00041-4feead82-d499-422b-94cb-c036c212127a.c000.csv.gz";

/*
 * How far past the boundary to keep drawing.
 *
 * Not zero: buildings stopping dead on the boundary line would read as a wall,
 * and somebody checking whether the road out is built up needs to see the far
 * side of it. Not generous either — this file is precached onto cheap phones,
 * and every extra ring of houses is weight carried for a map nobody pans to.
 */
const MARGIN_M = 200;

/* Five decimals is about a metre. These footprints are not accurate to a
   metre, and the extra digits would be weight pretending to be precision. */
const PRECISION = 5;

const boundary = JSON.parse(
  readFileSync(join(ROOT, "scripts", "osm", "nilombot-boundary.json"), "utf8"),
);
const ring = boundary.ring;

function pointInRing(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function metresToSegment(p, a, b) {
  const lat = ((p[1] + a[1]) / 2) * (Math.PI / 180);
  const kx = 111_320 * Math.cos(lat);
  const ky = 110_574;
  const px = p[0] * kx, py = p[1] * ky;
  const ax = a[0] * kx, ay = a[1] * ky;
  const bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const metresToRing = (p) => {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) best = Math.min(best, metresToSegment(p, ring[i - 1], ring[i]));
  return best;
};

/* A cheap bounding box, to reject most of the 80 km tile on one comparison. */
const PAD_DEG = 0.004; // comfortably more than MARGIN_M
const lngs = ring.map((p) => p[0]);
const lats = ring.map((p) => p[1]);
const BOX = {
  w: Math.min(...lngs) - PAD_DEG,
  e: Math.max(...lngs) + PAD_DEG,
  s: Math.min(...lats) - PAD_DEG,
  n: Math.max(...lats) + PAD_DEG,
};

console.log(`quadkey ${QUADKEY}, streaming …`);

const response = await fetch(SOURCE, { signal: AbortSignal.timeout(900_000) });
if (!response.ok) throw new Error(`Microsoft footprints: ${response.status}`);

const lines = createInterface({
  input: Readable.fromWeb(response.body).pipe(createGunzip()),
  crlfDelay: Infinity,
});

const features = [];
let read = 0;

for await (const line of lines) {
  if (!line) continue;
  read += 1;

  let feature;
  try {
    feature = JSON.parse(line);
  } catch {
    /* Some releases wrap the GeoJSON in a CSV column. */
    const brace = line.indexOf("{");
    if (brace === -1) continue;
    try {
      feature = JSON.parse(line.slice(brace));
    } catch {
      continue;
    }
  }

  const outline = feature?.geometry?.coordinates?.[0];
  if (!Array.isArray(outline) || outline.length < 4) continue;

  const [x0, y0] = outline[0];
  if (typeof x0 !== "number" || x0 < BOX.w || x0 > BOX.e || y0 < BOX.s || y0 > BOX.n) continue;

  const centre = [
    outline.reduce((s, p) => s + p[0], 0) / outline.length,
    outline.reduce((s, p) => s + p[1], 0) / outline.length,
  ];
  if (!pointInRing(centre, ring) && metresToRing(centre) > MARGIN_M) continue;

  features.push({
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [outline.map(([x, y]) => [+x.toFixed(PRECISION), +y.toFixed(PRECISION)])],
    },
  });
}

const out = { type: "FeatureCollection", features };
const json = JSON.stringify(out);
writeFileSync(join(ROOT, "public", "geo", "buildings.json"), json);

const inside = features.filter((f) => {
  const r = f.geometry.coordinates[0];
  return pointInRing(
    [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length],
    ring,
  );
}).length;

console.log(`read    ${read.toLocaleString()} footprints in the tile`);
console.log(`kept    ${features.length} (${inside} inside the barangay, the rest within ${MARGIN_M} m)`);
console.log(`wrote   public/geo/buildings.json  ${(json.length / 1024).toFixed(0)} KB`);
