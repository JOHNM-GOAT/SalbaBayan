/**
 * Walking routes and the barangay outline (src/lib/walkRoute.ts).
 *
 * The same module draws the first routes when the geography is generated and
 * redraws every route on an official's phone when the evacuation centre moves.
 * A wrong answer here is an instruction to walk the wrong way, so the cases are
 * small networks whose right answer can be checked by eye.
 *
 * Run:  node scripts/walkroute-test.mjs
 */

import {
  buildWalkGraph,
  metres,
  nearestNode,
  pointInRing,
  walkRoute,
} from "../src/lib/walkRoute.ts";

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

// ~111 m per 0.001° of latitude at Batac. Small, readable coordinates.
const street = (name, ...points) => ({
  properties: { name },
  geometry: { type: "LineString", coordinates: points },
});

console.log("\nWalking routes — SalbaBayan\n");

console.log("Distance at Batac's latitude:");
{
  const d = metres([120.56, 18.06], [120.56, 18.061]);
  check("0.001° of latitude is about 111 m", Math.abs(d - 110.6) < 1, `got ${d.toFixed(1)}`);
  const e = metres([120.56, 18.06], [120.561, 18.06]);
  // cos(18.06°) ≈ 0.951, so 0.001° of longitude ≈ 105.9 m there, not 111 m.
  check("0.001° of longitude is corrected for latitude", Math.abs(e - 105.9) < 1, `got ${e.toFixed(1)}`);
}

console.log("\nShortest path:");
{
  // A square with a long way round (north then east) and a short cut.
  //   (0,2) --- North --- (2,2)
  //     |                   |
  //   West               East
  //     |                   |
  //   (0,0) --- South --- (2,0)
  // plus a diagonal Cut from (0,0) to (2,2).
  const p = (x, y) => [120.56 + x * 0.001, 18.06 + y * 0.001];
  const streets = {
    features: [
      street("South Street", p(0, 0), p(1, 0), p(2, 0)),
      street("East Street", p(2, 0), p(2, 1), p(2, 2)),
      street("West Street", p(0, 0), p(0, 1), p(0, 2)),
      street("North Street", p(0, 2), p(1, 2), p(2, 2)),
      street("Cut Road", p(0, 0), p(1, 1), p(2, 2)),
    ],
  };
  const graph = buildWalkGraph(streets);
  const route = walkRoute(graph, p(0, 0), p(2, 2));

  check("a route is found", route !== null);
  check(
    "it takes the diagonal, not the long way round",
    route?.line.length === 3 && route.via.join() === "Cut Rd.",
    JSON.stringify(route?.via),
  );
  check(
    "its length is the diagonal's, about 305 m",
    route && Math.abs(route.metres - 305) < 5,
    `got ${route?.metres}`,
  );
  check(
    "it starts and ends exactly on the network",
    route &&
      route.line[0].join() === p(0, 0).join() &&
      route.line[route.line.length - 1].join() === p(2, 2).join(),
  );

  const offStreet = walkRoute(graph, [p(0, 0)[0] - 0.0001, p(0, 0)[1]], p(2, 0));
  check(
    "a start a few metres off the street snaps onto it",
    offStreet?.line[0].join() === p(0, 0).join(),
  );
  check(
    "street names are shortened and not repeated",
    offStreet?.via.join() === "South St.",
    JSON.stringify(offStreet?.via),
  );
}

console.log("\nOrphans are not routable:");
{
  const main = street("Main Street", [120.56, 18.06], [120.561, 18.06], [120.562, 18.06]);
  const island = street("Driveway", [120.57, 18.07], [120.5701, 18.07]);
  const graph = buildWalkGraph({ features: [main, island] });
  check("only the largest connected part is kept", graph.nodes.length === 3, `got ${graph.nodes.length}`);
  check(
    "a start next to the island still snaps to the main network",
    nearestNode(graph, [120.5700, 18.07]) === "120.562,18.06",
    nearestNode(graph, [120.5700, 18.07]),
  );
  check("an empty network has no route", walkRoute(buildWalkGraph({ features: [] }), [0, 0], [1, 1]) === null);
}

console.log("\nInside the barangay or not:");
{
  // A triangle shaped like Callaguip: apex north, flat-ish south edge.
  const triangle = [
    [120.5593, 18.0618],
    [120.5614, 18.0673],
    [120.5628, 18.059],
    [120.5593, 18.0618],
  ];
  check("a point in the middle is inside", pointInRing([120.5612, 18.0625], triangle));
  check("a point east of the east edge is outside", !pointInRing([120.5636, 18.0627], triangle));
  check("a point north of the apex is outside", !pointInRing([120.5614, 18.068], triangle));
  check(
    "an open ring (not repeating its first point) works the same",
    pointInRing([120.5612, 18.0625], triangle.slice(0, 3)),
  );

  // A concave shape: the notch must read as outside.
  const notched = [
    [0, 0], [4, 0], [4, 4], [2, 1], [0, 4],
  ];
  check("a point inside a concave notch is outside", !pointInRing([2, 3], notched));
  check("a point in the body of a concave shape is inside", pointInRing([1, 1], notched));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exitCode = 1;
