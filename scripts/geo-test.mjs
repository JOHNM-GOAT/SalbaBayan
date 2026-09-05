/**
 * Geometry tests for the evacuation map (PRD §7.5).
 *
 * These cover the part of the map that is safety-critical and invisible:
 * whether a hazard counts as blocking the route, how far the walk is, and
 * which way to turn next. A wrong answer here does not look wrong on screen —
 * the map still draws a confident line — so it needs testing that does not
 * depend on looking at it.
 *
 * Pure functions only, deliberately: no browser, no map, runs in CI.
 *
 * Run:  node scripts/geo-test.mjs
 */

/*
 * Imported straight from TypeScript — Node strips the types natively, so the
 * test exercises the exact source the app ships rather than a transpiled or
 * hand-copied version of it.
 */
import * as geo from "../src/lib/geo.ts";

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

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

console.log("\nEvacuation map geometry — SalbaBayan\n");

/* The real seeded Purok 3 route: north up Mabini, then west to the Gym. */
const route = [
  [121.416952, 14.28107],
  [121.416952, 14.282426],
  [121.415562, 14.282426],
];

console.log("Distance:");
check(
  "150m grid step measures ~150m",
  near(geo.metresBetween([121.41, 14.277], [121.41139, 14.277]), 150, 5),
  `${geo.metresBetween([121.41, 14.277], [121.41139, 14.277]).toFixed(1)}m`,
);
check(
  "Purok 3 route totals ~300m",
  near(geo.lineLength(route), 300, 10),
  `${geo.lineLength(route).toFixed(1)}m`,
);
check(
  "walking time is sane (300m -> 4-5 min)",
  [4, 5].includes(geo.walkMinutes(300)),
  `${geo.walkMinutes(300)} min`,
);

console.log("\nBlocked path (FR-11.4):");
/*
 * The case a vertex-only check would miss: a hazard in the MIDDLE of a long
 * straight, nowhere near a turn. That is the most likely place for a flooded
 * road, and getting it wrong means routing someone into it.
 */
const midSegment = [121.416952, 14.28175];
check(
  "hazard mid-segment is detected, not just at vertices",
  geo.metresToLine(midSegment, route) < 1,
  `${geo.metresToLine(midSegment, route).toFixed(1)}m from route`,
);

const hazards = [
  { id: "on", lat: 14.28175, lng: 121.416952 },
  { id: "off", lat: 14.278, lng: 121.4105 },
  { id: "unplaced", lat: null, lng: null },
];
const blocking = geo.hazardsOnRoute(hazards, route);
check(
  "hazard on the route blocks it",
  blocking.some((h) => h.id === "on"),
);
check(
  "hazard 500m away does not",
  !blocking.some((h) => h.id === "off"),
);
check(
  "hazard with no GPS fix is skipped, not crashed on",
  !blocking.some((h) => h.id === "unplaced") && blocking.length === 1,
  `got ${blocking.length}`,
);

/*
 * The threshold itself: just inside blocks, well outside does not.
 *
 * Offset EAST, perpendicular to this north-south leg. Offsetting north instead
 * walks the point along the route towards its corner, which stays within a few
 * metres of the line however far it moves — the first version of this test did
 * exactly that and failed for the wrong reason.
 */
const metrePerDegLng = 111_320 * Math.cos((14.28 * Math.PI) / 180);
const justInside = [121.416952 + (geo.BLOCKED_RADIUS_M - 10) / metrePerDegLng, 14.28175];
const wellOutside = [121.416952 + (geo.BLOCKED_RADIUS_M + 40) / metrePerDegLng, 14.28175];
check(
  `hazard ${geo.BLOCKED_RADIUS_M - 10}m from route blocks`,
  geo.hazardsOnRoute([{ id: "x", lat: justInside[1], lng: justInside[0] }], route).length === 1,
);
check(
  `hazard ${geo.BLOCKED_RADIUS_M + 40}m from route does not`,
  geo.hazardsOnRoute([{ id: "x", lat: wellOutside[1], lng: wellOutside[0] }], route).length === 0,
);

console.log("\nNext turn (FR-11.3):");
const atStart = geo.nextTurn(route, [121.416952, 14.28107]);
check(
  "heading north up the first leg, next move is a left turn",
  atStart.turn === "left",
  `got ${atStart.turn}`,
);
check(
  "distance to that turn is the leg length (~150m)",
  near(atStart.metres, 150, 10),
  `${atStart.metres}m`,
);

const onLastLeg = geo.nextTurn(route, [121.41625, 14.282426]);
check(
  "on the final leg it says arrive, not another turn",
  onLastLeg.turn === "arrive",
  `got ${onLastLeg.turn}`,
);

/* A degenerate route must not produce NaN — a zero-length segment would divide
 * by zero and silently make every hazard "not on the route". */
const degenerate = [
  [121.41, 14.277],
  [121.41, 14.277],
];
check(
  "zero-length segment does not produce NaN",
  Number.isFinite(geo.metresToLine([121.4101, 14.2771], degenerate)),
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
